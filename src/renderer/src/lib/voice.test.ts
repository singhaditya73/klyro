// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  isSpeech,
  utteranceEnded,
  utteranceWorthAsking,
  VOICE_SILENCE_MS,
  VOICE_SPEECH_THRESHOLD
} from './listen'

describe('conversation mode voice activity', () => {
  it('treats loud sound as speech and quiet sound as room noise', () => {
    expect(isSpeech(VOICE_SPEECH_THRESHOLD)).toBe(true)
    expect(isSpeech(VOICE_SPEECH_THRESHOLD + 0.05)).toBe(true)
    expect(isSpeech(VOICE_SPEECH_THRESHOLD - 0.001)).toBe(false)
    expect(isSpeech(0)).toBe(false)
  })

  it('ends an utterance only after a real pause', () => {
    expect(utteranceEnded(true, 0)).toBe(false)
    expect(utteranceEnded(true, VOICE_SILENCE_MS - 1)).toBe(false)
    expect(utteranceEnded(true, VOICE_SILENCE_MS)).toBe(true)
    // Not speaking: nothing to end.
    expect(utteranceEnded(false, 10_000)).toBe(false)
  })

  it('ignores taps and coughs as questions', () => {
    expect(utteranceWorthAsking(200)).toBe(false)
    expect(utteranceWorthAsking(600)).toBe(true)
  })
})
