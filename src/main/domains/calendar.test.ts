import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const { userData, safeStorageState } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const { join } = require('node:path') as typeof import('node:path')
  return {
    userData: mkdtempSync(join(tmpdir(), 'klyro-calendar-test-')),
    // Flipped by the encryption test to exercise the keychain path.
    safeStorageState: { encryptionAvailable: false }
  }
})

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  // No OS keychain by default in tests: the store falls back to its documented
  // plaintext-refusal path unless the user opted in.
  safeStorage: {
    isEncryptionAvailable: () => safeStorageState.encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (value: Buffer) => {
      const text = value.toString()
      return text.startsWith('enc:') ? text.slice(4) : text
    }
  },
  desktopCapturer: {
    getSources: vi.fn().mockResolvedValue([])
  },
  powerMonitor: {
    getSystemIdleTime: vi.fn().mockReturnValue(0)
  }
}))

import {
  CalendarDomain,
  cleanMeetingTitle,
  extractCompany,
  extractMeetingUrl,
  parseICal,
  parseICalDate
} from './calendar'

function singleEvent(uid: string, start: string, end: string, extra = ''): string {
  return `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:${uid}
DTSTART:${start}
DTEND:${end}
SUMMARY:Weekly Standup
${extra}
END:VEVENT
END:VCALENDAR`
}

const NOVEMBER_WINDOW = {
  from: Date.parse('2026-11-01T00:00:00Z'),
  to: Date.parse('2026-11-30T00:00:00Z')
}

