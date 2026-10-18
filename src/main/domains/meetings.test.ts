import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-meetings-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^enc:/, '')
  }
}))

vi.mock('../providers', () => ({
  getProvider: () => ({
    id: 'fake',
    async *chat() {
      yield '{"summary":"We agreed on the plan.","actions":["Ada sends the numbers"]}'
    },
    test: async () => ({ ok: true, detail: 'fake' })
  })
}))

const { meetings, TRANSCRIPTION_GAP } = await import('./meetings')
const { secrets } = await import('../security/secrets')

// Summarizing goes through provider routing, which needs a configured key.
secrets.set('openai', 'test-key')

describe('live transcript', () => {
  it('accumulates chunk transcriptions and drops silence artefacts', () => {
    meetings.discardLiveTranscript()
    expect(meetings.appendTranscript('The build is finally green')).toMatchObject({ added: true })
    expect(meetings.appendTranscript('[BLANK_AUDIO]')).toMatchObject({ added: false })
    expect(meetings.appendTranscript('is finally green and the release is next')).toMatchObject({ added: true })

    const live = meetings.liveTranscript()
    expect(live?.segments.map((segment) => segment.text)).toEqual([
      'The build is finally green',
      'and the release is next'
    ])
    // Offsets are measured from the recording start, never negative.
    expect(live?.segments.every((segment) => segment.at >= 0)).toBe(true)
  })

  it('records a visible marker when a chunk could not be transcribed', () => {
    meetings.discardLiveTranscript()
    meetings.appendTranscript('First sentence of the call')
    const marked = meetings.markTranscriptGap()

    expect(marked.added).toBe(true)
    expect(meetings.liveTranscript()?.segments.map((segment) => segment.text)).toContain(TRANSCRIPTION_GAP)
  })

  it('survives a restart: the draft is on disk, not only in memory', async () => {
    meetings.discardLiveTranscript()
    meetings.appendTranscript('Remember to send the invoice')

    vi.resetModules()
    const reloaded = (await import('./meetings')).meetings
    const recovered = reloaded.liveTranscript()

    expect(recovered?.segments.map((segment) => segment.text)).toEqual(['Remember to send the invoice'])
  })

  it('is cleared once the recording is saved as a meeting', () => {
    meetings.discardLiveTranscript()
    meetings.appendTranscript('Decision: ship on Friday')
    const saved = meetings.save({
      title: 'Weekly',
      startedAt: Date.now() - 1000,
      endedAt: Date.now(),
      segments: meetings.liveTranscript()?.segments ?? []
    })

    expect(saved.segments.map((segment) => segment.text)).toEqual(['Decision: ship on Friday'])
    expect(meetings.liveTranscript()).toBeNull()
  })

  it('cleans duplicated segments whatever the caller passes', () => {
    // The draft pipeline already removes repeats, but save() must not trust its
    // caller: noise and boundary duplicates are cleaned again here.
    const saved = meetings.save({
      title: 'Duplicated',
      startedAt: Date.now(),
      endedAt: Date.now(),
      segments: [
        { at: 0, text: 'we should ship on Friday' },
        { at: 1, text: 'ship on Friday and then celebrate' },
        { at: 2, text: '[BLANK_AUDIO]' },
        { at: 3, text: 'and then celebrate' }
      ]
    })

    expect(saved.segments.map((segment) => segment.text)).toEqual(['we should ship on Friday', 'and then celebrate'])
  })

  it('summarizes a stored meeting into a summary and action items', async () => {
    const saved = meetings.save({
      title: 'Planning',
      startedAt: Date.now(),
      endedAt: Date.now(),
      segments: [{ at: 0, text: 'Ada: I will send the numbers to Priya by Thursday.' }]
    })

    const summarized = await meetings.summarize(saved.id)
    expect(summarized.summary).toBe('We agreed on the plan.')
    expect(summarized.actions).toEqual(['Ada sends the numbers'])
  })
})
