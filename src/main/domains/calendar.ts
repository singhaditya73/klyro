import { desktopCapturer, powerMonitor } from 'electron'
import ICAL from 'ical.js'
import type { CalendarEvent, CalendarSyncStatus } from '@shared/types'
import { JsonStore } from '../store/json-store'
import { logger } from '../logger'
import { secrets } from '../security/secrets'
import { getOverlayWindow } from './windows'

/** Secret-store id for the calendar feed URL, which may carry a private token. */
const FEED_SECRET_ID = 'calendar.feedUrl'

/** Feed URLs contain private tokens, so logs only ever see the hostname. */
function feedLabel(url: string): string {
  try {
    return new URL(url.replace(/^webcal:\/\//i, 'https://')).hostname || 'calendar feed'
  } catch {
    return 'calendar feed'
  }
}

interface CalendarStoreData {
  /**
   * Legacy, plaintext location for the feed URL. Newly configured feeds live
   * in the encrypted secret store; this field is kept only as a fallback for
   * systems without a keychain and is cleared once the URL is encrypted.
   */
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
 * Parses RFC 5545 iCalendar data into structured CalendarEvent objects.
 *
 * Parsing and recurrence expansion are delegated to ical.js, which implements
 * the full RRULE grammar (ordinal BYDAY, BYSETPOS, BYMONTHDAY, ...) and the
 * VTIMEZONE/DST rules the hand-rolled expander used to miss. When a window is
 * supplied, each series is expanded into the instances that overlap it;
 * otherwise one base event per series is returned.
 */
export interface ICalParseOptions {
  /** Start of the occurrence window, in epoch milliseconds. */
  from?: number
  /** End of the occurrence window, in epoch milliseconds. */
  to?: number
  /** Safety cap for generated instances per series. */
  maxOccurrences?: number
}

/** A malformed series must not make one feed hang the sync. */
const MAX_RECURRENCE_ITERATIONS = 100_000

function toDate(time: ICAL.Time): Date {
  // All-day values are floating: anchor them to UTC midnight so a date-only
  // event does not drift with the machine's timezone.
  if (time.isDate) return new Date(Date.UTC(time.year, time.month - 1, time.day))
  return time.toJSDate()
}

function statusOf(event: ICAL.Event | null | undefined): string {
  if (!event) return ''
  return String(event.component.getFirstPropertyValue('status') ?? '').toUpperCase()
}

function attendeesOf(event: ICAL.Event): string[] {
  const attendees: string[] = []
  const add = (display: string): void => {
    if (display && !attendees.includes(display)) attendees.push(display)
  }
  for (const property of event.component.getAllProperties('attendee')) {
    const email = String(property.getFirstValue() ?? '').replace(/^mailto:/i, '').trim()
    const name = String(property.getParameter('cn') ?? '').trim()
    add(name ? (email ? `${name} (${email})` : name) : email)
  }
  const organizer = event.component.getFirstProperty('organizer')
  if (organizer) {
    const email = String(organizer.getFirstValue() ?? '').replace(/^mailto:/i, '').trim()
    const name = String(organizer.getParameter('cn') ?? '').trim()
    add(name ? (email ? `${name} (${email})` : name) : email)
  }
  return attendees
}

function toCalendarEvent(event: ICAL.Event, start: Date, end: Date, id: string): CalendarEvent {
  const title = (event.summary || '').trim() || 'Untitled Meeting'
  const attendees = attendeesOf(event)
  const description = (event.description || '').trim() || undefined
  const location = (event.location || '').trim() || undefined
  const meetingUrl =
    extractMeetingUrl(description ?? '') ?? extractMeetingUrl(location ?? '') ?? extractMeetingUrl(title)

  return {
    id,
    title,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    location,
    meetingUrl,
    attendees,
    company: extractCompany(title, attendees),
    description,
    source: 'ical'
  }
}

function endOf(event: ICAL.Event, start: Date): Date {
  try {
    return toDate(event.endDate)
  } catch {
    // A VEVENT with neither DTEND nor DURATION is still a valid meeting.
    return new Date(start.getTime() + 30 * 60 * 1000)
  }
}

export function parseICal(icsContent: string, options: ICalParseOptions = {}): CalendarEvent[] {
  if (!icsContent || !icsContent.includes('BEGIN:VCALENDAR')) return []

  let root: ICAL.Component
  try {
    root = new ICAL.Component(ICAL.parse(icsContent))
  } catch (error) {
    logger.warn('Could not parse the calendar feed', (error as Error).message)
    return []
  }

  // Register the feed's own VTIMEZONEs so TZID values resolve, including DST.
  for (const vtimezone of root.getAllSubcomponents('vtimezone')) {
    try {
      const timezone = new ICAL.Timezone(vtimezone)
      if (timezone.tzid) ICAL.TimezoneService.register(timezone)
    } catch {
      // A malformed VTIMEZONE must not discard the rest of the calendar.
    }
  }

  const components = root.getAllSubcomponents('vevent')
  const from = options.from
  const to = options.to
  const expanding = from !== undefined && to !== undefined
  const maxOccurrences = Math.max(1, options.maxOccurrences ?? 500)
  const events: CalendarEvent[] = []

  // Some feeds send a cancelled exception without SUMMARY/DTSTART. Record the
  // UID + original start first so the generated instance is suppressed even
  // when ical.js cannot link the exception to its master.
  const cancelledInstances = new Set<string>()
  for (const component of components) {
    if (String(component.getFirstPropertyValue('status') ?? '').toUpperCase() !== 'CANCELLED') continue
    const uid = String(component.getFirstPropertyValue('uid') ?? '')
    const recurrenceId = component.getFirstPropertyValue('recurrence-id') as ICAL.Time | null
    if (uid && recurrenceId) cancelledInstances.add(`${uid}@${toDate(recurrenceId).toISOString()}`)
  }

  for (const component of components) {
    let event: ICAL.Event
    try {
      event = new ICAL.Event(component)
    } catch {
      continue
    }

    // Exceptions are attached to their master by ICAL.Event; emitting them
    // here as well would duplicate the instance.
    if (event.isRecurrenceException()) continue

    const baseId = event.uid || `event-${events.length + 1}`
    if (statusOf(event) === 'CANCELLED') continue

    try {
      if (!expanding || !event.isRecurring()) {
        const start = toDate(event.startDate)
        events.push(toCalendarEvent(event, start, endOf(event, start), baseId))
        continue
      }

      const iterator = event.iterator()
      let emitted = 0
      for (let step = 0; step < MAX_RECURRENCE_ITERATIONS; step++) {
        const next = iterator.next()
        if (!next) break

        // The id is the series plus the *original* instant, so dismissing or
        // recording a moved occurrence stays attached to that occurrence.
        const occurrenceStart = toDate(next)
        const occurrenceId = `${baseId}@${occurrenceStart.toISOString()}`
        if (cancelledInstances.has(occurrenceId)) continue

        const details = event.getOccurrenceDetails(next)
        const start = toDate(details.startDate)
        if (to !== undefined && start.getTime() > to) break
        if (statusOf(details.item) === 'CANCELLED') continue

        const end = details.endDate ? toDate(details.endDate) : endOf(details.item ?? event, start)
        if (from !== undefined && end.getTime() < from) continue
        if (emitted >= maxOccurrences) break

        events.push(toCalendarEvent(details.item ?? event, start, end, occurrenceId))
        emitted += 1
      }
    } catch (error) {
      logger.warn('Could not expand a calendar event', baseId, (error as Error).message)
    }
  }

  return events
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
  /** Legacy plaintext feed URLs are migrated once, not on every status poll. */
  private feedMigrationAttempted = false

  private getStore(): JsonStore<CalendarStoreData> {
    if (!this.store) {
      this.store = new JsonStore<CalendarStoreData>('calendar.json', DEFAULT_STORE)
    }
    return this.store
  }

  /**
   * Resolves the feed URL, preferring the encrypted secret store.
   *
   * The URL often embeds a private calendar token (Google/Outlook ICS links),
   * so it should never sit in `calendar.json` when the OS keychain is
   * available. Older installs keep a plaintext copy until the first read,
   * which migrates it and then erases the plaintext field.
   */
  private readFeedUrl(): string | null {
    const encrypted = secrets.get(FEED_SECRET_ID)
    if (encrypted) {
      if (this.getStore().get().feedUrl) {
        this.getStore().update((draft) => {
          draft.feedUrl = null
        })
      }
      return encrypted
    }

    const plaintext = this.getStore().get().feedUrl
    if (!plaintext || this.feedMigrationAttempted) return plaintext
    this.feedMigrationAttempted = true
    try {
      secrets.set(FEED_SECRET_ID, plaintext)
      this.getStore().update((draft) => {
        draft.feedUrl = null
      })
      logger.info('Moved the calendar feed URL into the encrypted secret store')
    } catch {
      // No OS keychain: keep the local copy so sync still works. The security
      // panel reports plaintext storage separately.
      logger.warn('Calendar feed URL stays in the local store: no OS keychain available')
    }
    return plaintext
  }

  getStatus(): CalendarSyncStatus {
    const data = this.getStore().get()
    return {
      feedUrl: this.readFeedUrl(),
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

    if (!cleanUrl) {
      // Disconnecting must also forget what the old feed told us, or the
      // overlay keeps prompting for meetings from an account the user removed.
      this.getStore().update((draft) => {
        draft.feedUrl = null
        draft.events = []
        draft.lastSyncAt = null
        draft.lastError = null
        draft.dismissedIds = []
      })
      secrets.delete(FEED_SECRET_ID)
      return this.getStatus()
    }

    let encrypted = false
    try {
      secrets.set(FEED_SECRET_ID, cleanUrl)
      encrypted = true
    } catch {
      // Without a keychain the URL has to stay in the local store; sync still
      // works and the honest fallback is reported by the security panel.
      logger.warn('Could not encrypt the calendar feed URL; storing it locally instead')
    }

    this.getStore().update((draft) => {
      // A stored secret is the only copy; never duplicate it in plaintext.
      draft.feedUrl = encrypted ? null : cleanUrl
    })

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
    const targetUrl = customFeedUrl ?? this.readFeedUrl()
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
      logger.error('Failed to sync calendar feed', feedLabel(targetUrl), errorMsg)
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
