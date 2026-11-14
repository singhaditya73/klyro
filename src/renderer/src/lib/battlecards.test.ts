import { describe, expect, it } from 'vitest'
import {
  detectBattlecard,
  COMPETITOR_BATTLECARDS
} from './battlecards'

describe('battlecards engine', () => {
  it('returns null for empty or short text', () => {
    expect(detectBattlecard('')).toBeNull()
    expect(detectBattlecard('hi')).toBeNull()
    expect(detectBattlecard('yes ok')).toBeNull()
  })

  it('detects Gong competitor mention and returns battlecard', () => {
    const match = detectBattlecard('We currently use Gong for recording our team calls.')
    expect(match).not.toBeNull()
    expect(match?.battlecard.id).toBe('gong')
    expect(match?.battlecard.category).toBe('competitor')
    expect(match?.battlecard.title).toBe(COMPETITOR_BATTLECARDS.gong.title)
    expect(match?.battlecard.trapQuestion).toContain('bot accounts')
  })

  it('detects Fireflies competitor mention', () => {
    const match = detectBattlecard('Our sales team has fireflies.ai running right now.')
    expect(match).not.toBeNull()
    expect(match?.battlecard.id).toBe('fireflies')
    expect(match?.battlecard.category).toBe('competitor')
  })

  it('detects Otter competitor mention', () => {
    const match = detectBattlecard('Is this similar to otter?')
    expect(match).not.toBeNull()
    expect(match?.battlecard.id).toBe('otter')
  })

  it('detects Salesforce Einstein mention', () => {
    const match = detectBattlecard('We already have Salesforce Einstein rolled out to reps.')
    expect(match).not.toBeNull()
    expect(match?.battlecard.id).toBe('salesforce')
  })

  it('detects HubSpot Breeze mention', () => {
    const match = detectBattlecard('Our marketing team prefers HubSpot breeze.')
    expect(match).not.toBeNull()
    expect(match?.battlecard.id).toBe('hubspot')
  })

  it('detects pricing & budget objections', () => {
    const match = detectBattlecard('Honestly this seems too expensive for our current tier.')
    expect(match).not.toBeNull()
    expect(match?.battlecard.id).toBe('obj_pricing')
    expect(match?.battlecard.category).toBe('pricing')
    expect(match?.battlecard.trapQuestion).toContain('manual CRM logging')
  })

  it('detects security & compliance objections', () => {
    const match = detectBattlecard('Our compliance team has a strict SOC 2 requirement.')
    expect(match).not.toBeNull()
    expect(match?.battlecard.id).toBe('obj_security')
    expect(match?.battlecard.category).toBe('security')
    expect(match?.battlecard.keyPoints.some((p) => p.includes('Local-first'))).toBe(true)
  })

  it('detects timing & delay objections', () => {
    const match = detectBattlecard('We are too busy right now, let us revisit this next quarter.')
    expect(match).not.toBeNull()
    expect(match?.battlecard.id).toBe('obj_timing')
    expect(match?.battlecard.category).toBe('timing')
  })

  it('detects integration objections', () => {
    const match = detectBattlecard('Does it integrate with our internal systems?')
    expect(match).not.toBeNull()
    expect(match?.battlecard.id).toBe('obj_integration')
    expect(match?.battlecard.category).toBe('integration')
  })
})
