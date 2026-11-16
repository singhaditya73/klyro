import { describe, expect, it } from 'vitest'
import { extractSpeakerAndText, generateCatchUpBriefing } from './catchup'

describe('catchup intelligence engine', () => {
  it('extracts speaker and text from tagged transcript lines', () => {
    const res1 = extractSpeakerAndText('[Alice Smith]: Let us begin the architecture review.')
    expect(res1.speaker).toBe('Alice Smith')
    expect(res1.text).toBe('Let us begin the architecture review.')

    const res2 = extractSpeakerAndText('No speaker tag here')
    expect(res2.speaker).toBeUndefined()
    expect(res2.text).toBe('No speaker tag here')
  })

  it('handles empty transcript gracefully', () => {
    const briefing = generateCatchUpBriefing([])
    expect(briefing.totalLinesAnalyzed).toBe(0)
    expect(briefing.missedSummary).toContain('just begun')
    expect(briefing.activeTopic.topic).toContain('Opening')
  })

  it('synthesizes missed discussion, key decisions, and active topic', () => {
    const transcript = [
      '[Sarah]: Welcome everyone to the Q4 product sync.',
      '[Bob]: We already agreed to approve the enterprise pilot for 20 seats.',
      '[Dave]: Confirmed, the security team reviewed the SOC 2 whitepaper.',
      '[Alice]: Can we discuss the pricing tiers and per-seat discount structure?',
      '[Bob]: Yes, what is our target budget for this quarter?'
    ]

    const briefing = generateCatchUpBriefing(transcript)

    expect(briefing.totalLinesAnalyzed).toBe(5)
    expect(briefing.speakersInvolved).toContain('Sarah')
    expect(briefing.speakersInvolved).toContain('Bob')
    expect(briefing.speakersInvolved).toContain('Alice')

    // Key decisions detected
    expect(briefing.keyDecisions.length).toBeGreaterThan(0)
    expect(briefing.keyDecisions.some((d) => d.includes('enterprise pilot'))).toBe(true)

    // Active topic detected from recent lines
    expect(briefing.activeTopic.topic).toContain('Commercial terms, pricing')
    expect(briefing.activeTopic.lastSpeaker).toBe('Bob')
    expect(briefing.activeTopic.suggestedContribution).toContain('ROI')
  })

  it('detects technical architecture topic when discussing databases/APIs', () => {
    const transcript = [
      '[Engineer 1]: How does the API integration handle latency spikes?',
      '[Engineer 2]: We deploy a distributed caching layer across regions.'
    ]

    const briefing = generateCatchUpBriefing(transcript)
    expect(briefing.activeTopic.topic).toContain('Technical architecture')
    expect(briefing.activeTopic.suggestedContribution).toContain('integration')
  })
})

