/**
 * 1-Click Calendar Follow-Up Scheduler.
 *
 * Detects agreed follow-up dates and times from meeting transcripts and action items,
 * and generates one-click links for Google Calendar, Outlook Web, and standard .ics files.
 */

export interface CalendarEventPayload {
  title: string
  description: string
  location?: string
  startTime: Date
  endTime: Date
  attendees?: string[]
}

export interface DetectedFollowUp {
  rawMatch: string
  suggestedDate: Date
  confidence: 'high' | 'medium'
  topic?: string
}

/** Regex patterns for natural language meeting follow-up phrasing. */
const FOLLOWUP_TIME_PATTERNS: Array<{ regex: RegExp; handler: (match: RegExpExecArray) => Date | null }> = [
  // "next Tuesday at 3 PM", "next Friday at 11:30 AM"
  {
    regex: /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i,
    handler: (match) => {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      const targetDay = days.indexOf(match[1].toLowerCase())
      if (targetDay === -1) return null

      const date = new Date()
      const currentDay = date.getDay()
      let diff = targetDay - currentDay
      if (diff <= 0) diff += 7 // next week
      date.setDate(date.getDate() + diff)

      let hours = match[2] ? parseInt(match[2], 10) : 14 // default 2 PM
      const minutes = match[3] ? parseInt(match[3], 10) : 0
      const meridiem = match[4]?.toLowerCase()
      if (meridiem === 'pm' && hours < 12) hours += 12
      if (meridiem === 'am' && hours === 12) hours = 0

      date.setHours(hours, minutes, 0, 0)
      return date
    }
  },
  // "tomorrow at 2 PM", "tomorrow at 10:30 AM"
  {
    regex: /\btomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i,
    handler: (match) => {
      const date = new Date()
      date.setDate(date.getDate() + 1)
      let hours = match[1] ? parseInt(match[1], 10) : 10 // default 10 AM
      const minutes = match[2] ? parseInt(match[2], 10) : 0
      const meridiem = match[3]?.toLowerCase()
      if (meridiem === 'pm' && hours < 12) hours += 12
      if (meridiem === 'am' && hours === 12) hours = 0
      date.setHours(hours, minutes, 0, 0)
      return date
    }
  },
  // "in two weeks", "in 2 weeks"
  {
    regex: /\bin\s+(?:two|2)\s+weeks/i,
    handler: () => {
      const date = new Date()
      date.setDate(date.getDate() + 14)
      date.setHours(14, 0, 0, 0)
      return date
    }
  },
  // "in a week", "in 1 week"
  {
    regex: /\bin\s+(?:a|1)\s+week/i,
    handler: () => {
      const date = new Date()
      date.setDate(date.getDate() + 7)
      date.setHours(14, 0, 0, 0)
      return date
    }
  }
]

/** Scans text or action items for agreed meeting follow-up timing. */
export function detectFollowUpDate(text: string): DetectedFollowUp | null {
  if (!text) return null

  for (const { regex, handler } of FOLLOWUP_TIME_PATTERNS) {
    const match = regex.exec(text)
    if (match) {
      const suggestedDate = handler(match)
      if (suggestedDate) {
        return {
          rawMatch: match[0],
          suggestedDate,
          confidence: match[0].includes('at') ? 'high' : 'medium'
        }
      }
    }
  }

  // Fallback: 7 days from now at 2 PM
  return null
}

/** Formats date into UTC string YYYYMMDDTHHMMSSZ for calendar deep links. */
function toCalendarUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

/** Generates Google Calendar web link. */
export function generateGoogleCalendarUrl(event: CalendarEventPayload): string {
  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
  const params = new URLSearchParams()
  params.set('text', event.title)
  params.set('dates', `${toCalendarUtc(event.startTime)}/${toCalendarUtc(event.endTime)}`)
  params.set('details', event.description)
  if (event.location) params.set('location', event.location)
  if (event.attendees && event.attendees.length > 0) {
    params.set('add', event.attendees.join(','))
  }
  return `${base}&${params.toString()}`
}

/** Generates Outlook / Office 365 Web link. */
export function generateOutlookWebUrl(event: CalendarEventPayload): string {
  const base = 'https://outlook.live.com/calendar/0/deeplink/compose'
  const params = new URLSearchParams()
  params.set('subject', event.title)
  params.set('startdt', event.startTime.toISOString())
  params.set('enddt', event.endTime.toISOString())
  params.set('body', event.description)
  if (event.location) params.set('location', event.location)
  if (event.attendees && event.attendees.length > 0) {
    params.set('to', event.attendees.join(','))
  }
  return `${base}?${params.toString()}`
}

/** Generates standard RFC 5545 iCalendar (.ics) content string. */
export function generateIcsContent(event: CalendarEventPayload): string {
  const start = toCalendarUtc(event.startTime)
  const end = toCalendarUtc(event.endTime)
  const stamp = toCalendarUtc(new Date())
  const uid = `klyro-evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}@klyro.app`

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Klyro//FollowUp Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${event.title.replace(/\n/g, ' ')}`,
    `DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`
  ]

  if (event.location) {
    lines.push(`LOCATION:${event.location}`)
  }

  if (event.attendees && event.attendees.length > 0) {
    for (const att of event.attendees) {
      lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:${att}`)
    }
  }

  lines.push('STATUS:CONFIRMED')
  lines.push('END:VEVENT')
  lines.push('END:VCALENDAR')

  return lines.join('\r\n')
}

/** Triggers download of .ics file in browser/Electron window. */
export function downloadIcsFile(event: CalendarEventPayload, filename = 'meeting-followup.ics'): void {
  const icsText = generateIcsContent(event)
  const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

