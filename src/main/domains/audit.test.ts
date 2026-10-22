import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-audit-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, on: () => undefined }
}))
// The retention window lives in the settings, and settings touch the keychain.
vi.mock('../security/secrets', () => ({
  secrets: {
    get: () => null,
    set: () => undefined,
    remove: () => undefined,
    count: () => 0,
    setPlaintextPolicy: () => undefined
  }
}))

const { audit } = await import('./audit')
const { settingsDomain: settings } = await import('./settings')

describe('audit log', () => {
  it('records, lists newest-first, and clears', () => {
    audit.record('agent.action', 'typed "hello" in app', { runId: 'r1' })
    audit.record('meeting.actions', 'filed 2 issue(s) from "Standup"', { ok: true })
    audit.record('mcp.tool-call', 'Called echo on an MCP server', { ok: true })

    const entries = audit.list()
    expect(entries).toHaveLength(3)
    const atTimes = entries.map((entry) => entry.at)
    expect(atTimes.every((value, index) => index === 0 || atTimes[index - 1] >= value)).toBe(true)
    expect(new Set(entries.map((entry) => entry.kind))).toEqual(new Set(['agent.action', 'meeting.actions', 'mcp.tool-call']))
    expect(entries.every((entry) => entry.at > 0 && entry.id)).toBe(true)
    expect(entries.find((entry) => entry.kind === 'agent.action')?.meta).toEqual({ runId: 'r1' })
    expect(entries.find((entry) => entry.kind === 'mcp.tool-call')?.meta).toEqual({ ok: true })
    expect(entries.find((entry) => entry.kind === 'meeting.actions')?.meta).toEqual({ ok: true })

    const limited = audit.list(1)
    expect(limited).toHaveLength(1)
    expect(limited[0]).toEqual(entries[0])

    audit.clear()
    expect(audit.list()).toHaveLength(0)
  })

  it('collapses whitespace and truncates very long details', () => {
    audit.record('test.kind', 'line one\n\tline   two'.repeat(30))
    const [entry] = audit.list(1)
    expect(entry.detail).not.toMatch(/\n/)
    expect(entry.detail.length).toBeLessThanOrEqual(500)
  })
})

/** The log says what Klyro did, in words; the window applies to it too. */
describe('the audit log and the retention window', () => {
  it('drops the entries outside the window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T09:00:00Z'))
    audit.clear()
    audit.record('chat.answer', 'an entry from January')

    vi.setSystemTime(new Date('2026-06-01T09:00:00Z'))
    audit.record('chat.answer', 'an entry from June')

    settings.update({ retentionDays: 30 })
    expect(audit.prune()).toBeGreaterThan(0)

    const entries = audit.list()
    expect(entries.some((entry) => entry.detail.includes('January'))).toBe(false)
    expect(entries.some((entry) => entry.detail.includes('June'))).toBe(true)

    vi.useRealTimers()
    settings.update({ retentionDays: 0 })
  })

  it('keeps everything when the window is zero days', () => {
    settings.update({ retentionDays: 0 })
    audit.record('app.test', 'a kept entry')
    expect(audit.prune()).toBe(0)
    expect(audit.list().some((entry) => entry.detail.includes('kept entry'))).toBe(true)
  })
})
