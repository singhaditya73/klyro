import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listOpenCodeModels, openCodeProvider, probeOpenCode } from './opencode'

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

  it('passes its own connection test', async () => {
    const result = await openCodeProvider.test({ baseUrl: BASE_URL, apiKey: PASSWORD, model: 'minimax/minimax-m3.1-flash:free' })
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('no key')
  }, 20000)

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
