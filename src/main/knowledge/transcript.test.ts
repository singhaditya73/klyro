import { describe, expect, it } from 'vitest'
import { appendSegment, isNoise, joinSegments, normalizeSegment, overlapWordCount, stripOverlap } from './transcript'

describe('transcript hygiene', () => {
  it('normalises whitespace and leading bullets', () => {
    expect(normalizeSegment('  hello   there \n')).toBe('hello there')
    expect(normalizeSegment('-  a point')).toBe('a point')
  })

  it('recognises silence artefacts but never real speech', () => {
    expect(isNoise('')).toBe(true)
    expect(isNoise('[BLANK_AUDIO]')).toBe(true)
    expect(isNoise('(inaudible)')).toBe(true)
    expect(isNoise('[Music]')).toBe(true)
    expect(isNoise('you')).toBe(true)
    expect(isNoise('Thanks for joining, Ada.')).toBe(false)
    expect(isNoise('We should ship on Friday.')).toBe(false)
  })

  it('finds the repeated words at a chunk boundary', () => {
    expect(overlapWordCount('we should ship on Friday', 'ship on Friday and then deploy')).toBe(3)
    expect(overlapWordCount('we should ship on Friday', 'yes I agree')).toBe(0)
    // Three words is the floor, so ordinary repetition is left alone.
    expect(overlapWordCount('yes yes yes', 'yes yes')).toBe(0)
  })

  it('strips the repeated prefix instead of repeating it', () => {
    expect(stripOverlap('we should ship on Friday', 'ship on Friday and then deploy')).toBe('and then deploy')
    expect(stripOverlap('nothing in common', 'a fresh sentence')).toBe('a fresh sentence')
  })

  it('appends only new, meaningful text', () => {
    let state = appendSegment([], 'The build is green')
    expect(state.added).toBe(true)
    expect(state.segments).toEqual(['The build is green'])

    state = appendSegment(state.segments, '[BLANK_AUDIO]')
    expect(state).toMatchObject({ added: false, reason: 'empty' })

    // A single repeated word is kept: at that size we cannot tell a cut boundary
    // from the speaker genuinely repeating themselves.
    state = appendSegment(state.segments, 'green and deploy is next')
    expect(state.added).toBe(true)
    expect(state.segments).toEqual(['The build is green', 'green and deploy is next'])

    state = appendSegment(state.segments, 'The build is green')
    expect(state).toMatchObject({ added: false, reason: 'duplicate' })
    expect(state.segments).toEqual(['The build is green', 'green and deploy is next'])
  })

  it('never grows a transcript with a repeated chunk from a retry', () => {
    const first = 'Ada will send the numbers to Priya'
    let state = appendSegment([], first)
    // A retried chunk returns the same audio again.
    state = appendSegment(state.segments, first)
    expect(state.added).toBe(false)
    expect(state.segments).toEqual([first])
  })

  it('joins segments into readable text', () => {
    expect(joinSegments(['one  two', 'three'])).toBe('one two three')
  })
})
