import { desktopCapturer, powerMonitor } from 'electron'
import type { CalendarEvent, CalendarSyncStatus } from '@shared/types'
import { JsonStore } from '../store/json-store'
import { logger } from '../logger'
import { getOverlayWindow } from './windows'

interface CalendarStoreData {
  feedUrl: string | null
  lastSyncAt: string | null
  /** The last sync failure, kept so a later status check still reports it. */
  lastError: string | null
  events: CalendarEvent[]
  autoDetectWindows: boolean
  /**
   * Set only when the user turns the window scan on. Older files may already
   * contain `autoDetectWindows: true` because it was the old default, so the
   * scan requires this deliberate marker before it may trigger an OS prompt.
   */
  windowScanConsent: boolean
  dismissedIds: string[]
}

const DEFAULT_STORE: CalendarStoreData = {
  feedUrl: null,
  lastSyncAt: null,
  lastError: null,
  events: [],
  // Off by default: scanning window titles uses desktopCapturer, which raises
  // the OS screen-capture prompt (the xdg portal on Wayland, the Screen
  // Recording prompt on macOS). A prompt must follow an explicit opt-in, never
  // appear just because the app started.
  autoDetectWindows: false,
  windowScanConsent: false,
  dismissedIds: []
}

export interface ParsedCalendarEvent extends CalendarEvent {
  /** Raw RRULE property, when the event repeats. */
  rrule?: string
  /** Instances explicitly removed from the series (EXDATE). */
  exdates?: string[]
  /** The original instance start, for a modified occurrence (RECURRENCE-ID). */
  recurrenceId?: string
  /** STATUS:CANCELLED, kept long enough to remove it from its series. */
  cancelled?: boolean
}

interface RecurrenceRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count?: number
  until?: number
  byDay: Array<{ ordinal?: number; day: number }>
  byMonthDay: number[]
  byMonth: number[]
  /** Week start, 0 = Sunday. */
  wkst: number
}

const DAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }
const MS_DAY = 24 * 60 * 60 * 1000
const MAX_RECURRENCE_PERIODS = 20_000

const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'zoho.com',
  'mail.com',
  'gmx.com'
])

const GENERIC_MEETING_WORDS = new Set([
  'zoom',
  'google meet',
  'meet',
  'teams',
  'microsoft teams',
  'webex',
  'call',
  'meeting',
  'sync',
  'chat',
  'catchup',
  '1:1',
  '1-on-1',
  'weekly',
  'daily',
  'monthly',
  'standup',
  'demo',
  'discussion',
  'internal',
  'external',
  'huddle',
  'intro',
  'interview',
  'team',
  'staff',
  'hands',
  'all-hands',
  'review',
  'planning',
  'retro',
  'retrospective'
])

const isAllGeneric = (cand: string): boolean => {
  const words = cand.toLowerCase().split(/\s+/)
  return words.every((w) => GENERIC_MEETING_WORDS.has(w))
}

const MEETING_URL_REGEX =
  /(https?:\/\/(?:meet\.google\.com\/[a-z0-9-]+|[a-z0-9-]+\.zoom\.us\/j\/[0-9]+|teams\.microsoft\.com\/[^\s<>"]+|teams\.live\.com\/[^\s<>"]+|[a-z0-9-]+\.webex\.com\/[^\s<>"]+))/i

/**
 * Unescapes RFC 5545 text strings.
 */
function unescapeICalText(str: string): string {
  return str
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

/**
 * Parses iCalendar date strings (e.g. 20261031T093000Z, 20261031T093000, 20261031) into an ISO string.
 */
export function parseICalDate(dateStr: string): string | null {
  if (!dateStr) return null
  const clean = dateStr.trim()

  // Format: YYYYMMDDTHHMMSSZ (UTC)
  const utcMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(clean)
  if (utcMatch) {
    const [, y, m, d, hh, mm, ss] = utcMatch
    const date = new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss))
    return date.toISOString()
  }

  // Format: YYYYMMDDTHHMMSS (local time)
  const localMatch = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(clean)
  if (localMatch) {
    const [, y, m, d, hh, mm, ss] = localMatch
    const date = new Date(+y, +m - 1, +d, +hh, +mm, +ss)
    return date.toISOString()
  }

  // Format: YYYYMMDD (all day date)
  const dayMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(clean)
  if (dayMatch) {
    const [, y, m, d] = dayMatch
    const date = new Date(Date.UTC(+y, +m - 1, +d, 0, 0, 0))
    return date.toISOString()
  }

  // Fallback to standard Date parsing if possible
  const parsed = new Date(clean)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString()
  }

  return null
}

/**
 * Parses an RFC 5545 RRULE value into the subset Klyro can expand locally.
 * Unsupported frequencies return null, which leaves the base event intact.
 */
export function parseRecurrenceRule(value: string): RecurrenceRule | null {
  const parts = new Map<string, string>()
  for (const piece of value.split(';')) {
    const index = piece.indexOf('=')
    if (index === -1) continue
    parts.set(piece.slice(0, index).toUpperCase(), piece.slice(index + 1))
  }

  const freq = (parts.get('FREQ') ?? '').toUpperCase()
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return null
  }

  const interval = Math.max(1, Number.parseInt(parts.get('INTERVAL') ?? '1', 10) || 1)
  const countValue = Number.parseInt(parts.get('COUNT') ?? '', 10)
  const count = Number.isFinite(countValue) && countValue > 0 ? countValue : undefined
  const until = parts.has('UNTIL') ? parseICalDate(parts.get('UNTIL') ?? '') : null

  const byDay: RecurrenceRule['byDay'] = []
  for (const token of (parts.get('BYDAY') ?? '').split(',')) {
    const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(token.trim())
    if (!match) continue
    const ordinal = match[1] ? Number.parseInt(match[1], 10) : undefined
    byDay.push({ ...(ordinal === undefined ? {} : { ordinal }), day: DAY_CODES[match[2].toUpperCase()] })
  }

  const byMonthDay = (parts.get('BYMONTHDAY') ?? '')
    .split(',')
    .map((token) => Number.parseInt(token.trim(), 10))
    .filter((day) => Number.isFinite(day) && day !== 0 && Math.abs(day) <= 31)

  const byMonth = (parts.get('BYMONTH') ?? '')
    .split(',')
    .map((token) => Number.parseInt(token.trim(), 10))
    .filter((month) => Number.isFinite(month) && month >= 1 && month <= 12)

  const wkst = DAY_CODES[(parts.get('WKST') ?? 'MO').toUpperCase()] ?? 1

  return {
    freq,
    interval,
    ...(count === undefined ? {} : { count }),
    ...(until === null ? {} : { until: new Date(until).getTime() }),
    byDay,
    byMonthDay,
    byMonth,
    wkst
  }
}

