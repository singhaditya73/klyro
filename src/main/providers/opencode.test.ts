import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  freeModelCandidates,
  listOpenCodeModels,
  openCodeProvider,
  probeOpenCode,
  probeOpenCodeModel
} from './opencode'

const fixture = fileURLToPath(new URL('./__fixtures__/opencode-fake-server.mjs', import.meta.url))
const PORT = 41877
const BASE_URL = `http://127.0.0.1:${PORT}`
const PASSWORD = 'fixture-password'

let server: ChildProcess | null = null

beforeAll(async () => {
  server = spawn('node', [fixture], {
    env: { ...process.env, PORT: String(PORT), OPENCODE_SERVER_PASSWORD: PASSWORD },
    stdio: 'ignore'
  })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const health = await probeOpenCode(BASE_URL, PASSWORD)
    if (health.healthy) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('The OpenCode fixture did not start')
}, 20000)

afterAll(() => {
  server?.kill()
})

describe('OpenCode local provider', () => {
  it('finds a running server and its models, free ones included', async () => {
    const health = await probeOpenCode(BASE_URL, PASSWORD)
    expect(health.healthy).toBe(true)
    expect(health.generation).toBe('v2')

    const models = await listOpenCodeModels(BASE_URL, PASSWORD)
    expect(models.map((model) => model.id)).toContain('minimax/minimax-m3.1-flash:free')
    expect(models.find((model) => model.free)?.id).toBe('minimax/minimax-m3.1-flash:free')
  })

  it('checks that a model answers before it is recommended', async () => {
    const result = await probeOpenCodeModel(
      BASE_URL,
      PASSWORD,
      'minimax/minimax-m3.1-flash:free',
      'openrouter',
      5000
    )
    expect(result).toEqual({ answered: true, reason: null })
  }, 20000)

  it('reports why a model does not answer', async () => {
    const silent = await probeOpenCodeModel(BASE_URL, PASSWORD, 'silent-model', 'openrouter', 5000)
    expect(silent.answered).toBe(false)
    expect(silent.reason).toBe('the turn ended without text')

    const broken = await probeOpenCodeModel(BASE_URL, PASSWORD, 'broken-model', 'openrouter', 5000)
    expect(broken.answered).toBe(false)
    expect(broken.reason).toBe('the model is not available')

    const stalled = await probeOpenCodeModel(BASE_URL, PASSWORD, 'stalled-model', 'openrouter', 1200)
    expect(stalled.answered).toBe(false)
    expect(stalled.reason).toMatch(/no answer in \d+ s/)
  }, 20000)

  it('offers at most one free model per provider', () => {
    const models = [
      { id: 'a/one:free', name: 'One', providerID: 'a', free: true },
      { id: 'a/two:free', name: 'Two', providerID: 'a', free: true },
      { id: 'paid/model', name: 'Paid', providerID: 'a', free: false },
      { id: 'b/one:free', name: 'B one', providerID: 'b', free: true },
      { id: 'c/one:free', name: 'C one', providerID: 'c', free: true }
    ]
    expect(freeModelCandidates(models).map((model) => model.id)).toEqual([
      'a/one:free',
      'b/one:free',
      'c/one:free'
    ])
    expect(freeModelCandidates(models, 2).map((model) => model.id)).toEqual([
      'a/one:free',
      'b/one:free'
    ])
  })

  it('reports honestly when no server is running', async () => {
    const health = await probeOpenCode('http://127.0.0.1:41878', PASSWORD)
    expect(health.healthy).toBe(false)
  })

  it('streams the answer as it grows', async () => {
    const chunks: string[] = []
    for await (const chunk of openCodeProvider.chat({
      model: 'minimax/minimax-m3.1-flash:free',
      baseUrl: BASE_URL,
      apiKey: PASSWORD,
      turns: [{ role: 'user', text: 'What is on this screen?' }]
    })) {
      chunks.push(chunk)
    }
    expect(chunks.join('')).toBe('Klyro works.')
    // It arrived in pieces, not one lump.
    expect(chunks.length).toBeGreaterThan(1)
  }, 30000)

  it('sends the picture with the question, so the model can see it', async () => {
    const chunks: string[] = []
    for await (const chunk of openCodeProvider.chat({
      model: 'minimax/minimax-m3.1-flash:free',
      baseUrl: BASE_URL,
      apiKey: PASSWORD,
      turns: [
        {
          role: 'user',
          text: 'What is on this screen?',
          images: [{ dataUrl: 'data:image/png;base64,AAAA', mime: 'image/png' }]
        }
      ]
    })) {
      chunks.push(chunk)
    }
    // The server counts the pictures it was given: one means the image
    // reached it, and the model could see it.
    expect(chunks.join('')).toContain('1 image')
  }, 30000)

  it('keeps the whole answer when the turn is several messages', async () => {
    const chunks: string[] = []
    for await (const chunk of openCodeProvider.chat({
      model: 'minimax/minimax-m3.1-flash:free',
      baseUrl: BASE_URL,
      apiKey: PASSWORD,
      turns: [{ role: 'user', text: 'multi' }]
    })) {
      chunks.push(chunk)
    }
    // The progress line and the answer are different messages; both are the
    // answer as far as the user is concerned.
    expect(chunks.join('')).toBe('Looking. \nAll done.')
  }, 30000)

  it('does not lose the answer behind a tool call', async () => {
    const chunks: string[] = []
    for await (const chunk of openCodeProvider.chat({
      model: 'minimax/minimax-m3.1-flash:free',
      baseUrl: BASE_URL,
      apiKey: PASSWORD,
      turns: [{ role: 'user', text: 'tool' }]
    })) {
      chunks.push(chunk)
    }
    // The first message of the turn holds a tool call and no text at all.
    expect(chunks.join('')).toBe('Here is the answer.')
  }, 30000)

  it('passes its own connection test', async () => {
    const result = await openCodeProvider.test({ baseUrl: BASE_URL, apiKey: PASSWORD, model: 'minimax/minimax-m3.1-flash:free' })
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('no key')
  }, 20000)

  it('says so when the turn ends without an answer', async () => {
    // An empty answer used to be stored as an empty message: the chat showed
    // a blank bubble and the user could not tell a silent model from a
    // broken one.
    await expect(
      (async () => {
        for await (const _ of openCodeProvider.chat({
          model: 'minimax/minimax-m3.1-flash:free',
          baseUrl: BASE_URL,
          apiKey: PASSWORD,
          turns: [{ role: 'user', text: 'silent' }]
        })) {
          // consume
        }
      })()
    ).rejects.toThrow(/without an answer/i)
    await expect(
      (async () => {
        for await (const _ of openCodeProvider.chat({
          model: 'minimax/minimax-m3.1-flash:free',
          baseUrl: BASE_URL,
          apiKey: PASSWORD,
          turns: [{ role: 'user', text: 'silent' }]
        })) {
          // Nothing should arrive.
        }
      })()
    ).rejects.toThrow(/model: minimax\/minimax-m3\.1-flash:free/)
  }, 30000)

  it('reports why a turn failed', async () => {
    await expect(
      (async () => {
        for await (const _ of openCodeProvider.chat({
          model: 'minimax/minimax-m3.1-flash:free',
          baseUrl: BASE_URL,
          apiKey: PASSWORD,
          turns: [{ role: 'user', text: 'broken' }]
        })) {
          // consume
        }
      })()
    ).rejects.toThrow(/the model is not available/i)
  }, 30000)

  it('explains itself when the server is not there', async () => {
    await expect(
      (async () => {
        for await (const _ of openCodeProvider.chat({
          model: 'x',
          baseUrl: 'http://127.0.0.1:41878',
          apiKey: null,
          turns: [{ role: 'user', text: 'hi' }]
        })) {
          // consume
        }
      })()
    ).rejects.toThrow(/opencode serve/i)
  }, 20000)
})