describe('CalendarDomain and iCal Parser', () => {
  it('parses iCal date formats correctly', () => {
    // UTC format
    const utcIso = parseICalDate('20261031T143000Z')
    expect(utcIso).toBe('2026-10-31T14:30:00.000Z')

    // All day date
    const dayIso = parseICalDate('20261031')
    expect(dayIso).toBe('2026-10-31T00:00:00.000Z')

    // Local time
    const localIso = parseICalDate('20261031T090000')
    expect(localIso).toBeTruthy()
    expect(localIso?.startsWith('2026-10-31')).toBe(true)

    // Null or invalid
    expect(parseICalDate('')).toBeNull()
  })

  it('extracts external company names from title and attendees', () => {
    expect(extractCompany('Product Demo with Acme Corp')).toBe('Acme Corp')
    expect(extractCompany('Acme Corp x Klyro Catchup')).toBe('Acme Corp')
    expect(extractCompany('Klyro / Acme Corp Discussion')).toBe('Acme Corp')
    expect(extractCompany('Acme Corp Demo')).toBe('Acme Corp')

    // Does not treat generic words as company
    expect(extractCompany('Weekly Team Sync')).toBe('')

    // Extracts from attendee corporate emails
    expect(extractCompany('Sync', ['Alice <alice@stripe.com>'])).toBe('Stripe')
    expect(extractCompany('Sync', ['Bob <bob@gmail.com>'])).toBe('')
  })

  it('extracts video meeting URLs', () => {
    expect(extractMeetingUrl('Join at https://meet.google.com/abc-defg-hij')).toBe(
      'https://meet.google.com/abc-defg-hij'
    )
    expect(extractMeetingUrl('Call link: https://us02web.zoom.us/j/123456789 pwd=xxx')).toBe(
      'https://us02web.zoom.us/j/123456789'
    )
    expect(extractMeetingUrl('No link here')).toBeUndefined()
  })

  it('parses full RFC 5545 iCalendar text with line folding and attendees', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VEVENT
UID:event-12345@google.com
DTSTART:20261031T100000Z
DTEND:20261031T110000Z
SUMMARY:Product Demo with Acme 
 Corp
DESCRIPTION:Discussion about Klyro integration.\\nLink: https://meet.g
 oogle.com/xyz-uvwx-rst\\nSee you there.
LOCATION:https://meet.google.com/xyz-uvwx-rst
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Alice Smith:mailto:alice@acme.com
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;CN=Bob Jones:mailto:bob@acme.com
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
UID:event-cancelled@google.com
DTSTART:20261031T120000Z
DTEND:20261031T130000Z
SUMMARY:Cancelled Sync
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`

    const events = parseICal(ics)
    expect(events.length).toBe(1) // Cancelled event excluded
    const ev = events[0]

    expect(ev.id).toBe('event-12345@google.com')
    expect(ev.title).toBe('Product Demo with Acme Corp')
    expect(ev.company).toBe('Acme Corp')
    expect(ev.startTime).toBe('2026-10-31T10:00:00.000Z')
    expect(ev.endTime).toBe('2026-10-31T11:00:00.000Z')
    expect(ev.meetingUrl).toBe('https://meet.google.com/xyz-uvwx-rst')
    expect(ev.attendees).toContain('Alice Smith (alice@acme.com)')
    expect(ev.attendees).toContain('Bob Jones (bob@acme.com)')
    expect(ev.source).toBe('ical')
  })

  it('detects and cleans meeting window titles', () => {
    const meetWin = cleanMeetingTitle('Meet - Product Demo with Acme Corp - Google Chrome')
    expect(meetWin.isMeeting).toBe(true)
    expect(meetWin.title).toBe('Product Demo with Acme Corp')
    expect(meetWin.company).toBe('Acme Corp')

    const zoomWin = cleanMeetingTitle('Zoom Meeting - Acme Partner Sync')
    expect(zoomWin.isMeeting).toBe(true)
    expect(zoomWin.company).toBe('Acme Partner')

    const teamsWin = cleanMeetingTitle('Acme Corp Onboarding | Microsoft Teams')
    expect(teamsWin.isMeeting).toBe(true)
    expect(teamsWin.title).toBe('Acme Corp Onboarding')
    expect(teamsWin.company).toBe('Acme Corp')

    const normalWin = cleanMeetingTitle('Untitled Document - Visual Studio Code')
    expect(normalWin.isMeeting).toBe(false)
  })

  it('detects upcoming meeting 1 minute before start and handles dismissal', async () => {
    const domain = new CalendarDomain()
    const now = Date.now()

    // Create an event starting in 1 minute
    const startIso = new Date(now + 60 * 1000).toISOString()
    const endIso = new Date(now + 31 * 60 * 1000).toISOString()

    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:upcoming-test-123
DTSTART:${startIso.replace(/[-:]/g, '').split('.')[0]}Z
DTEND:${endIso.replace(/[-:]/g, '').split('.')[0]}Z
SUMMARY:Product Demo with Acme Corp
DESCRIPTION:Discussion with Alice
ATTENDEE;CN=Alice Smith:mailto:alice@acme.com
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`

    // Mock fetch for sync
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => ics
    } as unknown as Response)

    try {
      await domain.setFeedUrl('https://calendar.google.com/calendar/ical/test/basic.ics')

      // Check upcoming meeting at now
      const upcoming = await domain.getUpcomingMeeting(now)
      expect(upcoming).not.toBeNull()
      expect(upcoming?.id).toBe('upcoming-test-123')
      expect(upcoming?.title).toBe('Product Demo with Acme Corp')
      expect(upcoming?.company).toBe('Acme Corp')
      expect(upcoming?.statusText).toMatch(/Starts in|Starting/)

      // Dismiss meeting
      domain.dismissMeeting('upcoming-test-123')

      // Subsequent check should be null
      const dismissedCheck = await domain.getUpcomingMeeting(now)
      expect(dismissedCheck).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('clears cached events when the feed is disconnected', async () => {
    const domain = new CalendarDomain()
    const startIso = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const endIso = new Date(Date.now() + 40 * 60 * 1000).toISOString()
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:disconnect-test-1
DTSTART:${startIso.replace(/[-:]/g, '').split('.')[0]}Z
DTEND:${endIso.replace(/[-:]/g, '').split('.')[0]}Z
SUMMARY:Client Sync with Acme
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => ics
    } as unknown as Response)

    try {
      await domain.setFeedUrl('https://example.com/feed.ics')
      expect(domain.getStatus().eventCount).toBeGreaterThan(0)

      await domain.setFeedUrl(null)
      const status = domain.getStatus()
      expect(status.feedUrl).toBeNull()
      expect(status.eventCount).toBe(0)
      expect(status.lastSyncAt).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('keeps a private feed URL in the encrypted secret store, not on disk', async () => {
    safeStorageState.encryptionAvailable = true
    const originalFetch = globalThis.fetch
    const domain = new CalendarDomain()
    const feedUrl = 'https://calendar.example.com/private-TOKEN-123/basic.ics'
    // The sync window is relative to now, so the event must be recent.
    const day = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '')
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => singleEvent('secret-feed', `${day}T090000Z`, `${day}T093000Z`)
    } as unknown as Response)
    try {
      await domain.setFeedUrl(feedUrl)

      // The token must not survive in the calendar store...
      const onDisk = readFileSync(join(userData, 'calendar.json'), 'utf8')
      expect(onDisk).not.toContain('TOKEN-123')
      expect(onDisk).not.toContain(feedUrl)
      // ...but the UI must still be able to show which feed is connected.
      expect(domain.getStatus().feedUrl).toBe(feedUrl)
      expect(domain.getStatus().eventCount).toBe(1)
    } finally {
      await domain.setFeedUrl(null)
      globalThis.fetch = originalFetch
      safeStorageState.encryptionAvailable = false
    }

    // Disconnecting forgets the secret too, so reconnecting starts clean.
    expect(domain.getStatus().feedUrl).toBeNull()
  })

  it('expands a weekly RRULE into only the occurrences inside the window', () => {
    const ics = singleEvent(
      'weekly-count',
      '20261102T090000Z',
      '20261102T093000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3'
    )

    const events = parseICal(ics, NOVEMBER_WINDOW)
    expect(events.map((event) => event.startTime)).toEqual([
      '2026-11-02T09:00:00.000Z',
      '2026-11-09T09:00:00.000Z',
      '2026-11-16T09:00:00.000Z'
    ])
    // Each occurrence gets its own id so dismissing one does not hide the series.
    expect(events[1].id).toBe('weekly-count@2026-11-09T09:00:00.000Z')
    expect(events[1].endTime).toBe('2026-11-09T09:30:00.000Z')
  })

  it('applies the feed VTIMEZONE across a DST change', () => {
    // 09:00 in New York is 13:00Z during EDT and 14:00Z after the 2026-11-01
    // fall-back. The hand-rolled engine used to keep both at the same offset.
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:dst-series
DTSTART;TZID=America/New_York:20261026T090000
DTEND;TZID=America/New_York:20261026T093000
SUMMARY:Weekly Standup
RRULE:FREQ=WEEKLY;COUNT=2
END:VEVENT
END:VCALENDAR`

    const events = parseICal(ics, {
      from: Date.parse('2026-10-20T00:00:00Z'),
      to: Date.parse('2026-11-10T00:00:00Z')
    })
    expect(events.map((event) => event.startTime)).toEqual([
      '2026-10-26T13:00:00.000Z',
      '2026-11-02T14:00:00.000Z'
    ])
    // Duration is preserved across the boundary as wall-clock 30 minutes.
    expect(events.map((event) => event.endTime)).toEqual([
      '2026-10-26T13:30:00.000Z',
      '2026-11-02T14:30:00.000Z'
    ])
  })

  it('honours EXDATE and COUNT positionally', () => {
    const ics = singleEvent(
      'weekly-exdate',
      '20261102T090000Z',
      '20261102T093000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4\nEXDATE:20261109T090000Z'
    )

    const events = parseICal(ics, NOVEMBER_WINDOW)
    expect(events.map((event) => event.startTime)).toEqual([
      '2026-11-02T09:00:00.000Z',
      '2026-11-16T09:00:00.000Z',
      '2026-11-23T09:00:00.000Z'
    ])
    // Internal recurrence bookkeeping must not leak into stored events.
    expect('rrule' in events[0]).toBe(false)
    expect('exdates' in events[0]).toBe(false)
  })

  it('accepts a date-only EXDATE for a timed occurrence', () => {
    const ics = singleEvent(
      'weekly-date-exdate',
      '20261102T090000Z',
      '20261102T093000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3\nEXDATE;VALUE=DATE:20261109'
    )

    const events = parseICal(ics, NOVEMBER_WINDOW)
    expect(events.map((event) => event.startTime)).toEqual([
      '2026-11-02T09:00:00.000Z',
      '2026-11-16T09:00:00.000Z'
    ])
  })

  it('replaces a single occurrence with its RECURRENCE-ID override', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:series-moved
DTSTART:20261102T090000Z
DTEND:20261102T093000Z
SUMMARY:Weekly Standup
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:series-moved
RECURRENCE-ID:20261109T090000Z
DTSTART:20261109T110000Z
DTEND:20261109T113000Z
SUMMARY:Weekly Standup (moved)
END:VEVENT
END:VCALENDAR`

    const events = parseICal(ics, NOVEMBER_WINDOW).sort(
      (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)
    )
    expect(events.map((event) => event.startTime)).toEqual([
      '2026-11-02T09:00:00.000Z',
      '2026-11-09T11:00:00.000Z',
      '2026-11-16T09:00:00.000Z'
    ])
    expect(events[1].title).toBe('Weekly Standup (moved)')
  })

  it('removes an instance cancelled by a RECURRENCE-ID exception', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:series-cancel-one
DTSTART:20261102T090000Z
DTEND:20261102T093000Z
SUMMARY:Weekly Standup
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:series-cancel-one
RECURRENCE-ID:20261109T090000Z
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`

    const events = parseICal(ics, NOVEMBER_WINDOW).sort(
      (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)
    )
    expect(events.map((event) => event.startTime)).toEqual([
      '2026-11-02T09:00:00.000Z',
      '2026-11-16T09:00:00.000Z'
    ])
  })

  it('expands an ordinal BYDAY rule (second Tuesday of the month)', () => {
    const ics = singleEvent(
      'monthly-second-tuesday',
      '20261110T090000Z',
      '20261110T093000Z',
      'RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=2'
    )

    const events = parseICal(ics, {
      from: Date.parse('2026-11-01T00:00:00Z'),
      to: Date.parse('2026-12-31T00:00:00Z')
    })
    expect(events.map((event) => event.startTime)).toEqual([
      '2026-11-10T09:00:00.000Z',
      '2026-12-08T09:00:00.000Z'
    ])
  })

  it('restricts a monthly rule with BYMONTH', () => {
    const ics = singleEvent(
      'monthly-seasonal',
      '20261115T090000Z',
      '20261115T093000Z',
      'RRULE:FREQ=MONTHLY;BYMONTH=11;COUNT=2'
    )

    const events = parseICal(ics, {
      from: Date.parse('2026-11-01T00:00:00Z'),
      to: Date.parse('2026-12-31T00:00:00Z')
    })
    expect(events.map((event) => event.startTime)).toEqual(['2026-11-15T09:00:00.000Z'])
  })

  it('persists a failed sync in the status and clears it on success', async () => {
    const domain = new CalendarDomain()
    await domain.setFeedUrl(null)
    const originalFetch = globalThis.fetch

    try {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => ''
      } as unknown as Response)

      const failed = await domain.setFeedUrl('https://example.com/broken.ics')
      expect(failed.error).toMatch(/503/)
      // The error survives the call that reported it.
      expect(domain.getStatus().error).toMatch(/503/)

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          singleEvent(
            'recovered',
            new Date(Date.now() + 10 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
            new Date(Date.now() + 40 * 60 * 1000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
          )
      } as unknown as Response)

      const recovered = await domain.sync()
      expect(recovered.success).toBe(true)
      expect(domain.getStatus().error).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
      await domain.setFeedUrl(null)
    }
  })

  it('never touches desktop capture before window detection is explicitly enabled', async () => {
    const { desktopCapturer } = await import('electron')
    const domain = new CalendarDomain()
    // Reset the shared test store, then prove the default state does not scan.
    domain.toggleAutoDetect(false)
    vi.mocked(desktopCapturer.getSources).mockClear()

    expect(await domain.detectMeetingWindow()).toBeNull()
    expect(desktopCapturer.getSources).not.toHaveBeenCalled()
    expect(domain.getStatus().autoDetectWindows).toBe(false)
  })

  it('does not scan for meeting windows while the overlay is hidden', async () => {
    const { desktopCapturer } = await import('electron')
    const domain = new CalendarDomain()
    domain.toggleAutoDetect(true)
    vi.mocked(desktopCapturer.getSources).mockClear()

    // No overlay window exists in this test, so the poll must not scan even
    // though detection is enabled: startup must never raise the OS prompt.
    expect(await domain.getUpcomingMeeting(Date.now())).toBeNull()
    expect(desktopCapturer.getSources).not.toHaveBeenCalled()
  })

  it('detects active meeting windows, caches results within 30s, and skips scanning when idle', async () => {
    const { desktopCapturer, powerMonitor } = await import('electron')
    const domain = new CalendarDomain()
    // Explicit opt-in: this is the user action that may raise the OS prompt.
    domain.toggleAutoDetect(true)

    vi.mocked(desktopCapturer.getSources).mockResolvedValue([
      { id: '1', name: 'Zoom Meeting - Partner Discussion' } as any
    ])
    vi.mocked(powerMonitor.getSystemIdleTime).mockReturnValue(0)

    // First scan: should detect Zoom window
    const first = await domain.detectMeetingWindow()
    expect(first).not.toBeNull()
    expect(first?.title).toBe('Partner Discussion')
    expect(first?.source).toBe('window')
    expect(desktopCapturer.getSources).toHaveBeenCalledTimes(1)

    // Second call immediately after: should return cached detected window without re-scanning
    const cached = await domain.detectMeetingWindow()
    expect(cached).toEqual(first)
    expect(desktopCapturer.getSources).toHaveBeenCalledTimes(1)

    // If dismissed: should no longer return it
    domain.dismissMeeting(first!.id)
    const afterDismiss = await domain.detectMeetingWindow()
    expect(afterDismiss).toBeNull()

    // Test idle skip: if system is idle (>30s) and no meeting was already cached
    const idleDomain = new CalendarDomain()
    vi.mocked(desktopCapturer.getSources).mockClear()
    vi.mocked(powerMonitor.getSystemIdleTime).mockReturnValue(45)

    const idleResult = await idleDomain.detectMeetingWindow()
    expect(idleResult).toBeNull()
    // Should NOT have called desktopCapturer.getSources because system is idle
    expect(desktopCapturer.getSources).not.toHaveBeenCalled()
  })
})
