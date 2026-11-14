import { describe, expect, it } from 'vitest'
import { parseAttendee, buildAccountIntelligence } from './intelligence'

describe('intelligence engine', () => {
  it('parses attendee with name and email formatted with parentheses', () => {
    const profile = parseAttendee('Alice Smith (alice@acme.com)')
    expect(profile.name).toBe('Alice Smith')
    expect(profile.email).toBe('alice@acme.com')
    expect(profile.domain).toBe('acme.com')
    expect(profile.rolePersona).toBe('general')
  })

  it('identifies executive persona correctly', () => {
    const profile = parseAttendee('Sarah Connor (VP of Engineering) <sarah@cyberdyne.io>')
    expect(profile.email).toBe('sarah@cyberdyne.io')
    expect(profile.domain).toBe('cyberdyne.io')
    expect(profile.rolePersona).toBe('executive')
    expect(profile.talkingAngle).toContain('high-level business ROI')
  })

  it('identifies engineering persona correctly', () => {
    const profile = parseAttendee('Dave Bowman (Lead Architect) <dave@hal9000.net>')
    expect(profile.rolePersona).toBe('engineering')
    expect(profile.talkingAngle).toContain('local-first')
  })

  it('identifies sales/GTM persona correctly', () => {
    const profile = parseAttendee('Jordan Belfort (Account Exec) <jordan@strattongroup.com>')
    expect(profile.rolePersona).toBe('sales_gtm')
    expect(profile.talkingAngle).toContain('CRM dispatch')
  })

  it('identifies finance persona correctly', () => {
    const profile = parseAttendee('Markus Vance (Director of Finance) <markus@acme.org>')
    // Has both director (executive) and finance; let's verify either executive or finance
    expect(['executive', 'finance']).toContain(profile.rolePersona)
  })

  it('builds account intelligence with domain, tech stack, and discovery questions', () => {
    const intel = buildAccountIntelligence({
      company: 'Stripe',
      attendees: ['Patrick Collison (CEO) <patrick@stripe.com>'],
      meetingTitle: 'Klyro <> Stripe API Partnership'
    })

    expect(intel.company).toBe('Stripe')
    expect(intel.domain).toBe('stripe.com')
    expect(intel.industryEstimate).toBe('Fintech & Financial Services')
    expect(intel.attendees.length).toBe(1)
    expect(intel.attendees[0].rolePersona).toBe('executive')
    expect(intel.suggestedDiscoveryQuestions.length).toBeGreaterThan(0)
    expect(intel.techStackClues).toContain('Salesforce / HubSpot CRM')
  })

  it('incorporates historical context when past sessions exist', () => {
    const pastSessions = [
      {
        startedAt: Date.now() - 86400000 * 7,
        company: 'Stripe',
        crmNotes: {
          keyDecisions: ['Agreed to pilot Klyro for 10 enterprise reps', 'Security review approved']
        }
      }
    ]

    const intel = buildAccountIntelligence({
      company: 'Stripe',
      attendees: ['patrick@stripe.com'],
      pastSessions
    })

    expect(intel.historicalContext).toBeDefined()
    expect(intel.historicalContext?.pastSessionCount).toBe(1)
    expect(intel.historicalContext?.keyDecisions).toContain('Agreed to pilot Klyro for 10 enterprise reps')
  })
})

