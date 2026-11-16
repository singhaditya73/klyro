// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  detectFollowUpDate,
  generateGoogleCalendarUrl,
  generateOutlookWebUrl,
  generateIcsContent
} from './calendar-scheduler'

describe('calendar scheduler', () => {
  it('detects follow-up timing from natural language "tomorrow at 3 PM"', () => {
    const detected = detectFollowUpDate('Let us reconnect tomorrow at 3 PM to review the proposal')
    expect(detected).not.toBeNull()
    expect(detected?.confidence).toBe('high')
    expect(detected?.rawMatch).toContain('tomorrow at 3 PM')
    expect(detected?.suggestedDate.getHours()).toBe(15)
  })

  it('detects timing from "next tuesday at 10 am"', () => {
    const detected = detectFollowUpDate('We agreed to sync next Tuesday at 10 AM')
    expect(detected).not.toBeNull()
    expect(detected?.rawMatch).toContain('next Tuesday at 10 AM')
    expect(detected?.suggestedDate.getHours()).toBe(10)
    expect(detected?.suggestedDate.getDay()).toBe(2) // Tuesday is day 2
  })

  it('detects relative delay "in two weeks"', () => {
    const detected = detectFollowUpDate('Let us table this and revisit in two weeks')
    expect(detected).not.toBeNull()
    expect(detected?.rawMatch).toBe('in two weeks')
    expect(detected?.confidence).toBe('medium')
  })

  it('returns null when no timing pattern is present', () => {
    expect(detectFollowUpDate('Thanks for the great call today')).toBeNull()
  })

  it('generates valid Google Calendar URL with encoded parameters', () => {
    const startTime = new Date('2026-11-20T15:00:00Z')
    const endTime = new Date('2026-11-20T15:30:00Z')
    const url = generateGoogleCalendarUrl({
      title: 'Acme <> Klyro Demo Follow-Up',
      description: 'Discuss pilot contract and architecture deep dive.',
      location: 'Zoom',
      startTime,
      endTime,
      attendees: ['alice@acme.com', 'bob@acme.com']
    })

    expect(url).toContain('https://calendar.google.com/calendar/render?action=TEMPLATE')
    expect(url).toContain('text=Acme+%3C%3E+Klyro+Demo+Follow-Up')
    expect(url).toContain('location=Zoom')
    expect(url).toContain('add=alice%40acme.com%2Cbob%40acme.com')
  })

  it('generates valid Outlook Web URL', () => {
    const startTime = new Date('2026-11-20T15:00:00Z')
    const endTime = new Date('2026-11-20T15:30:00Z')
    const url = generateOutlookWebUrl({
      title: 'Technical Review',
      description: 'Review architecture',
      startTime,
      endTime,
      attendees: ['alice@acme.com']
    })

    expect(url).toContain('https://outlook.live.com/calendar/0/deeplink/compose')
    expect(url).toContain('subject=Technical+Review')
  })

  it('generates standard RFC 5545 iCalendar (.ics) string', () => {
    const startTime = new Date('2026-11-20T15:00:00Z')
    const endTime = new Date('2026-11-20T15:30:00Z')
    const ics = generateIcsContent({
      title: 'Partnership Sync',
      description: 'Review action items and deployment.',
      location: 'Google Meet',
      startTime,
      endTime,
      attendees: ['dave@client.com']
    })

    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('SUMMARY:Partnership Sync')
    expect(ics).toContain('LOCATION:Google Meet')
    expect(ics).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:dave@client.com')
    expect(ics).toContain('END:VEVENT')
    expect(ics).toContain('END:VCALENDAR')
  })
})

