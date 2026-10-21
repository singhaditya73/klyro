import type { ProviderId } from '@shared/types'
import { settingsDomain } from './settings'
import { antigravity } from './antigravity'
import { listOpenCodeModels } from '../providers/opencode'
import { trimSlash } from '../providers/http'
import { logger } from '../logger'

/**
 * The models a provider can serve — for every provider, not just the local
 * ones.
 *
 * The point is that the user picks the model. A provider that only accepts a
 * typed-in id makes choosing impossible: you have to know the exact string.
 * So each provider is asked what it has:
 *
 *   - Antigravity   → its own catalogue (name, provider, remaining quota)
 *   - OpenCode      → the server's `/api/model` (or `/provider` on v1)
 *   - Ollama        → `/api/tags`
 *   - OpenAI-shaped  → `/models` (OpenAI, Groq, any OpenAI-compatible server)
 *   - Anthropic     → `/models` with the API-key header
 *   - Gemini        → `/models` with the key in the query
 *   - Claude Code   → the ids the CLI documents
 *   - Codex         → the ids the CLI documents
 *
 * A provider that cannot be asked (no key, server down) returns an empty
 * list *and* the reason, so the picker can say what to do about it.
 */

export interface ProviderModel {
  /** What goes into the request: the model's id. */
  id: string
  /** What the user sees: a friendly name. */
  name: string
  /** Which company serves it. */
  provider: string
  /** 0..1 — how much of the user's quota is left, when the provider says. */
  quota: number | null
  /** True when the model is free of charge. */
  free: boolean
}

export interface ProviderModelList {
  models: ProviderModel[]
  /** Why the list is empty, or a hint about it. */
  note: string | null
}

const TIMEOUT_MS = 6000

function model(id: string, name: string, provider: string, extra: Partial<ProviderModel> = {}): ProviderModel {
  return { id, name, provider, quota: null, free: false, ...extra }
}

/** The models the Claude Code CLI accepts (aliases and full names). */
const CLAUDE_CODE_MODELS: ProviderModel[] = [
  model('sonnet', 'Claude Sonnet (latest)', 'anthropic'),
  model('opus', 'Claude Opus (latest)', 'anthropic'),
  model('haiku', 'Claude Haiku (latest)', 'anthropic'),
  model('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'anthropic'),
  model('claude-opus-4-6', 'Claude Opus 4.6', 'anthropic'),
  model('claude-haiku-4-5', 'Claude Haiku 4.5', 'anthropic')
]

/** The models the Codex CLI accepts. */
const CODEX_MODELS: ProviderModel[] = [
  model('gpt-5-codex', 'GPT-5 Codex', 'openai'),
  model('gpt-5', 'GPT-5', 'openai'),
  model('o4-mini', 'o4-mini', 'openai'),
  model('gpt-5-mini', 'GPT-5 mini', 'openai')
]

/** The models a provider offers, as far as they can be asked. */
export async function listProviderModels(providerId: ProviderId): Promise<ProviderModelList> {
  const settings = settingsDomain.get()
  const config = settings.providers[providerId] ?? { baseUrl: '', model: '' }
  const baseUrl = (config.baseUrl ?? '').trim()
  const apiKey = settingsDomain.apiKey(providerId)

  switch (providerId) {
    case 'antigravity': {
      const status = await antigravity.status()
      const models = status.models.map((entry) => ({
        id: entry.id,
        name: entry.name,
        provider: entry.provider,
        quota: entry.quota,
        free: false
      }))
      return {
        models,
        note: models.length
          ? null
          : (status.error ?? 'Antigravity is not connected yet. Open the IDE once and press Connect in Integrations.')
      }
    }
    case 'opencode': {
      const models = await listOpenCodeModels(baseUrl, apiKey).catch(() => [])
      return {
        models: models.map((entry) => ({
          id: entry.id,
          name: entry.name,
          provider: entry.providerID,
          quota: null,
          free: entry.free
        })),
        note: models.length ? null : 'The OpenCode server is not answering. Start it in Integrations.'
      }
    }
    case 'ollama':
      return listOllamaModels(baseUrl)
    case 'anthropic':
      return listAnthropicModels(baseUrl, apiKey)
    case 'gemini':
      return listGeminiModels(baseUrl, apiKey)
    case 'claude-code':
      return { models: CLAUDE_CODE_MODELS, note: null }
    case 'codex':
      return { models: CODEX_MODELS, note: null }
    default:
      return listOpenAiShapedModels(baseUrl, apiKey)
  }
}

/** Ollama's own endpoint: `/api/tags`. */
async function listOllamaModels(baseUrl: string): Promise<ProviderModelList> {
  if (!baseUrl) return { models: [], note: 'Set a base URL first.' }
  try {
    const response = await fetch(`${trimSlash(baseUrl)}/api/tags`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) {
      return { models: [], note: `Ollama answered ${response.status}.` }
    }
    const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> }
    const models = (payload.models ?? [])
      .map((entry) => model(entry.name || entry.model || '', entry.name || entry.model || '', 'ollama', { free: true }))
      .filter((entry) => entry.id.length > 0)
    return {
      models,
      note: models.length ? null : 'Ollama has no models pulled yet. Run `ollama pull <model>`.'
    }
  } catch (error) {
    return { models: [], note: `Could not reach Ollama: ${(error as Error).message}` }
  }
}