interface TimeOfDay {
  hour: number
  minute: number
  second: number
  millisecond: number
}

function timeOfDay(epoch: number): TimeOfDay {
  const date = new Date(epoch)
  return {
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds()
  }
}

/** A UTC timestamp, or null when the calendar date does not exist (e.g. Feb 30). */
function utcTimestamp(
  year: number,
  monthIndex: number,
  day: number,
  time: TimeOfDay
): number | null {
  const date = new Date(
    Date.UTC(year, monthIndex, day, time.hour, time.minute, time.second, time.millisecond)
  )
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthIndex ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date.getTime()
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function startOfWeek(epoch: number, weekStartDay: number): number {
  const day = new Date(epoch).getUTCDay()
  return epoch - ((day - weekStartDay + 7) % 7) * MS_DAY
}

function addMonthsToMonthStart(epoch: number, months: number): number {
  const date = new Date(epoch)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
}

function nthWeekdayOfMonth(
  year: number,
  monthIndex: number,
  weekday: number,
  ordinal: number
): number | null {
  const total = daysInMonth(year, monthIndex)
  if (ordinal > 0) {
    const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay()
    const day = 1 + ((weekday - firstWeekday + 7) % 7) + (ordinal - 1) * 7
    return day <= total ? day : null
  }
  if (ordinal < 0) {
    const lastWeekday = new Date(Date.UTC(year, monthIndex, total)).getUTCDay()
    const day = total - ((lastWeekday - weekday + 7) % 7) + (ordinal + 1) * 7
    return day >= 1 ? day : null
  }
  return null
}

/** Days in one month selected by BYMONTHDAY / BYDAY, with DTSTART's day as default. */
function monthlyDays(
  year: number,
  monthIndex: number,
  rule: RecurrenceRule,
  anchorDay: number
): number[] {
  const total = daysInMonth(year, monthIndex)
  let days: number[] = []

  if (rule.byMonthDay.length > 0) {
    for (const value of rule.byMonthDay) {
      const day = value > 0 ? value : total + value + 1
      if (day >= 1 && day <= total) days.push(day)
    }
    // BYDAY and BYMONTHDAY together restrict each other.
    if (rule.byDay.length > 0) {
      days = days.filter((day) =>
        rule.byDay.some(
          (entry) =>
            entry.ordinal === undefined &&
            new Date(Date.UTC(year, monthIndex, day)).getUTCDay() === entry.day
        )
      )
    }
  } else if (rule.byDay.length > 0) {
    for (const entry of rule.byDay) {
      if (entry.ordinal !== undefined) {
        const day = nthWeekdayOfMonth(year, monthIndex, entry.day, entry.ordinal)
        if (day !== null) days.push(day)
        continue
      }
      for (let day = 1; day <= total; day++) {
        if (new Date(Date.UTC(year, monthIndex, day)).getUTCDay() === entry.day) days.push(day)
      }
    }
  } else if (anchorDay >= 1 && anchorDay <= total) {
    days.push(anchorDay)
  }

  return days
}

/** All occurrence starts inside one period (a day, week, month or year). */
function candidatesInPeriod(
  cursor: number,
  rule: RecurrenceRule,
  seriesStart: number,
  time: TimeOfDay
): number[] {
  const cursorDate = new Date(cursor)
  const year = cursorDate.getUTCFullYear()
  const monthIndex = cursorDate.getUTCMonth()
  const seriesDate = new Date(seriesStart)
  const anchorDay = seriesDate.getUTCDate()

  if (rule.freq === 'DAILY') {
    const day = cursorDate.getUTCDate()
    if (rule.byMonth.length > 0 && !rule.byMonth.includes(monthIndex + 1)) return []
    if (rule.byMonthDay.length > 0) {
      const total = daysInMonth(year, monthIndex)
      const wanted = rule.byMonthDay.map((value) => (value > 0 ? value : total + value + 1))
      if (!wanted.includes(day)) return []
    }
    if (rule.byDay.length > 0 && !rule.byDay.some((entry) => entry.day === cursorDate.getUTCDay())) {
      return []
    }
    const candidate = utcTimestamp(year, monthIndex, day, time)
    return candidate === null ? [] : [candidate]
  }

  if (rule.freq === 'WEEKLY') {
    const entries = rule.byDay.length > 0 ? rule.byDay : [{ day: seriesDate.getUTCDay() }]
    const candidates: number[] = []
    for (const entry of entries) {
      const offset = (entry.day - rule.wkst + 7) % 7
      const dayEpoch = cursor + offset * MS_DAY
      const date = new Date(dayEpoch)
      if (rule.byMonth.length > 0 && !rule.byMonth.includes(date.getUTCMonth() + 1)) continue
      const candidate = utcTimestamp(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        time
      )
      if (candidate !== null) candidates.push(candidate)
    }
    return candidates.sort((a, b) => a - b)
  }

  if (rule.freq === 'MONTHLY') {
    // BYMONTH limits a monthly series to the listed months (e.g. a seasonal
    // review); without this check it would fire every month.
    if (rule.byMonth.length > 0 && !rule.byMonth.includes(monthIndex + 1)) return []
    return monthlyDays(year, monthIndex, rule, anchorDay)
      .map((day) => utcTimestamp(year, monthIndex, day, time))
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b)
  }

  // YEARLY: the cursor is January 1 of the year being generated.
  const months = rule.byMonth.length > 0 ? rule.byMonth.map((month) => month - 1) : [seriesDate.getUTCMonth()]
  const candidates: number[] = []
  for (const month of months) {
    for (const day of monthlyDays(year, month, rule, anchorDay)) {
      const candidate = utcTimestamp(year, month, day, time)
      if (candidate !== null) candidates.push(candidate)
    }
  }
  return candidates.sort((a, b) => a - b)
}

