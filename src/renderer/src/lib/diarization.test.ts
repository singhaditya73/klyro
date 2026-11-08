import { describe, expect, it } from 'vitest'
import {
  cosineSimilarity,
  extractSpectralVector,
  SpeakerDiarizer
} from './diarization'

describe('Speaker Diarization Engine', () => {
  it('calculates cosine similarity correctly', () => {
    const v1 = [1, 0, 0, 0]
    const v2 = [1, 0, 0, 0]
    const v3 = [0, 1, 0, 0]
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0)
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0.0)
  })

  it('extracts normalized 8-band spectral vectors', () => {
    const fakeFft = new Uint8Array(128)
    for (let i = 0; i < 16; i++) {
      fakeFft[i] = 200 // Energy in low vocal fundamental bands
    }
    const vec = extractSpectralVector(fakeFft)
    expect(vec.length).toBe(8)
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
    expect(norm).toBeCloseTo(1.0)
    expect(vec[0]).toBeGreaterThan(vec[7])
  })

  it('identifies local user when microphone dominates', () => {
    const diarizer = new SpeakerDiarizer()
    const result = diarizer.identifySpeaker(0.12, 0.01)
    expect(result.isYou).toBe(true)
    expect(result.label).toBe('You')
    expect(result.confidence).toBeGreaterThan(0.9)
  })

  it('separates multiple distinct remote attendees into clusters', () => {
    const diarizer = new SpeakerDiarizer()
    diarizer.setAttendees(['Alice Smith', 'Bob Jones', 'Carol White'])

    // Attendee 1: High fundamental pitch (e.g., female voice, high spectral bands)
    const fft1 = new Uint8Array(128)
    for (let i = 24; i < 48; i++) fft1[i] = 250

    const a1 = diarizer.identifySpeaker(0.002, 0.08, fft1)
    expect(a1.isYou).toBe(false)
    expect(a1.label).toBe('Alice Smith')

    // Attendee 2: Low fundamental pitch (e.g., deep male voice, low spectral bands)
    const fft2 = new Uint8Array(128)
    for (let i = 0; i < 16; i++) fft2[i] = 250

    const a2 = diarizer.identifySpeaker(0.002, 0.09, fft2)
    expect(a2.isYou).toBe(false)
    expect(a2.label).toBe('Bob Jones')
    expect(a2.speakerId).not.toBe(a1.speakerId)

    // Speaking again with same acoustic signature re-identifies Attendee 1
    const a1Again = diarizer.identifySpeaker(0.001, 0.07, fft1)
    expect(a1Again.speakerId).toBe(a1.speakerId)
    expect(a1Again.label).toBe('Alice Smith')
  })

  it('adapts speaker names from self-introduction in transcripts', () => {
    const diarizer = new SpeakerDiarizer()
    const fft = new Uint8Array(128)
    for (let i = 8; i < 24; i++) fft[i] = 220

    const assigned = diarizer.identifySpeaker(0.001, 0.06, fft)
    expect(assigned.label).toBe('Speaker 1')

    diarizer.adaptSpeakerNames("Hi everyone, this is Jessica from engineering.")
    const stats = diarizer.getSpeakerStats()
    const jessica = stats.find((s) => s.id === assigned.speakerId)
    expect(jessica?.label).toBe('Jessica')
  })

  it('tracks talk time and word distribution across speakers', () => {
    const diarizer = new SpeakerDiarizer()
    diarizer.recordSpeakerWords('you', 60)
    diarizer.recordSpeakerWords('speaker_1', 40)

    const stats = diarizer.getSpeakerStats()
    expect(stats.length).toBe(2)
    const you = stats.find((s) => s.id === 'you')
    const attendee = stats.find((s) => s.id === 'speaker_1')
    expect(you?.talkPct).toBe(60)
    expect(attendee?.talkPct).toBe(40)
  })
})
