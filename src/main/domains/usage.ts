import type { ProviderId, ProviderUsageRow } from '@shared/types'
import { JsonStore } from '../store/json-store'

/**
 * Local, per-provider request & spend ledger. BYOK users pay per token/request,
 * so Klyro provides an honest counter showing exact tokens and estimated spend.
 * Local only; never leaves the device.
 */

export type UsageKind =
  | 'chat'
  | 'transcribe'
  | 'agent-step'
  | 'meeting-summary'
  | 'workflow-step'
  | 'memory-extract'
  | 'tool-proposal'

export interface ProviderUsage {
  requests: number
  toolCalls: number
  failures: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedSpendUsd: number
}

interface UsageState {
  byProvider: Record<string, ProviderUsage>
}

// Pricing per 1,000,000 tokens in USD
const PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  openai: { input: 0.15, output: 0.60 }, // gpt-4o-mini
  anthropic: { input: 3.00, output: 15.00 }, // claude-3-5-sonnet
  gemini: { input: 0.10, output: 0.40 }, // gemini-2.0-flash
  groq: { input: 0.59, output: 0.79 }, // llama-3.3-70b
  deepseek: { input: 0.14, output: 0.28 }, // deepseek-v3
  mistral: { input: 0.20, output: 0.60 },
  ollama: { input: 0.00, output: 0.00 }, // 100% Free local
  lmstudio: { input: 0.00, output: 0.00 }, // 100% Free local
  whisper_local: { input: 0.00, output: 0.00 }
}

export interface UsageRecordOptions {
  failed?: boolean
  toolCall?: boolean
  /** Tokens reported or estimated for this request. Omitted = unknown, not zero-cost guesswork. */
  inputTokens?: number
  outputTokens?: number
}

class UsageDomain {
  private readonly store = new JsonStore<UsageState>('usage.json', { byProvider: {} })

  /** Record one provider request with tokens and calculate estimated spend. */
  record(providerId: ProviderId, kind: UsageKind, options: UsageRecordOptions = {}): void {
    if (!providerId) return

    const inTok = Math.max(0, Math.round(options.inputTokens ?? 0))
    const outTok = Math.max(0, Math.round(options.outputTokens ?? 0))
    const pricing = PRICING_PER_MILLION[providerId] || { input: 0.20, output: 0.60 }
    const cost = (inTok * pricing.input + outTok * pricing.output) / 1_000_000

    this.store.update((state) => {
      const raw = state.byProvider[providerId]
      const entry: ProviderUsage = {
        requests: raw?.requests ?? 0,
        toolCalls: raw?.toolCalls ?? 0,
        failures: raw?.failures ?? 0,
        inputTokens: raw?.inputTokens ?? 0,
        outputTokens: raw?.outputTokens ?? 0,
        totalTokens: raw?.totalTokens ?? 0,
        estimatedSpendUsd: raw?.estimatedSpendUsd ?? 0
      }

      entry.requests += 1
      if (kind === 'agent-step' || options.toolCall) entry.toolCalls += 1
      if (options.failed) entry.failures += 1
      entry.inputTokens += inTok
      entry.outputTokens += outTok
      entry.totalTokens += inTok + outTok
      entry.estimatedSpendUsd = Number((entry.estimatedSpendUsd + cost).toFixed(4))

      state.byProvider[providerId] = entry
    })
  }

  /** Rows for the settings table; sorted by spend and requests. */
  rows(): ProviderUsageRow[] {
    return Object.entries(this.store.get().byProvider)
      .map(([provider, entry]) => ({
        provider: provider as ProviderId,
        requests: entry.requests,
        toolCalls: entry.toolCalls,
        failures: entry.failures,
        inputTokens: entry.inputTokens ?? 0,
        outputTokens: entry.outputTokens ?? 0,
        totalTokens: entry.totalTokens ?? 0,
        estimatedSpendUsd: entry.estimatedSpendUsd ?? 0
      }))
      .sort((a, b) => b.estimatedSpendUsd - a.estimatedSpendUsd || b.requests - a.requests)
  }

  clear(): void {
    this.store.update((state) => {
      state.byProvider = {}
    })
  }
}

export const usage = new UsageDomain()