function initialRecurrenceCursor(freq: RecurrenceRule['freq'], start: number, wkst: number): number {
  if (freq === 'WEEKLY') return startOfWeek(start, wkst)
  if (freq === 'MONTHLY') {
    const date = new Date(start)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  }
  if (freq === 'YEARLY') return Date.UTC(new Date(start).getUTCFullYear(), 0, 1)
  return start
}

function nextRecurrenceCursor(cursor: number, rule: RecurrenceRule): number {
  if (rule.freq === 'DAILY') return cursor + rule.interval * MS_DAY
  if (rule.freq === 'WEEKLY') return cursor + rule.interval * 7 * MS_DAY
  if (rule.freq === 'MONTHLY') return addMonthsToMonthStart(cursor, rule.interval)
  return Date.UTC(new Date(cursor).getUTCFullYear() + rule.interval, 0, 1)
}

/**
 * Skips whole periods before the requested window. This keeps a daily series
 * that began years ago from walking every day before the first useful date.
 */
function fastForwardCursor(cursor: number, rule: RecurrenceRule, target: number): number {
  if (target <= cursor) return cursor

  if (rule.freq === 'DAILY') {
    const periods = Math.floor((target - cursor) / (rule.interval * MS_DAY))
    return periods > 0 ? cursor + periods * rule.interval * MS_DAY : cursor
  }
  if (rule.freq === 'WEEKLY') {
    const periods = Math.floor((target - cursor) / (rule.interval * 7 * MS_DAY))
    return periods > 0 ? cursor + periods * rule.interval * 7 * MS_DAY : cursor
  }
  if (rule.freq === 'MONTHLY') {
    const from = new Date(cursor)
    const to = new Date(target)
    const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
    const periods = Math.floor(months / rule.interval)
    return periods > 0 ? addMonthsToMonthStart(cursor, periods * rule.interval) : cursor
  }
  const periods = Math.floor((new Date(target).getUTCFullYear() - new Date(cursor).getUTCFullYear()) / rule.interval)
  return periods > 0 ? Date.UTC(new Date(cursor).getUTCFullYear() + periods * rule.interval, 0, 1) : cursor
}