/** OpenAI, Groq and any OpenAI-compatible server: `/models`. */
async function listOpenAiShapedModels(baseUrl: string, apiKey: string | null): Promise<ProviderModelList> {
  if (!baseUrl) return { models: [], note: 'Set a base URL first.' }
  try {
    const response = await fetch(`${trimSlash(baseUrl)}/models`, {
      headers: {
        accept: 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (response.status === 401 || response.status === 403) {
      return { models: [], note: 'The provider rejected the key. Check it in Settings.' }
    }
    if (!response.ok) {
      return { models: [], note: `The provider answered ${response.status}.` }
    }
    const payload = (await response.json()) as { data?: Array<{ id?: string; owned_by?: string }> }
    const models = (payload.data ?? [])
      .map((entry) => model(entry.id ?? '', entry.id ?? '', entry.owned_by ?? ''))
      .filter((entry) => entry.id.length > 0)
    return { models, note: models.length ? null : 'The provider listed no models.' }
  } catch (error) {
    logger.warn('Could not list models', providerIdHint(baseUrl), error)
    return { models: [], note: `Could not reach the provider: ${(error as Error).message}` }
  }
}

/** Anthropic: `/models` with the API-key header. */
async function listAnthropicModels(baseUrl: string, apiKey: string | null): Promise<ProviderModelList> {
  if (!baseUrl) return { models: [], note: 'Set a base URL first.' }
  if (!apiKey) return { models: [], note: 'Add an Anthropic API key first.' }
  try {
    const response = await fetch(`${trimSlash(baseUrl)}/models`, {
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (response.status === 401 || response.status === 403) {
      return { models: [], note: 'Anthropic rejected the key. Check it in Settings.' }
    }
    if (!response.ok) return { models: [], note: `Anthropic answered ${response.status}.` }
    const payload = (await response.json()) as { data?: Array<{ id?: string; display_name?: string }> }
    const models = (payload.data ?? [])
      .map((entry) => model(entry.id ?? '', entry.display_name || entry.id || '', 'anthropic'))
      .filter((entry) => entry.id.length > 0)
    return { models, note: models.length ? null : 'Anthropic listed no models.' }
  } catch (error) {
    return { models: [], note: `Could not reach Anthropic: ${(error as Error).message}` }
  }
}

/** Gemini: `/models` with the key in the query. */
async function listGeminiModels(baseUrl: string, apiKey: string | null): Promise<ProviderModelList> {
  if (!baseUrl) return { models: [], note: 'Set a base URL first.' }
  if (!apiKey) return { models: [], note: 'Add a Google AI Studio key first.' }
  try {
    const url = `${trimSlash(baseUrl)}/models?key=${encodeURIComponent(apiKey)}`
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (response.status === 401 || response.status === 403) {
      return { models: [], note: 'Google rejected the key. Check it in Settings.' }
    }
    if (!response.ok) return { models: [], note: `Google answered ${response.status}.` }
    const payload = (await response.json()) as { models?: Array<{ name?: string; displayName?: string }> }
    const models = (payload.models ?? [])
      .map((entry) => {
        const id = (entry.name ?? '').replace(/^models\//, '')
        return model(id, entry.displayName || id, 'google')
      })
      .filter((entry) => entry.id.length > 0)
    return { models, note: models.length ? null : 'Google listed no models.' }
  } catch (error) {
    return { models: [], note: `Could not reach Google: ${(error as Error).message}` }
  }
}

function providerIdHint(baseUrl: string): string {
  return baseUrl
}
