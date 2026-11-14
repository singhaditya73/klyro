// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { GtmDispatchModal } from './GtmDispatchModal'
import type { MeetingCrmNotes } from '@shared/types'

afterEach(cleanup)

const mockCrmNotes: MeetingCrmNotes = {
  title: 'Acme Corp - Enterprise Evaluation',
  type: 'client_call',
  executiveSummary: 'Discussed migrating enterprise sales reps to Klyro local-first copilot.',
  keyDecisions: [
    'Agreed to 30-day pilot for 15 enterprise reps',
    'SOC 2 compliance package sent to security review'
  ],
  discussionTopics: ['Security', 'Pricing', 'CRM integration'],
  actionItems: [
    { task: 'Send MSA and security architecture whitepaper', owner: 'Dave', deadline: 'Friday' },
    { task: 'Provision staging API keys for pilot team', owner: 'Alice' }
  ],
  model: 'gpt-4o',
  generatedAt: Date.now()
}

describe('GtmDispatchModal', () => {
  it('renders null when isOpen is false', () => {
    const { container } = render(
      <GtmDispatchModal
        isOpen={false}
        onClose={vi.fn()}
        company="Acme Corp"
        crmNotes={mockCrmNotes}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders all 4 staging cards with pre-populated values', () => {
    render(
      <GtmDispatchModal
        isOpen={true}
        onClose={vi.fn()}
        company="Acme Corp"
        role="VP Engineering"
        crmNotes={mockCrmNotes}
      />
    )

    expect(screen.getByText('Autonomous GTM Staging Deck')).toBeTruthy()
    expect(screen.getByText('Human-in-the-Loop Review')).toBeTruthy()

    // 4 Cards
    expect(screen.getByText(/1\. CRM Deal & Pipeline Update/i)).toBeTruthy()
    expect(screen.getByText(/2\. Executive Follow-up Email/i)).toBeTruthy()
    expect(screen.getByText(/3\. Internal Team Briefing \(Slack \/ Teams\)/i)).toBeTruthy()
    expect(screen.getByText(/4\. Engineering & CS Tasks/i)).toBeTruthy()

    // Pre-filled values
    expect(screen.getByText('Acme Corp - Enterprise Evaluation')).toBeTruthy()
    expect(screen.getByText('4 of 4')).toBeTruthy()
  })

  it('allows toggling inline edit mode on cards', async () => {
    render(
      <GtmDispatchModal
        isOpen={true}
        onClose={vi.fn()}
        company="Acme Corp"
        crmNotes={mockCrmNotes}
      />
    )

    const editDealBtn = screen.getByText('Edit Deal')
    fireEvent.click(editDealBtn)

    expect(screen.getByText('Done Editing')).toBeTruthy()
    expect(screen.getByLabelText(/Deal Name/i) || screen.getByDisplayValue('Acme Corp - Enterprise Evaluation')).toBeTruthy()
  })

  it('dispatches selected records and displays verification confirmation', async () => {
    render(
      <GtmDispatchModal
        isOpen={true}
        onClose={vi.fn()}
        company="Acme Corp"
        crmNotes={mockCrmNotes}
      />
    )

    const dispatchBtn = screen.getByRole('button', { name: /Approve & Dispatch All/i })
    fireEvent.click(dispatchBtn)

    // Verification banner
    expect(await screen.findByText('GTM Pipeline Dispatched Successfully')).toBeTruthy()
  })
})