/** A calendar event with the parser's internal recurrence fields removed. */
function toPublicEvent(event: ParsedCalendarEvent): CalendarEvent {
  const {
    rrule: _rrule,
    exdates: _exdates,
    recurrenceId: _recurrenceId,
    cancelled: _cancelled,
    ...plain
  } = event
  return plain
}

/**
 * Expands one recurring VEVENT into the occurrences that overlap a window.
 * The returned ids include the occurrence start so each instance can be
 * dismissed (or recorded) without hiding the rest of the series.
 */
export function expandRecurringEvent(
  event: ParsedCalendarEvent,
  fromMs: number,
  toMs: number,
  maxOccurrences = 500
): CalendarEvent[] {
  const rule = event.rrule ? parseRecurrenceRule(event.rrule) : null
  if (!rule) return [toPublicEvent(event)]
  if (rule.until !== undefined && rule.until < fromMs - MS_DAY) return []

  const start = new Date(event.startTime).getTime()
  if (Number.isNaN(start)) return [toPublicEvent(event)]
  const rawEnd = new Date(event.endTime).getTime()
  const end = Number.isNaN(rawEnd) ? start + 30 * 60 * 1000 : rawEnd
  const duration = Math.max(0, end - start)
  const time = timeOfDay(start)
  // EXDATE may be a DATE (`20261109`) or a DATE-TIME; compare both forms so a
  // date-only exclusion still removes a timed occurrence.
  const excluded = new Set<string>()
  for (const raw of event.exdates ?? []) {
    excluded.add(raw)
    excluded.add(raw.slice(0, 10))
  }

  let cursor = initialRecurrenceCursor(rule.freq, start, rule.wkst)
  // COUNT is positional, so a series that counts its instances must start at
  // the first one. Without COUNT the cursor can jump straight to the window.
  if (rule.count === undefined) {
    cursor = fastForwardCursor(cursor, rule, fromMs - duration)
  }

  const occurrences: CalendarEvent[] = []
  let emitted = 0

  for (let period = 0; period < MAX_RECURRENCE_PERIODS; period++) {
    if (cursor > toMs) break

    const candidates = candidatesInPeriod(cursor, rule, start, time)
    let finished = false

    for (const candidate of candidates) {
      if (candidate < start) continue
      if (rule.until !== undefined && candidate > rule.until) {
        finished = true
        break
      }
      emitted += 1
      if (rule.count !== undefined && emitted > rule.count) {
        finished = true
        break
      }
      if (candidate > toMs) {
        finished = true
        break
      }
      if (candidate + duration < fromMs) continue

      const startIso = new Date(candidate).toISOString()
      const dateOnly = startIso.slice(0, 10)
      if (excluded.has(startIso) || excluded.has(dateOnly)) continue

      occurrences.push({
        ...toPublicEvent(event),
        id: `${event.id}@${startIso}`,
        startTime: startIso,
        endTime: new Date(candidate + duration).toISOString(),
        source: 'ical'
      })
      if (occurrences.length >= maxOccurrences) return occurrences
    }

    if (finished) break
    cursor = nextRecurrenceCursor(cursor, rule)
  }

  return occurrences
}

/**
 * Extracts external company name from meeting title or attendee list.
 */
export function extractCompany(summary: string, attendees: string[] = []): string {
  if (summary) {
    // Helper to clean trailing meeting words
    const cleanCandidate = (cand: string): string => {
      let c = cand.trim().replace(/[.,;:!?]+$/, '').trim()
      c = c.replace(/\s+(?:Discussion|Meeting|Call|Sync|Catchup|Demo|Chat|Overview|Onboarding|Standup|1:1)\b.*$/i, '').trim()
      return c
    }

    // 1. Patterns like "Product Demo with Acme Corp" or "Call w/ Acme Corp"
    const withMatch = /(?:with|w\/)\s+([A-Za-z0-9&.\- ]+)/i.exec(summary)
    if (withMatch && withMatch[1]) {
      const candidate = cleanCandidate(withMatch[1])
      if (candidate.length > 1 && !isAllGeneric(candidate)) {
        return candidate
      }
    }

    // 2. Pattern: "Acme Corp x Klyro" or "Acme Corp <> Klyro" or "Acme Corp / Klyro"
    const xKlyroMatch = /^([A-Za-z0-9&.\- ]+?)\s*(?:x|<>|\/)\s*(?:klyro|me|us)\b/i.exec(summary)
    if (xKlyroMatch && xKlyroMatch[1]) {
      const candidate = cleanCandidate(xKlyroMatch[1])
      if (candidate.length > 1 && !isAllGeneric(candidate)) {
        return candidate
      }
    }

    // 3. Pattern: "Klyro x Acme Corp" or "Klyro / Acme Corp" or "Klyro <> Acme Corp"
    const klyroXMatch = /(?:klyro|me|us)\s*(?:x|<>|\/)\s*([A-Za-z0-9&.\- ]+)/i.exec(summary)
    if (klyroXMatch && klyroXMatch[1]) {
      const candidate = cleanCandidate(klyroXMatch[1])
      if (candidate.length > 1 && !isAllGeneric(candidate)) {
        return candidate
      }
    }

    // 4. Pattern: "[Company] Product Demo" or "[Company] Sync" or "[Company] Demo"
    const prefixMatch =
      /^([A-Za-z0-9&.\- ]+?)\s+(?:Product Demo|Demo|Interview|Sync|Call|Discussion|Overview|Onboarding)\b/i.exec(
        summary
      )
    if (prefixMatch && prefixMatch[1]) {
      const candidate = cleanCandidate(prefixMatch[1])
      if (candidate.length > 1 && !isAllGeneric(candidate)) {
        return candidate
      }
    }
  }

  // Look for company domain in attendees
  for (const att of attendees) {
    const emailMatch = /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/.exec(att)
    if (emailMatch && emailMatch[2]) {
      const domain = emailMatch[2].toLowerCase()
      if (!PUBLIC_EMAIL_DOMAINS.has(domain)) {
        const companyPart = domain.split('.')[0]
        if (companyPart && companyPart.length > 2 && !GENERIC_MEETING_WORDS.has(companyPart)) {
          return companyPart.charAt(0).toUpperCase() + companyPart.slice(1)
        }
      }
    }
  }

  return ''
}

