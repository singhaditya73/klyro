import { describe, expect, it } from 'vitest'
import { detectLiveActionItem, inferCommitmentCategory } from './commitments'

describe('Streaming Commitment & Action-Item Detector', () => {
  it('extracts first-person promise with a deadline', () => {
    const text = "I'll deploy the updated schema by Friday"
    const action = detectLiveActionItem(text, 'Aditya')
    expect(action).not.toBeNull()
    expect(action?.task).toContain('Deploy the updated schema')
    expect(action?.owner).toBe('Aditya')
    expect(action?.deadline?.toLowerCase()).toBe('by friday')
    expect(action?.category).toBe('technical')
  })

  it('extracts second-person assignment with speaker name', () => {
    const text = 'Sarah, can you follow up with the customer by tomorrow morning?'
    const action = detectLiveActionItem(text, 'Alex')
    expect(action).not.toBeNull()
    expect(action?.owner).toBe('Sarah')
    expect(action?.task).toContain('Follow up with the customer')
    expect(action?.deadline?.toLowerCase()).toBe('by tomorrow morning')
    expect(action?.category).toBe('follow_up')
  })

  it('extracts commercial commitments', () => {
    const text = 'I will send the revised pricing proposal before EOD'
    const action = detectLiveActionItem(text, 'You')
    expect(action).not.toBeNull()
    expect(action?.task).toContain('Send the revised pricing proposal')
    expect(action?.category).toBe('commercial')
    expect(action?.deadline?.toLowerCase()).toBe('before eod')
  })

  it('extracts collaborative commitments with team ownership', () => {
    const text = "Let's schedule a follow-up sync next week"
    const action = detectLiveActionItem(text, 'Dave')
    expect(action).not.toBeNull()
    expect(action?.owner).toBe('Team')
    expect(action?.task).toContain('Schedule a follow-up sync')
    expect(action?.category).toBe('follow_up')
    expect(action?.deadline?.toLowerCase()).toBe('next week')
  })

  it('ignores standard non-committal chatter and pure inquiries', () => {
    expect(detectLiveActionItem('What do you think about the weather today?')).toBeNull()
    expect(detectLiveActionItem('Yes I agree with that point.')).toBeNull()
    expect(detectLiveActionItem('Thanks everyone for joining today.')).toBeNull()
  })

  it('categorizes correctly into technical, commercial, follow-up, and decision', () => {
    expect(inferCommitmentCategory('fix the kubernetes ingress deployment')).toBe('technical')
    expect(inferCommitmentCategory('send the contract and pricing tier breakdown')).toBe('commercial')
    expect(inferCommitmentCategory('schedule a calendar sync with marketing')).toBe('follow_up')
    expect(inferCommitmentCategory('agree on the launch architecture')).toBe('decision')
  })
})

