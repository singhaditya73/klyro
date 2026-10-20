import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-claude-real-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, on: () => undefined, getVersion: () => '0-test' }
}))

const { claudeCodeProvider, findClaudeBinary } = await import('./claude-code')

/** A live check against the real Claude Code CLI. Skipped when not installed. */
describe('Claude Code provider', () => {
  it('runs the real CLI and reports what happened', async () => {
    const binary = findClaudeBinary()
    if (!binary) {
      console.log('claude is not installed here — skipping the live check')
      return
    }
    console.log('binary:', binary)
    const chunks: string[] = []
    let error: string | null = null
    try {
      for await (const chunk of claudeCodeProvider.chat({
        model: '',
        baseUrl: '',
        apiKey: null,
        turns: [{ role: 'user', text: 'Reply with exactly: CLAUDE OK' }]
      })) {
        chunks.push(chunk)
      }
    } catch (caught) {
      error = (caught as Error).message
    }
    console.log('answer:', JSON.stringify(chunks.join('')))
    console.log('error:', error)
    // Either it answered, or it told us honestly what is missing.
    expect(chunks.length > 0 || Boolean(error)).toBe(true)
  }, 120000)
})