/**
 * Extracts meeting link (Zoom, Meet, Teams, Webex) from text.
 */
export function extractMeetingUrl(text: string): string | undefined {
  if (!text) return undefined
  const match = MEETING_URL_REGEX.exec(text)
  return match ? match[1] : undefined
}

export interface ICalParseOptions {
  /** Start of the occurrence window, in epoch milliseconds. */
  from?: number
  /** End of the occurrence window, in epoch milliseconds. */
  to?: number
  /** Safety cap for generated instances per series. */
  maxOccurrences?: number
}

/**
 * Parses RFC 5545 iCalendar data into structured CalendarEvent objects.
 *
 * When a window is supplied, RRULE series are expanded into the instances that
 * overlap it. Without a window the base event of a series is returned once.
 */
export function parseICal(icsContent: string, options: ICalParseOptions = {}): CalendarEvent[] {
  if (!icsContent || !icsContent.includes('BEGIN:VCALENDAR')) {
    return []
  }

  // Unfold folded lines per RFC 5545 (CRLF or LF followed by a space or tab)
  const unfolded = icsContent.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '')
  const lines = unfolded.split(/\r?\n/)

  const events: ParsedCalendarEvent[] = []
  /**
   * Instances replaced by a RECURRENCE-ID event, and instances cancelled by a
   * STATUS:CANCELLED exception. Both must be suppressed in the parent series.
   */
  const overriddenInstances = new Set<string>()
  const cancelledInstances = new Set<string>()
  let inEvent = false
  let currentEvent: Partial<ParsedCalendarEvent> & { rawAttendees: string[] } = {
    rawAttendees: []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true
      currentEvent = { rawAttendees: [] }
      continue
    }

    if (trimmed === 'END:VEVENT') {
      inEvent = false
      if (currentEvent.cancelled) {
        // A cancelled exception still needs its UID and RECURRENCE-ID; some
        // feeds omit SUMMARY/DTSTART on it, so this runs before the full check.
        if (currentEvent.id && currentEvent.recurrenceId) {
          cancelledInstances.add(`${currentEvent.id}@${currentEvent.recurrenceId}`)
        }
      } else if (currentEvent.id && currentEvent.title && currentEvent.startTime) {
        const eventId = currentEvent.id
        // A RECURRENCE-ID event is a single instance, so it gets an
        // occurrence-scoped id: dismissing it must not dismiss the series.
        const occurrenceKey = currentEvent.recurrenceId
          ? `${eventId}@${currentEvent.recurrenceId}`
          : null
        if (occurrenceKey) overriddenInstances.add(occurrenceKey)

        const attendees = currentEvent.rawAttendees || []
        const summary = currentEvent.title || 'Untitled Meeting'
        const company = currentEvent.company || extractCompany(summary, attendees)
        const endTime =
          currentEvent.endTime ||
          new Date(new Date(currentEvent.startTime).getTime() + 30 * 60 * 1000).toISOString()

        events.push({
          id: occurrenceKey ?? eventId,
          title: summary,
          startTime: currentEvent.startTime,
          endTime,
          location: currentEvent.location,
          meetingUrl: currentEvent.meetingUrl,
          attendees,
          company,
          description: currentEvent.description,
          source: 'ical',
          ...(currentEvent.rrule ? { rrule: currentEvent.rrule } : {}),
          ...(currentEvent.exdates?.length ? { exdates: currentEvent.exdates } : {}),
          ...(currentEvent.recurrenceId ? { recurrenceId: currentEvent.recurrenceId } : {})
        })
      }
      continue
    }

    if (!inEvent) continue

    const colonIndex = trimmed.indexOf(':')
    if (colonIndex === -1) continue

    const propHeader = trimmed.slice(0, colonIndex)
    const propValue = trimmed.slice(colonIndex + 1)
    const propName = propHeader.split(';')[0].toUpperCase()

    switch (propName) {
      case 'UID':
        currentEvent.id = propValue.trim()
        break
      case 'SUMMARY':
        currentEvent.title = unescapeICalText(propValue)
        break
      case 'DESCRIPTION': {
        const desc = unescapeICalText(propValue)
        currentEvent.description = desc
        if (!currentEvent.meetingUrl) {
          currentEvent.meetingUrl = extractMeetingUrl(desc)
        }
        break
      }
      case 'LOCATION': {
        const loc = unescapeICalText(propValue)
        currentEvent.location = loc
        if (!currentEvent.meetingUrl) {
          currentEvent.meetingUrl = extractMeetingUrl(loc)
        }
        break
      }
      case 'DTSTART':
        currentEvent.startTime = parseICalDate(propValue) || undefined
        break
      case 'DTEND':
        currentEvent.endTime = parseICalDate(propValue) || undefined
        break
      case 'RRULE':
        currentEvent.rrule = propValue.trim()
        break
      case 'EXDATE': {
        const dates = propValue
          .split(',')
          .map((value) => parseICalDate(value))
          .filter((value): value is string => value !== null)
        if (dates.length > 0) {
          currentEvent.exdates = [...(currentEvent.exdates ?? []), ...dates]
        }
        break
      }
      case 'RECURRENCE-ID':
        currentEvent.recurrenceId = parseICalDate(propValue) || undefined
        break
      case 'ATTENDEE': {
        // e.g. ATTENDEE;CN=Alice Smith:mailto:alice@example.com
        const cnMatch = /CN="?([^;":]+)"?/i.exec(propHeader)
        const emailMatch = /mailto:([^;:\s]+)/i.exec(propValue)
        const name = cnMatch ? cnMatch[1].trim() : ''
        const email = emailMatch ? emailMatch[1].trim() : propValue.trim()
        const display = name ? (email ? `${name} (${email})` : name) : email
        if (display) {
          currentEvent.rawAttendees.push(display)
        }
        break
      }
      case 'ORGANIZER': {
        const cnMatch = /CN="?([^;":]+)"?/i.exec(propHeader)
        const emailMatch = /mailto:([^;:\s]+)/i.exec(propValue)
        const orgName = cnMatch ? cnMatch[1].trim() : ''
        const orgEmail = emailMatch ? emailMatch[1].trim() : propValue.trim()
        const display = orgName ? (orgEmail ? `${orgName} (${orgEmail})` : orgName) : orgEmail
        if (display && !currentEvent.rawAttendees.includes(display)) {
          currentEvent.rawAttendees.push(display)
        }
        break
      }
      case 'STATUS':
        if (propValue.toUpperCase() === 'CANCELLED') {
          // Do not drop the event here: if it carries a RECURRENCE-ID it is a
          // cancelled exception that must also suppress the generated instance.
          currentEvent.cancelled = true
        }
        break
    }
  }

  // Check meeting URL in summary if still missing
  for (const ev of events) {
    if (!ev.meetingUrl) {
      ev.meetingUrl = extractMeetingUrl(ev.title)
    }
  }

  const expandable = options.from !== undefined && options.to !== undefined
  if (!expandable) {
    return events.map(toPublicEvent)
  }

  const from = options.from as number
  const to = options.to as number
  const maxOccurrences = Math.max(1, options.maxOccurrences ?? 500)

  const expanded: CalendarEvent[] = []
  for (const event of events) {
    if (!event.rrule) {
      expanded.push(toPublicEvent(event))
      continue
    }
    for (const occurrence of expandRecurringEvent(event, from, to, maxOccurrences)) {
      // A modified or cancelled exception replaces the generated instance.
      if (overriddenInstances.has(occurrence.id) || cancelledInstances.has(occurrence.id)) {
        continue
      }
      expanded.push(occurrence)
    }
  }

  return expanded
}

