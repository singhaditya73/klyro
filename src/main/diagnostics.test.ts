import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-diag-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    getVersion: () => '0.2.0-test'
  }
}))

// Opt-in state is read at event time from settings; flip it in tests.
let optIn = false
vi.mock('./domains/settings', () => ({
  settingsDomain: {
    get: () => ({ diagnosticsOptIn: optIn })
  }
}))

const { captureCrash, listReports, clearReports } = await import('./diagnostics')

function savedFiles(): string[] {
  try {
    return readdirSync(join(userData, 'diagnostics'))
  } catch {
    return []
  }
}

describe('diagnostics capture (opt-in)', () => {
  afterEach(async () => {
    optIn = false
    await clearReports()
  })

  it('stores nothing when reporting is off (the default)', async () => {
    await captureCrash('main-crash', { message: 'boom', stack: 'at x' })
    expect(savedFiles()).toEqual([])
    expect(await listReports()).toEqual([])
  })

  it('stores a redacted local report when opted in', async () => {
    optIn = true
    await captureCrash('render-process-gone', {
      message: 'sk-abcd1234abcd1234abcd leaked in message',
      stack: 'TypeError: x\n at y (sk-abcd1234abcd1234efgh)'
    })
    const reports = await listReports()
    expect(reports).toHaveLength(1)
    expect(reports[0].kind).toBe('render-process-gone')
    expect(reports[0].version).toBe('0.2.0-test')
    expect(reports[0].id).toBeTruthy()
    // The report itself must not carry credential-shaped secrets through.
    expect(reports[0].message).toContain('sk-***')
    expect(reports[0].message).not.toContain('abcd1234abcd1234')
    if (reports[0].stack) expect(reports[0].stack).not.toContain('abcd1234abcd1234')
  })

  it('keeps at most a bounded number of reports', async () => {
    optIn = true
    for (let index = 0; index < 25; index += 1) {
      await captureCrash('unhandled-rejection', { message: `crash ${index}` })
    }
    const reports = await listReports()
    expect(reports.length).toBeGreaterThan(0)
    expect(reports.length).toBeLessThanOrEqual(20)
  })

  it('clearReports removes everything', async () => {
    optIn = true
    await captureCrash('main-crash', { message: 'x' })
    expect(await listReports()).not.toEqual([])
    await clearReports()
    expect(await listReports()).toEqual([])
  })
})
