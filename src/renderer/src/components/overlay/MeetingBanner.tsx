import { Calendar, X, Zap } from 'lucide-react'
import type { CalendarEvent } from '@shared/types'

/**
 * The meeting prompt above the composer. It is only shown while the overlay is
 * idle: starting the co-pilot is the one action that matters at that moment.
 */
export function MeetingBanner({
  meeting,
  onStart,
  onDismiss
}: {
  meeting: CalendarEvent
  onStart: (meeting: CalendarEvent) => void
  onDismiss: (id: string) => void
}): React.ReactNode {
  return (
    <div className="overlay__meeting-banner" role="status">
      <div className="overlay__meeting-banner-main">
        <div className="overlay__meeting-banner-icon">
          <Calendar className="icon icon--xs" />
        </div>
        <div className="overlay__meeting-banner-details">
          <div className="overlay__meeting-banner-title">
            {meeting.title}
            {meeting.company ? (
              <span className="overlay__meeting-banner-company"> · {meeting.company}</span>
            ) : null}
          </div>
          <div className="overlay__meeting-banner-sub">
            <span className="overlay__meeting-banner-status">
              {meeting.statusText || 'Starting now'}
            </span>
            {meeting.attendees && meeting.attendees.length > 0 ? (
              <span className="overlay__meeting-banner-participants">
                {' '}
                · {meeting.attendees.length} participant{meeting.attendees.length > 1 ? 's' : ''}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="overlay__meeting-banner-actions">
        <button
          type="button"
          className="btn btn--primary btn--xs overlay__meeting-banner-start"
          onClick={() => onStart(meeting)}
          title="1-click start dual recording and pre-fill meeting details"
        >
          <Zap className="icon icon--xs" />
          <span>Start in-call co-pilot</span>
        </button>
        <button
          type="button"
          className="btn btn--icon btn--icon-xs btn--ghost"
          onClick={() => onDismiss(meeting.id)}
          title="Dismiss prompt"
          aria-label="Dismiss"
        >
          <X className="icon icon--xs" />
        </button>
      </div>
    </div>
  )
}
