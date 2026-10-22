import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-cache-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, on: () => undefined }
}))

const { answerCache, AnswerCache } = await import('./answer-cache')

describe('answer cache', () => {
  it('replays an answer for the same question, model and screen', () => {
    answerCache.clear()
    const key = answerCache.key('llama', 'what is this error?', AnswerCache.captureHash('data:image/png;base64,AAA'))
    answerCache.set(key, 'It is a missing semicolon.', 'llama')

    const hit = answerCache.get(key)
    expect(hit?.answer).toBe('It is a missing semicolon.')
    expect(hit?.cached).toBe(true)
  })

  it('never replays across a different screen or question', () => {
    answerCache.clear()
    const screen = AnswerCache.captureHash('data:image/png;base64,AAA')
    const other = AnswerCache.captureHash('data:image/png;base64,BBB')
    const key = answerCache.key('llama', 'what is this error?', screen)
    answerCache.set(key, 'An answer', 'llama')

    expect(answerCache.get(answerCache.key('llama', 'what is this error?', other))).toBeNull()
    expect(answerCache.get(answerCache.key('llama', 'a different question', screen))).toBeNull()
    expect(answerCache.get(answerCache.key('gpt-4o', 'what is this error?', screen))).toBeNull()
  })

  it('gives different captures different keys', () => {
    expect(AnswerCache.captureHash('data:image/png;base64,AAA')).not.toBe(
      AnswerCache.captureHash('data:image/png;base64,BBB')
    )
    expect(AnswerCache.captureHash(undefined)).toBe('none')
  })
})

/**
 * The cache may only replay an answer for fifteen minutes. The file used to
 * keep whatever was last written, which is longer than the promise.
 */
describe('the cache file', () => {
  it('does not replay an answer after the window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T09:00:00Z'))
    answerCache.clear()
    const key = answerCache.key('model-a', 'a question', 'capture')
    answerCache.set(key, 'an answer', 'model-a')
    expect(answerCache.get(key)?.answer).toBe('an answer')

    vi.setSystemTime(new Date('2026-01-01T09:30:00Z'))
    // Reading it makes it worthless, so there is nothing left to sweep.
    expect(answerCache.get(key)).toBeNull()
    expect(answerCache.sweep()).toBe(0)

    vi.useRealTimers()
  })

  it('sweeps what the clock made worthless while Klyro was closed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-01T09:00:00Z'))
    answerCache.clear()
    const key = answerCache.key('model-b', 'another question', 'capture')
    answerCache.set(key, 'an answer from February', 'model-b')

    vi.setSystemTime(new Date('2026-02-01T12:00:00Z'))
    expect(answerCache.sweep()).toBeGreaterThan(0)
    expect(JSON.stringify(answerCache.get(key))).not.toContain('an answer from February')

    vi.useRealTimers()
  })
})
