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
    usage.record('groq', 'chat', { inputTokens: 500, outputTokens: 200 })
    usage.record('groq', 'chat', { toolCall: true, inputTokens: 300, outputTokens: 100 })
    usage.record('groq', 'transcribe', { failed: true, inputTokens: 100, outputTokens: 0 })
    usage.record('openai', 'agent-step', { inputTokens: 200, outputTokens: 100 })

    const rows = usage.rows()
    expect(rows.length).toBe(2)
    const groq = rows.find((r) => r.provider === 'groq')
    const openai = rows.find((r) => r.provider === 'openai')

    expect(groq).toMatchObject({
      provider: 'groq',
      requests: 3,
      toolCalls: 1,
      failures: 1,
      inputTokens: 900,
      outputTokens: 300,
      totalTokens: 1200
    })
    expect(groq?.estimatedSpendUsd).toBeGreaterThan(0)

    expect(openai).toMatchObject({
      provider: 'openai',
      requests: 1,
      toolCalls: 1,
      failures: 0,
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300
    })
    expect(openai?.estimatedSpendUsd).toBeGreaterThan(0)

    usage.clear()
    expect(usage.rows()).toEqual([])
  })

  it('ignores empty provider ids', () => {
    usage.clear()
    usage.record('' as never, 'chat')
    expect(usage.rows()).toEqual([])
  })

  it('does not invent tokens or spend when no usage was reported', () => {
    usage.clear()
    usage.record('openai', 'chat')
    const [row] = usage.rows()
    expect(row.totalTokens).toBe(0)
    expect(row.inputTokens).toBe(0)
    expect(row.outputTokens).toBe(0)
    expect(row.estimatedSpendUsd).toBe(0)
    expect(row.requests).toBe(1)
  })
})