/**
 * Checks a window title to determine if it represents an active meeting (Zoom, Meet, Teams, Webex).
 */
export function cleanMeetingTitle(rawTitle: string): {
  isMeeting: boolean
  title: string
  company: string
} {
  if (!rawTitle) return { isMeeting: false, title: '', company: '' }

  // Strip browser application suffix
  const clean = rawTitle
    .replace(/\s*-\s*(Google Chrome|Chromium|Brave|Mozilla Firefox|Microsoft Edge|Opera|Vivaldi|Arc)$/i, '')
    .trim()

  const lower = clean.toLowerCase()

  // Google Meet
  if (lower.startsWith('meet - ') || lower === 'google meet' || lower.includes('meet.google.com')) {
    let title = clean
    if (lower.startsWith('meet - ')) {
      title = clean.slice(7).trim()
    }
    const company = extractCompany(title)
    return { isMeeting: true, title: title || 'Google Meet', company }
  }

  // Zoom Meeting
  if (lower.includes('zoom meeting') || lower.startsWith('zoom - ') || lower.includes('zoom workplace')) {
    let title = clean
    if (lower.includes(' - ')) {
      const parts = clean.split(' - ')
      title = parts[1]?.trim() || clean
    }
    const company = extractCompany(title)
    return { isMeeting: true, title: title || 'Zoom Meeting', company }
  }

  // Microsoft Teams
  if (lower.includes('microsoft teams') || lower.includes('teams meeting')) {
    let title = clean
    if (clean.includes('|')) {
      title = clean.split('|')[0].trim()
    } else if (clean.includes(' - ')) {
      title = clean.split(' - ')[0].trim()
    }
    const company = extractCompany(title)
    return { isMeeting: true, title: title || 'Microsoft Teams Meeting', company }
  }

  // Webex
  if (lower.includes('webex')) {
    const company = extractCompany(clean)
    return { isMeeting: true, title: clean || 'Webex Meeting', company }
  }

  // Slack Huddle
  if (lower.includes('huddle') && lower.includes('slack')) {
    return { isMeeting: true, title: 'Slack Huddle', company: '' }
  }

  return { isMeeting: false, title: '', company: '' }
}

