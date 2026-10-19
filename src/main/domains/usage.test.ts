import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-usage-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, on: () => undefined }
}))

const { usage } = await import('./usage')

describe('usage ledger', () => {
  it('counts requests, tool calls, and failures per provider', () => {
    usage.clear()
    usage.record('groq', 'chat')
    usage.record('groq', 'chat', { toolCall: true })
    usage.record('groq', 'transcribe', { failed: true })
    usage.record('openai', 'agent-step')

    expect(usage.rows()).toEqual([
      { provider: 'groq', requests: 3, toolCalls: 1, failures: 1 },
      { provider: 'openai', requests: 1, toolCalls: 1, failures: 0 }
    ])

    usage.clear()
    expect(usage.rows()).toEqual([])
  })

  it('ignores empty provider ids', () => {
    usage.clear()
    usage.record('' as never, 'chat')
    expect(usage.rows()).toEqual([])
  })
})
