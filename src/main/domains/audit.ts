import { randomUUID } from 'node:crypto'
import type { AuditEntry } from '@shared/types'
import { JsonStore } from '../store/json-store'
import { configuredCutoff } from './retention'

/**
 * Append-only, local audit log. Every consequential thing Klyro does outside a
 * single conversation — agent actions, MCP tool calls, meeting outputs — is
 * recorded here with a timestamp, kind and short human detail. Kept entirely on
 * the device (same posture as agent-tasks.json) so the "what did it do"
 * question always has a local, exportable answer. Capped: oldest entries fall
 * off at MAX_ENTRIES rather than growing forever.
 */

interface AuditState {
  entries: AuditEntry[]
}

const MAX_ENTRIES = 2000
const MAX_DETAIL = 500

class AuditDomain {
  private readonly store = new JsonStore<AuditState>('audit.json', { entries: [] })

  record(kind: string, detail: string, meta?: Record<string, unknown>): void {
    const clean = detail.replace(/\s+/g, ' ').trim().slice(0, MAX_DETAIL)
    this.store.update((state) => {
      const next = state.entries
      next.push({
        id: randomUUID(),
        at: Date.now(),
        kind,
        detail: clean,
        ...(meta ? { meta } : {})
      })
      if (next.length > MAX_ENTRIES) state.entries = next.slice(next.length - MAX_ENTRIES)
    })
  }

  list(limit = 200): AuditEntry[] {
    return [...this.store.get().entries].sort((a, b) => b.at - a.at).slice(0, Math.max(1, Math.min(limit, MAX_ENTRIES)))
  }

  clear(): void {
    this.store.update((state) => {
      state.entries = []
    })
  }

  /** Drop the entries older than the retention window. */
  prune(now = Date.now()): number {
    const cutoff = configuredCutoff(now)
    if (cutoff === null) return 0
    let removed = 0
    this.store.update((state) => {
      const kept = state.entries.filter((entry) => entry.at >= cutoff)
      removed = state.entries.length - kept.length
      state.entries = kept
    })
    return removed
  }
}

export const audit = new AuditDomain()
