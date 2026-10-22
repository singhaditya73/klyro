import { settingsDomain } from './settings'

/**
 * How long Klyro keeps what it wrote.
 *
 * One window covers the things that contain words — interview transcripts, the
 * chat history and the audit log — because a person who asks Klyro to forget
 * after a month does not mean "except the part where it said my name".
 *
 * The usage ledger has no words and no timestamps (it is a count per provider),
 * so it is not part of the window; it can be cleared on demand.
 */

/** The cutoff a retention policy implies, or null for "keep everything". */
export function retentionCutoff(days: number, now = Date.now()): number | null {
  if (!Number.isFinite(days) || days <= 0) return null
  return now - Math.round(days) * 24 * 60 * 60 * 1000
}

/** The cutoff the user's own settings imply, or null. */
export function configuredCutoff(now = Date.now()): number | null {
  return retentionCutoff(settingsDomain.get().retentionDays, now)
}
