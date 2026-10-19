import { chunkHasSpeech, rmsFromTimeDomain } from './listen'
import { describe, expect, it } from 'vitest'
import {
  LISTEN_NO_ANSWER,
  isNoAnswer,
  listenPrompt,
  looksLikeQuestion,
  snippetPrompt
} from './listen'

describe('looksLikeQuestion', () => {
  it('catches explicit question marks', () => {
    expect(looksLikeQuestion('so what is your biggest competitor here?')).toBe(true)
    // A timestamp marker does not rescue a statement from being a statement.
    expect(looksLikeQuestion('[00:12] and that covers the roadmap for q3')).toBe(false)
  })

  it('catches interrogative phrasing without a mark', () => {
    expect(looksLikeQuestion('tell me about the pricing model you are planning')).toBe(true)
    expect(looksLikeQuestion('walk me through the architecture decisions')).toBe(true)
  })

  it('ignores statements, chatter, and fragments', () => {
    expect(looksLikeQuestion('yeah we are planning to launch that in the spring')).toBe(false)
    expect(looksLikeQuestion('um')).toBe(false)
    expect(looksLikeQuestion('')).toBe(false)
    expect(looksLikeQuestion('the series b discussions started last year')).toBe(false)
  })
})

describe('prompts', () => {
  it('frames a snippet as a question to answer', () => {
    const prompt = snippetPrompt('  who else does this?  ')
    expect(prompt).toContain('who else does this?')
    expect(prompt).toContain('Answer it directly')
  })

  it('frames a transcript tail and falls back to a dash when nothing is asked', () => {
    const prompt = listenPrompt(['good morning everyone', 'what do you charge for this?'])
    expect(prompt).toContain('what do you charge for this?')
    expect(prompt).toContain(LISTEN_NO_ANSWER)
    expect(isNoAnswer('  —  ')).toBe(true)
    expect(isNoAnswer('We charge a flat fee.')).toBe(false)
  })
})

describe('silence gate', () => {
  it('computes RMS from AnalyserNode time-domain bytes', () => {
    const silence = new Uint8Array(2048).fill(128)
    expect(rmsFromTimeDomain(silence)).toBe(0)

    const loud = new Uint8Array(2048).fill(88) // deviation 40/128 ≈ 0.31
    expect(rmsFromTimeDomain(loud)).toBeCloseTo(40 / 128, 2)

    expect(rmsFromTimeDomain(new Uint8Array(0))).toBe(0)
  })

  it('skips only chunks whose whole window was silent', () => {
    const now = 1_000_000
    const chunkMs = 20_000
    // Voiced inside the window → transcribe.
    expect(chunkHasSpeech(now - 3_000, now, chunkMs)).toBe(true)
    expect(chunkHasSpeech(now - (chunkMs + 2_000), now, chunkMs)).toBe(true)
    // Older than the window plus grace → skip.
    expect(chunkHasSpeech(now - (chunkMs + 3_000), now, chunkMs)).toBe(false)
    // Unknown (never voiced) → skip, saving the request.
    expect(chunkHasSpeech(0, now, chunkMs)).toBe(false)
  })
})
