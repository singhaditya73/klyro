import type { ProviderId } from '@shared/types'
import { JsonStore } from '../store/json-store'

/**
 * Local, per-provider request ledger. BYOK users pay per request, so Klyro owes
 * them an honest counter: how many model calls each feature made on their key.
 * Tokens are not shown because not every compatible endpoint reports them —
 * counts are the one number that is always true. Local only; never leaves the
 * device and never includes message content.
 */

export type UsageKind = 'chat' | 'transcribe' | 'agent-step' | 'meeting-summary' | 'workflow-step' | 'memory-extract' | 'tool-proposal'

interface ProviderUsage {
  requests: number
  /** Counted separately so a chat loop is distinguishable from plain Q&A. */
  toolCalls: number
  failures: number
}

interface UsageState {
  byProvider: Record<string, ProviderUsage>
}

const EMPTY: ProviderUsage = { requests: 0, toolCalls: 0, failures: 0 }

class UsageDomain {
  private readonly store = new JsonStore<UsageState>('usage.json', { byProvider: {} })

  /** Record one successful provider request of a given feature. */
  record(providerId: ProviderId, kind: UsageKind, options: { failed?: boolean; toolCall?: boolean } = {}): void {
    if (!providerId) return
    this.store.update((state) => {
      const entry = state.byProvider[providerId] ?? { ...EMPTY }
      entry.requests += 1
      if (kind === 'agent-step' || options.toolCall) entry.toolCalls += 1
      if (options.failed) entry.failures += 1
      state.byProvider[providerId] = entry
    })
  }

  /** Rows for the settings table; sorted by usage so the biggest line is first. */
  rows(): Array<{ provider: ProviderId; requests: number; toolCalls: number; failures: number }> {
    return Object.entries(this.store.get().byProvider)
      .map(([provider, entry]) => ({ provider: provider as ProviderId, ...entry }))
      .sort((a, b) => b.requests - a.requests)
  }

  clear(): void {
    this.store.update((state) => {
      state.byProvider = {}
    })
  }
}

export const usage = new UsageDomain()
