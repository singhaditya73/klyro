import { describe, expect, it } from 'vitest'
import {
  formatCrmPayload,
  dispatchCrmDeal,
  generateMailtoUri,
  CrmDealPayload
} from './crm-dispatch'

describe('CRM Dispatch & Ghost Email Engine', () => {
  const sampleDeal: CrmDealPayload = {
    company: 'Stripe',
    dealName: 'Stripe - Global Infrastructure License',
    dealStage: 'Contract Review',
    dealAmount: '$48,000 ARR',
    dealCloseDate: '2026-12-15',
    dealNextSteps: 'Send revised SOC2 report and Master Service Agreement',
    executiveSummary: 'Discussed high-concurrency payment routing and compliance.',
    keyDecisions: ['Selected enterprise tier', 'Multi-region deployment required'],
    actionItems: [{ task: 'Send revised agreement', owner: 'Aditya', deadline: 'Thursday' }],
    hesitationScore: 24
  }

  it('formats HubSpot v3 deals payload correctly', () => {
    const payload = formatCrmPayload('hubspot', sampleDeal)
    expect(payload).toHaveProperty('properties')
    const props = (payload as { properties: Record<string, unknown> }).properties
    expect(props.dealname).toBe('Stripe - Global Infrastructure License')
    expect(props.amount).toBe('48000')
    expect(props.closedate).toBe('2026-12-15')
    expect(props.buyer_hesitation_index).toBe(24)
  })

  it('formats Salesforce Opportunities SObject payload correctly', () => {
    const payload = formatCrmPayload('salesforce', sampleDeal)
    expect(payload.Name).toBe('Stripe - Global Infrastructure License')
    expect(payload.Amount).toBe(48000)
    expect(payload.StageName).toBe('Contract Review')
  })

  it('formats Notion Database Page payload correctly', () => {
    const payload = formatCrmPayload('notion', sampleDeal)
    expect(payload).toHaveProperty('properties')
    const props = (payload as { properties: Record<string, unknown> }).properties
    expect(props).toHaveProperty('Name')
    expect(props).toHaveProperty('Stage')
    expect(props).toHaveProperty('Amount')
  })

  it('formats generic Webhook payload with full telemetry', () => {
    const payload = formatCrmPayload('webhook', sampleDeal)
    expect(payload.event).toBe('gtm.deal.dispatched')
    expect((payload as { deal: { amountParsed: number } }).deal.amountParsed).toBe(48000)
    expect((payload as { buyerAcoustics: { hesitationScore: number } }).buyerAcoustics.hesitationScore).toBe(24)
  })

  it('generates an RFC-compliant mailto URI', () => {
    const uri = generateMailtoUri({
      to: 'buyer@stripe.com',
      subject: 'Recap: Stripe Infrastructure',
      bodyText: 'Hi Team,\nThank you for today.',
      company: 'Stripe',
      keyDecisions: [],
      actionItems: []
    })

    expect(uri).toContain('mailto:buyer%40stripe.com')
    expect(uri).toContain('subject=Recap%3A%20Stripe%20Infrastructure')
    expect(uri).toContain('body=Hi%20Team%2C%0AThank%20you%20for%20today.')
  })

  it('handles network dispatch failures gracefully', async () => {
    const result = await dispatchCrmDeal(
      {
        platform: 'hubspot',
        webhookUrl: 'https://invalid-non-existent-domain-12345.xyz/webhook'
      },
      sampleDeal
    )

    expect(result.success).toBe(false)
    expect(result.platform).toBe('hubspot')
  })
})