export class CalendarDomain {
  private store: JsonStore<CalendarStoreData> | null = null
  /** Window enumeration is expensive and may trigger OS capture prompts; rate-limit it. */
  private lastWindowScanAt = 0
  private lastDetectedWindow: CalendarEvent | null = null

  private getStore(): JsonStore<CalendarStoreData> {
    if (!this.store) {
      this.store = new JsonStore<CalendarStoreData>('calendar.json', DEFAULT_STORE)
    }
    return this.store
  }

  getStatus(): CalendarSyncStatus {
    const data = this.getStore().get()
    return {
      feedUrl: data.feedUrl,
      lastSyncAt: data.lastSyncAt,
      eventCount: data.events.length,
      // A stale `true` from the old default must not look enabled: the scan
      // only runs after the explicit consent marker.
      autoDetectWindows: data.autoDetectWindows && data.windowScanConsent,
      error: data.lastError
    }
  }

  async setFeedUrl(url: string | null): Promise<CalendarSyncStatus> {
    const cleanUrl = url ? url.trim() : null
    this.getStore().update((draft) => {
      draft.feedUrl = cleanUrl
      if (!cleanUrl) {
        // Disconnecting must also forget what the old feed told us, or the
        // overlay keeps prompting for meetings from an account the user removed.
        draft.events = []
        draft.lastSyncAt = null
        draft.lastError = null
        draft.dismissedIds = []
      }
    })
    if (!cleanUrl) return this.getStatus()
    const result = await this.sync()
    return { ...this.getStatus(), error: result.error ?? null }
  }

  toggleAutoDetect(enabled: boolean): boolean {
    this.getStore().update((draft) => {
      draft.autoDetectWindows = enabled
      // Turning it on is the consent to ask the OS for capture access; turning
      // it off withdraws that consent.
      draft.windowScanConsent = enabled
    })
    return enabled
  }

  /**
   * Fetches the calendar feed and updates cached events.
   */
  async sync(customFeedUrl?: string): Promise<{ success: boolean; eventCount: number; error?: string }> {
    const targetUrl = customFeedUrl ?? this.getStore().get().feedUrl
    if (!targetUrl) {
      return { success: false, eventCount: 0, error: 'No iCal feed URL configured' }
    }

    try {
      // Ensure webcal:// is converted to https://
      const httpsUrl = targetUrl.replace(/^webcal:\/\//i, 'https://')
      const response = await fetch(httpsUrl, {
        headers: {
          'User-Agent': 'Klyro/1.0 (MeetingCoPilot; Local-First; CalendarSync)'
        },
        signal: AbortSignal.timeout(10000)
      })

      if (!response.ok) {
        throw new Error(`Calendar server returned HTTP ${response.status}`)
      }

      const text = await response.text()

      // Retain events from yesterday to +14 days into the future. The window is
      // also what RRULE expansion is bounded by, so a weekly standup that began
      // years ago still produces only the instances the user can attend.
      const now = Date.now()
      const oneDayAgo = now - 24 * 60 * 60 * 1000
      const twoWeeksAhead = now + 14 * 24 * 60 * 60 * 1000

      const parsed = parseICal(text, { from: oneDayAgo, to: twoWeeksAhead })

      const filtered = parsed
        .filter((ev) => {
          const start = new Date(ev.startTime).getTime()
          return !Number.isNaN(start) && start >= oneDayAgo && start <= twoWeeksAhead
        })
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())

      this.getStore().update((draft) => {
        draft.events = filtered
        draft.lastSyncAt = new Date().toISOString()
        draft.lastError = null
      })

      logger.info('Calendar feed synced successfully', { count: filtered.length })
      return { success: true, eventCount: filtered.length }
    } catch (err) {
      const errorMsg = (err as Error).message || 'Failed to sync calendar feed'
      logger.error('Failed to sync calendar feed', targetUrl, errorMsg)
      this.getStore().update((draft) => {
        draft.lastError = errorMsg
      })
      return { success: false, eventCount: this.getStore().get().events.length, error: errorMsg }
    }
  }

