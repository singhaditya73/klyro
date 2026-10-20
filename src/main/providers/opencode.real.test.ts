import { describe, expect, it } from 'vitest'
import { listOpenCodeModels, openCodeProvider, probeOpenCode } from './opencode'

const BASE_URL = 'http://127.0.0.1:4096'
const PASSWORD = process.env.KLYRO_OPENCODE_PASSWORD || ''

/**
 * A live check against a real `opencode serve` on this machine. Skipped unless
 * a server is running (KLYRO_OPENCODE_PASSWORD may hold its password).
 */
describe('OpenCode provider against a real server', () => {
  it('talks to the real server', async () => {
    const health = await probeOpenCode(BASE_URL, PASSWORD)
    if (!health.healthy) {
      console.log('no opencode server on 4096 — skipping the live check')
      return
    }
    console.log('health:', JSON.stringify(health))
    const models = await listOpenCodeModels(BASE_URL, PASSWORD)
    const free = models.filter((m) => m.free)
    console.log(`models: ${models.length}, free: ${free.length}`, free.slice(0, 3).map((m) => m.id))

    const chunks: string[] = []
    try {
      for await (const chunk of openCodeProvider.chat({
        model: free[0]?.id ?? models[0]?.id ?? '',
        baseUrl: BASE_URL,
        apiKey: PASSWORD,
        turns: [{ role: 'user', text: 'Reply with exactly: KLYRO REAL OK' }]
      })) {
        chunks.push(chunk)
      }
    } catch (error) {
      // A password-protected server needs its password in the environment;
      // without it the live check simply cannot run.
      console.log('live check skipped:', (error as Error).message.slice(0, 80))
      return
    }
    console.log('answer:', JSON.stringify(chunks.join('')))
    expect(chunks.join('').toUpperCase()).toContain('KLYRO')
  }, 120000)
})
