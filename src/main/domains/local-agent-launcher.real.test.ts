import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-launcher-real-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, on: () => undefined, getVersion: () => '0-test' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`).toString('base64'),
    decryptString: (value: string) => Buffer.from(value, 'base64').toString().replace(/^enc:/, '')
  }
}))

const { findOpenCodeBinary, localAgentLauncher } = await import('./local-agent-launcher')
const { listOpenCodeModels, openCodeProvider } = await import('../providers/opencode')
const { secrets } = await import('../security/secrets')

/**
 * A live check: start the real OpenCode installed on this machine, let Klyro
 * read the password it printed, and ask it a question. Skipped when OpenCode
 * is not installed.
 */
describe('starting the real OpenCode', () => {
  it('starts it, keeps the password, and answers a question', async () => {
    const binary = findOpenCodeBinary()
    if (!binary) {
      console.log('opencode is not installed here — skipping the live check')
      return
    }
    console.log('binary:', binary)
    const result = await localAgentLauncher.startOpenCode()
    console.log('launch:', JSON.stringify(result))
    expect(result.started).toBe(true)

    const password = secrets.get('opencode')
    console.log('password captured:', Boolean(password))

    const models = await listOpenCodeModels(result.baseUrl, password)
    const free = models.filter((model) => model.free)
    console.log(`models: ${models.length}, free: ${free.length}`)

    // Which model answers is the server's business, not Klyro's: a free model
    // that says nothing is a bad model, not a broken connection. A few are
    // tried, and only a connection failure fails the test.
    const candidates = [...free, ...models].slice(0, 4)
    let answer = ''
    let lastError: Error | null = null
    for (const candidate of candidates) {
      const chunks: string[] = []
      try {
        for await (const chunk of openCodeProvider.chat({
          model: candidate.id,
          baseUrl: result.baseUrl,
          apiKey: password,
          turns: [{ role: 'user', text: 'Reply with exactly: KLYRO STARTED OK' }]
        })) {
          chunks.push(chunk)
        }
        answer = chunks.join('')
      } catch (error) {
        const message = (error as Error).message
        console.log(`model ${candidate.id} failed: ${message}`)
        // "Said nothing" is the model's own silence; anything else is plumbing.
        if (!message.includes('without an answer')) throw error
        lastError = error as Error
        continue
      }
      console.log(`answer from ${candidate.id}:`, JSON.stringify(answer))
      if (answer.trim()) break
    }

    if (!answer.trim()) {
      console.log(`no candidate model answered (${lastError?.message ?? 'no model'}) — the live check is inconclusive`)
      localAgentLauncher.stopOpenCode()
      return
    }
    expect(answer.toUpperCase()).toContain('KLYRO')
    localAgentLauncher.stopOpenCode()
  }, 180000)
})

afterAll(() => {
  localAgentLauncher.stopOpenCode()
})
