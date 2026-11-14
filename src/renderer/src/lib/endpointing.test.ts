import { describe, expect, it } from 'vitest'
import {
  CADENCE_BASE_MS,
  analyzeSemanticCompleteness,
  calculateDynamicSilence,
  computeZeroCrossingRate,
  estimatePitch,
  isAcousticVoice,
  ProsodyTracker
} from './endpointing'

describe('Semantic Turn Analysis', () => {
  it('detects thinking fillers and extends pause threshold', () => {
    const r1 = analyzeSemanticCompleteness('I was thinking about, um')
    expect(r1.status).toBe('thinking')
    expect(r1.silenceMs).toBeGreaterThan(CADENCE_BASE_MS.balanced)

    const r2 = analyzeSemanticCompleteness('the main issue is, uh')
    expect(r2.status).toBe('thinking')

    const r3 = analyzeSemanticCompleteness('wait let me think')
    expect(r3.status).toBe('thinking')

    const r4 = analyzeSemanticCompleteness('it should be kind of')
    expect(r4.status).toBe('thinking')
  })

  it('detects trailing conjunctions and connectors as incomplete', () => {
    const r1 = analyzeSemanticCompleteness('We need to deploy this because')
    expect(r1.status).toBe('incomplete')
    expect(r1.silenceMs).toBeGreaterThan(CADENCE_BASE_MS.balanced)

    const r2 = analyzeSemanticCompleteness('I want to use Postgres and')
    expect(r2.status).toBe('incomplete')

    const r3 = analyzeSemanticCompleteness('The cluster restarted and then')
    expect(r3.status).toBe('incomplete')

    const r4 = analyzeSemanticCompleteness('We can scale horizontally or')
    expect(r4.status).toBe('incomplete')
  })

  it('detects trailing prepositions as incomplete', () => {
    const r1 = analyzeSemanticCompleteness('Can you explain to')
    expect(r1.status).toBe('incomplete')
    expect(r1.reason).toContain('preposition')

    const r2 = analyzeSemanticCompleteness('What are the advantages of')
    expect(r2.status).toBe('incomplete')

    const r3 = analyzeSemanticCompleteness('I have a question about')
    expect(r3.status).toBe('incomplete')
  })

  it('detects trailing auxiliaries, modals, and infinitives as incomplete', () => {
    const r1 = analyzeSemanticCompleteness('If the server is')
    expect(r1.status).toBe('incomplete')

    const r2 = analyzeSemanticCompleteness('What should I')
    expect(r2.status).toBe('incomplete')

    const r3 = analyzeSemanticCompleteness('I was trying to')
    expect(r3.status).toBe('incomplete')

    const r4 = analyzeSemanticCompleteness("We haven't")
    expect(r4.status).toBe('incomplete')
  })

  it('detects trailing determiners and articles as incomplete', () => {
    const r1 = analyzeSemanticCompleteness('How do I run the')
    expect(r1.status).toBe('incomplete')

    const r2 = analyzeSemanticCompleteness('Can we inspect this')
    expect(r2.status).toBe('incomplete')
  })

  it('detects short question openers without predicate as incomplete', () => {
    const r1 = analyzeSemanticCompleteness('What is')
    expect(r1.status).toBe('incomplete')

    const r2 = analyzeSemanticCompleteness('How do')
    expect(r2.status).toBe('incomplete')
  })

  it('fast-tracks complete questions and imperative commands', () => {
    const r1 = analyzeSemanticCompleteness('What is a Kubernetes pod?')
    expect(r1.status).toBe('complete')
    expect(r1.silenceMs).toBeLessThanOrEqual(CADENCE_BASE_MS.balanced)

    const r2 = analyzeSemanticCompleteness('Explain how garbage collection works in Go')
    expect(r2.status).toBe('complete')
    expect(r2.silenceMs).toBeLessThanOrEqual(CADENCE_BASE_MS.balanced)

    const r3 = analyzeSemanticCompleteness("Thank you that's all")
    expect(r3.status).toBe('complete')
    expect(r3.silenceMs).toBeLessThanOrEqual(CADENCE_BASE_MS.balanced)
  })
})

describe('Acoustic Prosody & Pitch (F0) Tracking', () => {
  it('estimates pitch for a synthetic sine wave in human vocal range', () => {
    const sampleRate = 16000
    const freq = 200 // 200 Hz
    const length = 2048
    const pcm = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      pcm[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.8
    }

    const { pitchHz, confidence } = estimatePitch(pcm, sampleRate)
    expect(confidence).toBeGreaterThan(0.8)
    expect(Math.abs(pitchHz - freq)).toBeLessThan(5)
  })

  it('detects floor-holding intonation when pitch rises', () => {
    const tracker = new ProsodyTracker()
    const now = Date.now()

    // Base pitch around 150 Hz
    tracker.push(150, 0.8, now - 300)
    tracker.push(152, 0.8, now - 200)
    // Rising pitch at the pause (+10%)
    tracker.push(165, 0.9, now - 100)
    tracker.push(170, 0.9, now - 50)

    expect(tracker.isHoldingFloor()).toBe(true)
  })

  it('does not flag floor-holding when pitch drops or is flat', () => {
    const tracker = new ProsodyTracker()
    const now = Date.now()

    // Falling pitch (terminal fall)
    tracker.push(170, 0.8, now - 300)
    tracker.push(160, 0.8, now - 200)
    tracker.push(140, 0.9, now - 100)
    tracker.push(130, 0.9, now - 50)

    expect(tracker.isHoldingFloor()).toBe(false)
  })

  it('filters out transient noise spikes with zero crossing rate', () => {
    // Synthetic alternating noise (+1, -1, +1, -1) has maximum ZCR = 1.0
    const noise = new Float32Array(100)
    for (let i = 0; i < 100; i++) noise[i] = i % 2 === 0 ? 0.8 : -0.8
    const zcr = computeZeroCrossingRate(noise)
    expect(zcr).toBeGreaterThan(0.9)

    // High RMS but noisy clicks should be rejected
    expect(isAcousticVoice(0.05, zcr, 0)).toBe(false)

    // Speech-like PCM (moderate ZCR and high pitch confidence) should pass
    expect(isAcousticVoice(0.03, 0.15, 0.8)).toBe(true)
  })
})

describe('Dynamic Silence Calculator', () => {
  it('respects push-to-talk by returning Infinity', () => {
    const silence = calculateDynamicSilence({
      baseCadenceMs: 1600,
      pushToTalkActive: true
    })
    expect(silence).toBe(Number.POSITIVE_INFINITY)
  })

  it('combines base cadence with semantic status and prosody', () => {
    const normal = calculateDynamicSilence({
      baseCadenceMs: 1600,
      partialTranscript: 'What is Docker?'
    })
    const thinking = calculateDynamicSilence({
      baseCadenceMs: 1600,
      partialTranscript: 'I think that, um',
      isHoldingFloor: true
    })

    expect(thinking).toBeGreaterThan(normal)
    expect(thinking).toBeGreaterThan(2000)
  })
})
