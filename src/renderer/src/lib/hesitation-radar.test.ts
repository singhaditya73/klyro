import { describe, expect, it } from 'vitest'
import {
  analyzeBuyerHesitation,
  countFillers,
  detectTopicDomain,
  calculateWpm
} from './hesitation-radar'

describe('Buyer Hesitation & Intent Heatmap Engine', () => {
  it('correctly categorizes commercial topics', () => {
    expect(detectTopicDomain('What is your annual enterprise pricing structure?')).toBe('pricing')
    expect(detectTopicDomain('I need to run this by our CFO and legal committee')).toBe('authority')
    expect(detectTopicDomain('Can we have a go-live by Q3 next month?')).toBe('timeline')
    expect(detectTopicDomain('Are you certified for SOC2 Type II and GDPR?')).toBe('security')
    expect(detectTopicDomain('The weather in New York is quite nice today.')).toBe('general')
  })

  it('counts verbal filler disfluencies accurately', () => {
    expect(countFillers('Yeah, uh, we kind of like it, but, um, you know...')).toBe(4)
    expect(countFillers('We will sign the agreement tomorrow morning.')).toBe(0)
  })

  it('calculates words per minute (WPM)', () => {
    // 30 words in 15 seconds (0.25 min) = 120 WPM
    expect(calculateWpm(30, 15000)).toBe(120)
    // 40 words in 12 seconds (0.20 min) = 200 WPM
    expect(calculateWpm(40, 12000)).toBe(200)
  })

  it('detects high hesitation on delayed pricing answers with filler bursts', () => {
    const analysis = analyzeBuyerHesitation({
      text: 'Well, um, the price seems, uh, sort of high for our current budget.',
      latencyMs: 1250, // 1.25s delay
      durationMs: 8000, // 12 words in 8 seconds = 90 WPM
      pauseCount: 3,
      maxPauseMs: 850,
      energyDecay: true
    })

    expect(analysis.level).toBe('hesitant')
    expect(analysis.score).toBeGreaterThanOrEqual(68)
    expect(analysis.topicCategory).toBe('pricing')
    expect(analysis.tacticalCue).toContain('pricing')
    expect(analysis.indicators.some((i) => i.type === 'latency')).toBe(true)
    expect(analysis.indicators.some((i) => i.type === 'fillers')).toBe(true)
  })

  it('identifies decisive, fluent conviction with fast latency and fluid speech', () => {
    const analysis = analyzeBuyerHesitation({
      text: 'That completely meets our technical requirements. We are ready to proceed.',
      latencyMs: 200,
      durationMs: 4000, // 11 words in 4s = 165 WPM
      pauseCount: 0,
      maxPauseMs: 100,
      energyDecay: false
    })

    expect(analysis.level).toBe('decisive')
    expect(analysis.score).toBeLessThanOrEqual(25)
    expect(analysis.tacticalCue).toContain('conviction')
  })

  it('evaluates guarded hesitation on authority and committee approval', () => {
    const analysis = analyzeBuyerHesitation({
      text: 'Well, I will have to, um, check with our VP and board committee first.',
      latencyMs: 800,
      durationMs: 5500,
      pauseCount: 2,
      maxPauseMs: 550
    })

    expect(['guarded', 'hesitant']).toContain(analysis.level)
    expect(analysis.topicCategory).toBe('authority')
    expect(analysis.tacticalCue).toContain('authority')
  })
})

