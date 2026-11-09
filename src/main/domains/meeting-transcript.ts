import type { MeetingTranscriptSnapshot } from '@shared/types'
import { JsonStore } from '../store/json-store'

/**
 * The live meeting transcript, written down by the main process as it happens.
 *
 * The renderer owns the microphone and the transcription, but it can be
 * reloaded (a dev refresh, a renderer crash, a machine that was about to
 * sleep). Keeping each line here means a restart does not silently lose the
 * part of the meeting that was already transcribed. It is a working buffer,
 * not a permanent record: the user discards it, or the next session replaces
 * it.
 */

interface TranscriptFile {
  /** Epoch ms of the first line in this buffer. */
  startedAt: number | null
  /** Epoch ms of the most recent line. */
  updatedAt: number | null
  lines: string[]
}

const DEFAULT_STATE: TranscriptFile = {
  startedAt: null,
  updatedAt: null,
  lines: []
}

/** A runaway transcription loop must not turn the buffer into a disk leak. */
const MAX_LINES = 2_000
/**
 * A transcript older than this is not offered for recovery: it belongs to a
 * meeting that has ended, and the next launch should start blank.
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000

export class MeetingTranscript {
  private readonly store = new JsonStore<TranscriptFile>('meeting-transcript.json', DEFAULT_STATE)

  append(line: string): number {
    const text = line.trim()
    if (!text) return this.store.get().lines.length
    const now = Date.now()
    const data = this.store.update((draft) => {
      if (!draft.startedAt) draft.startedAt = now
      draft.updatedAt = now
      draft.lines.push(text)
      if (draft.lines.length > MAX_LINES) {
        draft.lines.splice(0, draft.lines.length - MAX_LINES)
      }
    })
    return data.lines.length
  }

  snapshot(): MeetingTranscriptSnapshot {
    const data = this.store.get()
    return {
      lines: [...data.lines],
      startedAt: data.startedAt,
      updatedAt: data.updatedAt,
      resumable:
        data.lines.length > 0 &&
        data.updatedAt !== null &&
        Date.now() - data.updatedAt < MAX_AGE_MS
    }
  }

  discard(): void {
    this.store.set({ ...DEFAULT_STATE })
  }
}

export const meetingTranscript = new MeetingTranscript()
