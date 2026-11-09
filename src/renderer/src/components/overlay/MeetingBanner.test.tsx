import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CalendarEvent } from '@shared/types'
import { GhostPhoneModal } from './GhostPhoneModal'
import { MeetingBanner } from './MeetingBanner'

const meeting: CalendarEvent = {
  id: 'cal-1',
  title: 'Acme renewal call',
  startTime: '2026-11-09T10:00:00.000Z',
  endTime: '2026-11-09T10:30:00.000Z',
  attendees: ['Ana (ana@acme.test)', 'Ben (ben@acme.test)'],
  company: 'Acme',
  source: 'ical',
  statusText: 'Starts in 2m'
}

describe('the overlay meeting banner', () => {
  it('shows who the meeting is with and offers one action', () => {
    const html = renderToStaticMarkup(
      <MeetingBanner meeting={meeting} onStart={() => undefined} onDismiss={() => undefined} />
    )
    expect(html).toContain('Acme renewal call')
    expect(html).toContain('Acme')
    expect(html).toContain('2 participants')
    expect(html).toContain('Start in-call co-pilot')
    expect(html).toContain('Dismiss')
  })
})

describe('the Ghost Phone modal', () => {
  it('warns when the address is loopback-only and reflects the copy state', () => {
    const html = renderToStaticMarkup(
      <GhostPhoneModal
        url="http://127.0.0.1:5892/?t=abc"
        copied
        onClose={() => undefined}
        onCopy={() => undefined}
        onHide={() => undefined}
      />
    )
    expect(html).toContain('Copied')
    expect(html).toContain('only works on this computer')
    expect(html).toContain('Hide Laptop Screen')
  })

  it('does not warn when the address is reachable from a phone', () => {
    const html = renderToStaticMarkup(
      <GhostPhoneModal
        url="http://192.168.1.20:5892/?t=abc"
        copied={false}
        onClose={() => undefined}
        onCopy={() => undefined}
        onHide={() => undefined}
      />
    )
    expect(html).not.toContain('only works on this computer')
    expect(html).toContain('Copy Link')
  })
})
