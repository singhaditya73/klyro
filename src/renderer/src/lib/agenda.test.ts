import { describe, expect, it } from 'vitest'
import { parseAgendaItems, checkAgendaProgress } from './agenda'

describe('Meeting Agenda Parser & Discussion Tracker', () => {
  it('parses numbered and bulleted agenda items from description', () => {
    const description = `
Weekly Engineering Sync
Agenda:
1. Kubernetes cluster migration
2. Database connection pooling
- Release schedule for v1.0
* Open Q&A and blockers
    `
    const items = parseAgendaItems(description)
    expect(items.length).toBe(4)
    expect(items[0].title).toBe('Kubernetes cluster migration')
    expect(items[1].title).toBe('Database connection pooling')
    expect(items[2].title).toBe('Release schedule for v1.0')
    expect(items[3].title).toBe('Open Q&A and blockers')
    expect(items.every((i) => !i.addressed)).toBe(true)
  })

  it('falls back to structured meeting title if description is empty', () => {
    const title = 'Customer Sync: Stripe Billing Integration - Migration Roadmap'
    const items = parseAgendaItems(undefined, title)
    expect(items.length).toBe(2)
    expect(items[0].title).toBe('Stripe Billing Integration')
    expect(items[1].title).toBe('Migration Roadmap')
  })

  it('marks agenda items as addressed when spoken in transcript', () => {
    const items = parseAgendaItems(`
1. Kubernetes cluster migration
2. Payment gateway webhooks
    `)
    expect(items[0].addressed).toBe(false)

    // Transcript line discussing topic 1
    const { updated, newlyAddressed } = checkAgendaProgress(
      items,
      'We should discuss the kubernetes cluster migration timeline'
    )
    expect(updated[0].addressed).toBe(true)
    expect(updated[1].addressed).toBe(false)
    expect(newlyAddressed?.id).toBe(items[0].id)
  })

  it('leaves already addressed items unchanged', () => {
    const items = parseAgendaItems('1. Stripe Billing')
    const { updated: firstPass } = checkAgendaProgress(items, 'Let us talk about Stripe billing')
    expect(firstPass[0].addressed).toBe(true)

    const { updated: secondPass, newlyAddressed } = checkAgendaProgress(
      firstPass,
      'Still talking about Stripe billing'
    )
    expect(secondPass[0].addressed).toBe(true)
    expect(newlyAddressed).toBeNull()
  })
})