  /**
   * Dismisses a meeting prompt so the user isn't prompted again for the same meeting instance.
   */
  dismissMeeting(id: string): boolean {
    if (this.lastDetectedWindow?.id === id) {
      this.lastDetectedWindow = null
    }
    this.getStore().update((draft) => {
      if (!draft.dismissedIds.includes(id)) {
        draft.dismissedIds.push(id)
        // Keep list bounded
        if (draft.dismissedIds.length > 50) {
          draft.dismissedIds = draft.dismissedIds.slice(-50)
        }
      }
    })
    return true
  }

  /**
   * Scans running desktop windows for active Zoom, Google Meet, or Teams windows.
   */
  async detectMeetingWindow(): Promise<CalendarEvent | null> {
    const data = this.getStore().get()
    // Never call desktopCapturer without an explicit opt-in: on Wayland and
    // macOS it raises the OS screen-capture dialog, which must not appear just
    // because Klyro launched or the overlay polled for meetings.
    if (!data.autoDetectWindows || !data.windowScanConsent) {
      return null
    }

    const dismissed = new Set(data.dismissedIds)
    const scanStartedAt = Date.now()

    // Serve the cached window detection within the 30s window without re-scanning
    if (scanStartedAt - this.lastWindowScanAt < 30_000) {
      if (this.lastDetectedWindow && !dismissed.has(this.lastDetectedWindow.id)) {
        return this.lastDetectedWindow
      }
      return null
    }

    // If the user has been idle (>30s) and no meeting was already detected,
    // skip window enumeration to avoid unnecessary idle CPU wakeups.
    try {
      const idleSec = powerMonitor?.getSystemIdleTime?.() ?? 0
      if (idleSec >= 30 && !this.lastDetectedWindow) {
        return null
      }
    } catch {
      // powerMonitor may be unavailable in some environments/tests
    }

    this.lastWindowScanAt = scanStartedAt

    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        fetchWindowIcons: false,
        thumbnailSize: { width: 0, height: 0 }
      })

      for (const source of sources) {
        if (!source.name || source.name.toLowerCase().includes('klyro')) continue
        const check = cleanMeetingTitle(source.name)
        if (check.isMeeting) {
          const syntheticId = `win-${source.name}`
          if (dismissed.has(syntheticId)) continue

          const now = Date.now()
          const detected: CalendarEvent = {
            id: syntheticId,
            title: check.title,
            startTime: new Date(now).toISOString(),
            endTime: new Date(now + 30 * 60 * 1000).toISOString(),
            attendees: [],
            company: check.company,
            source: 'window',
            statusText: 'Active meeting window detected'
          }
          this.lastDetectedWindow = detected
          return detected
        }
      }
      this.lastDetectedWindow = null
    } catch (err) {
      logger.warn('Failed to scan desktop windows for meeting detection', (err as Error).message)
    }

    return null
  }

  /**
   * Returns the next upcoming meeting (within 5 minutes of start or actively ongoing)
   * or currently running meeting window.
   */
  async getUpcomingMeeting(nowEpoch: number = Date.now()): Promise<CalendarEvent | null> {
    const data = this.getStore().get()
    const dismissed = new Set(data.dismissedIds)

    // Window: 5 minutes before start up to 45 minutes into the meeting
    const windowBeforeMs = 5 * 60 * 1000

    for (const ev of data.events) {
      if (dismissed.has(ev.id)) continue
      const startMs = new Date(ev.startTime).getTime()
      const endMs = new Date(ev.endTime).getTime()
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue

      // Active or starting soon
      if (nowEpoch >= startMs - windowBeforeMs && nowEpoch <= endMs) {
        let statusText = 'Starting now'
        const diffMs = startMs - nowEpoch
        if (diffMs > 60000) {
          statusText = `Starts in ${Math.ceil(diffMs / 60000)}m`
        } else if (diffMs > 0) {
          statusText = 'Starting in < 1m'
        } else {
          statusText = 'In progress'
        }

        return {
          ...ev,
          statusText
        }
      }
    }

    // If no scheduled calendar event is active/upcoming, inspect running windows.
    // Only while the overlay is actually on screen: a hidden overlay has no
    // meeting prompt to show, and the scan can raise the OS capture dialog.
    const overlay = getOverlayWindow()
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) {
      return null
    }
    return this.detectMeetingWindow()
  }
}

export const calendarDomain = new CalendarDomain()
