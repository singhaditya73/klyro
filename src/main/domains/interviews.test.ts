import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Ephemeral sessions and retention are the two promises the history makes
 * about what it does with other people's words. Both are tested against the
 * file itself, not against the API's own answer: "not written down" means the
 * string is not in the file.
 */

let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('../security/secrets', () => ({
  secrets: {
    get: () => null,
    set: () => undefined,
    remove: () => undefined,
    count: () => 0,
    setPlaintextPolicy: () => undefined,
    init: () => undefined
  }
}))

type Interviews = typeof import('./interviews')['interviews']
type Settings = typeof import('./settings')['settingsDomain']

let interviews: Interviews
let settings: Settings

const historyFile = (): string => join(userData, 'interviews.json')
const historyText = (): string => (existsSync(historyFile()) ? readFileSync(historyFile(), 'utf8') : '')

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'klyro-interviews-'))
  interviews = (await import('./interviews')).interviews
  settings = (await import('./settings')).settingsDomain
})

afterAll(() => {
  vi.useRealTimers()
})

describe('an ephemeral session', () => {
  it('answers but never reaches the disk', () => {
    const session = interviews.start('Ghost Co', 'Staff Engineer', { ephemeral: true })
    expect(session.ephemeral).toBe(true)

    interviews.addQuestion(session.id, {
      text: 'the secret question about the secret project',
      source: 'voice',
      answer: 'the secret answer',
      answerMs: 900
    })
    interviews.addTranscript(session.id, 'the secret transcript line')

    // It is readable while it lives...
    const live = interviews.get(session.id)
    expect(live?.questions).toHaveLength(1)
    expect(live?.answers[0]).toBe('the secret answer')
    expect(live?.transcript).toEqual(['the secret transcript line'])

    // ...and nowhere in the file.
    const written = historyText()
    expect(written).not.toContain('secret question')
    expect(written).not.toContain('secret answer')
    expect(written).not.toContain('secret transcript')
    expect(written).not.toContain('Ghost Co')
  })

  it('is listed while it lives, marked as not saved', () => {
    const session = interviews.start('Live Co', '', { ephemeral: true })
    const listed = interviews.list().find((entry) => entry.id === session.id)
    expect(listed?.ephemeral).toBe(true)
    expect(interviews.ephemeralCount()).toBeGreaterThan(0)
  })

  it('cannot be turned private-and-public by a patch', () => {
    const session = interviews.start('Patch Co', '', { ephemeral: true })
    interviews.update(session.id, { ephemeral: false, company: 'Patched Co' })
    expect(interviews.get(session.id)?.ephemeral).toBe(true)
    expect(interviews.get(session.id)?.company).toBe('Patched Co')
    expect(historyText()).not.toContain('Patched Co')
  })

  it('is written down only when the user keeps it', () => {
    const session = interviews.start('Kept Co', 'Engineer', { ephemeral: true })
    interviews.addQuestion(session.id, {
      text: 'a question worth keeping',
      source: 'text',
      answer: 'an answer worth keeping'
    })
    expect(historyText()).not.toContain('worth keeping')

    const kept = interviews.keep(session.id)
    expect(kept?.ephemeral).toBe(false)
    expect(historyText()).toContain('worth keeping')
  })

  it('follows the setting when no choice is made', () => {
    settings.update({ interviewEphemeralDefault: true })
    const started = interviews.start('Default Co', '')
    expect(started.ephemeral).toBe(true)
    expect(historyText()).not.toContain('Default Co')
    settings.update({ interviewEphemeralDefault: false })
  })
})

describe('retention', () => {
  it('forgets what is older than the window, and keeps the rest', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T09:00:00Z'))
    const old = interviews.start('Old Co', 'Old Role')
    interviews.addQuestion(old.id, { text: 'an old question', source: 'text', answer: 'an old answer' })

    vi.setSystemTime(new Date('2026-06-01T09:00:00Z'))
    const recent = interviews.start('Recent Co', 'Recent Role')

    settings.update({ retentionDays: 30 })
    const removed = interviews.prune()

    expect(removed).toBeGreaterThan(0)
    expect(interviews.get(old.id)).toBeNull()
    expect(interviews.get(recent.id)).not.toBeNull()
    expect(historyText()).not.toContain('Old Co')
    expect(historyText()).toContain('Recent Co')

    vi.useRealTimers()
    settings.update({ retentionDays: 0 })
  })

  it('keeps everything when the policy is zero days', () => {
    settings.update({ retentionDays: 0 })
    const session = interviews.start('Forever Co', '')
    expect(interviews.prune()).toBe(0)
    expect(interviews.get(session.id)).not.toBeNull()
  })

  it('turns a number of days into an honest cutoff', async () => {
    const { retentionCutoff } = await import('./retention')
    expect(retentionCutoff(0)).toBeNull()
    expect(retentionCutoff(-1)).toBeNull()
    expect(retentionCutoff(Number.NaN)).toBeNull()
    expect(retentionCutoff(30, 1_000_000_000)).toBe(1_000_000_000 - 30 * 24 * 60 * 60 * 1000)
  })
})
