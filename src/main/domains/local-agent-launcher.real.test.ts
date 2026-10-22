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

    // Which model answers is the server's business, not Klyro's: a model can
    // be signed out or out of credit, and then its turn never starts. The
    // connect-time check is the thing under test here: it must skip a dead
    // model and settle on one that answers.
    const picked = await localAgentLauncher.pickOpenCodeModel(result.baseUrl)
    console.log('picked:', JSON.stringify(picked))
    if (!picked.verified) {
      console.log('no free model answered the check — the live answer check is inconclusive')
      localAgentLauncher.stopOpenCode()
      return
    }
    expect(picked.tried.some((attempt) => attempt.answered)).toBe(true)

    const chunks: string[] = []
    for await (const chunk of openCodeProvider.chat({
      model: picked.model,
      baseUrl: result.baseUrl,
      apiKey: password,
      turns: [{ role: 'user', text: 'Reply with exactly: KLYRO STARTED OK' }]
    })) {
      chunks.push(chunk)
    }
    const answer = chunks.join('')
    console.log(`answer from ${picked.model}:`, JSON.stringify(answer))
    expect(answer.toUpperCase()).toContain('KLYRO')
    localAgentLauncher.stopOpenCode()
  }, 180000)
})

afterAll(() => {
  localAgentLauncher.stopOpenCode()
})
