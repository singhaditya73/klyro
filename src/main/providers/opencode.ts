import type { ProviderTestResult } from '@shared/types'
import type { ChatOptions, ChatTurn, Provider, TestOptions } from './types'
import { classifyThrown, describeFailure, isProviderError, ProviderError } from './errors'
import { trimSlash } from './http'

const PROVIDER = 'opencode'

/**
 * OpenCode, as a local provider.
 *
 * OpenCode runs a headless HTTP server (`opencode serve`, 127.0.0.1:4096) whose
 * API is published as an OpenAPI spec at `/openapi.json`. Because the *server*
 * makes the model calls with the user's own OpenCode account, Klyro needs no
 * API key at all — the user keeps their subscription, their free models and
 * their limits, and Klyro simply asks the local server a question.
 *
 * This is the honest way to "borrow" an agent's models: talk to the agent the
 * user already runs, on their machine, over localhost.
 *
 * Two API generations are supported:
 *  - v2 (current): `/api/...`, responses wrapped as `{data: ...}`, messages
 *    delivered through an inbox and read back from the session.
 *  - v1 (older): `/session/...`, `{info, parts}` message payloads.
 * The generation is detected at runtime, so the provider works with whatever
 * the user has installed.
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:4096'
const REQUEST_TIMEOUT_MS = 120000
/** How often the session is polled for new answer text. */
const POLL_MS = 300
/** Stop polling after this many quiet polls (the answer is finished). */
const MAX_QUIET_POLLS = 60

interface OpenCodeModel {
  id?: string
  modelID?: string
  providerID?: string
  name?: string
  free?: boolean
}

interface OpenCodeMessage {
  type?: string
  role?: string
  content?: Array<{ type?: string; text?: string }>
  parts?: Array<{ type?: string; text?: string }>
  info?: { id?: string; role?: string }
  model?: { id?: string; providerID?: string }
}

/** Basic auth for a password-protected `opencode serve`. */
function authHeader(password: string | null): Record<string, string> {
  if (!password) return {}
  const encoded = Buffer.from(`opencode:${password}`).toString('base64')
  return { authorization: `Basic ${encoded}` }
}

async function request<T>(
  baseUrl: string,
  apiKey: string | null,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = `${trimSlash(baseUrl || DEFAULT_BASE_URL)}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      ...init,
      signal: init.signal ?? controller.signal,
      headers: {
        // Without this the server answers with its web UI instead of JSON.
        accept: 'application/json',
        'content-type': 'application/json',
        ...authHeader(apiKey),
        ...(init.headers ?? {})
      }
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      if (response.status === 401) {
        throw new ProviderError(
          'OpenCode rejected the request. If your server sets OPENCODE_SERVER_PASSWORD, put that password in the API key field.',
          { kind: 'auth', provider: PROVIDER }
        )
      }
      if (response.status === 404) {
        throw new ProviderError(`OpenCode has no endpoint at ${path}.`, { kind: 'bad_request', provider: PROVIDER })
      }
      throw new ProviderError(`OpenCode replied ${response.status}: ${body.slice(0, 300)}`, {
        kind: 'bad_request',
        provider: PROVIDER
      })
    }
    const text = await response.text()
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new ProviderError('OpenCode returned a response Klyro could not read.', {
        kind: 'bad_request',
        provider: PROVIDER
      })
    }
  } catch (error) {
    if (isProviderError(error)) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError('OpenCode did not answer in time.', { kind: 'timeout', provider: PROVIDER })
    }
    throw classifyThrown(error, { provider: PROVIDER })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Is an OpenCode server running here?
 *
 * A protected server answers 401 — that is still "running", so it is reported
 * separately: the user only has to paste the password once, and the server is
 * genuinely there.
 */
export async function probeOpenCode(baseUrl: string, password?: string | null): Promise<{
  healthy: boolean
  needsAuth: boolean
  version?: string
  baseUrl: string
  generation: 'v1' | 'v2' | 'none'
}> {
  const root = trimSlash(baseUrl || DEFAULT_BASE_URL)
  const attempt = async (path: string): Promise<'ok' | 'auth' | 'no'> => {
    try {
      const response = await fetch(`${root}${path}`, {
        headers: { accept: 'application/json', ...authHeader(password ?? null) },
        signal: AbortSignal.timeout(2500)
      })
      if (response.status === 401 || response.status === 403) return 'auth'
      if (!response.ok) return 'no'
      return 'ok'
    } catch {
      return 'no'
    }
  }

  // v2 exposes its model catalogue; v1 exposes its provider list.
  const v2 = await attempt('/api/model')
  if (v2 === 'ok') return { healthy: true, needsAuth: false, baseUrl, generation: 'v2' }
  if (v2 === 'auth') return { healthy: true, needsAuth: true, baseUrl, generation: 'v2' }
  const v1 = await attempt('/provider')
  if (v1 === 'ok') return { healthy: true, needsAuth: false, baseUrl, generation: 'v1' }
  if (v1 === 'auth') return { healthy: true, needsAuth: true, baseUrl, generation: 'v1' }
  return { healthy: false, needsAuth: false, baseUrl, generation: 'none' }
}

export interface OpenCodeModelInfo {
  id: string
  name: string
  providerID: string
  free: boolean
}

/** The models this OpenCode server can reach (with its own auth). */
export async function listOpenCodeModels(baseUrl: string, apiKey: string | null): Promise<OpenCodeModelInfo[]> {
  const root = trimSlash(baseUrl || DEFAULT_BASE_URL)
  const v2 = await request<{ data?: OpenCodeModel[] }>(root, apiKey, '/api/model').catch(() => null)
  if (v2 && Array.isArray(v2.data)) {
    return v2.data
      .map((model) => ({
        id: model.modelID || model.id || '',
        name: model.name || model.modelID || model.id || '',
        providerID: model.providerID || 'opencode',
        free: model.free === true || /:free$|-free$| free$/i.test(`${model.id ?? ''}`)
      }))
      .filter((model) => model.id.length > 0)
  }
  const v1 = await request<{ all?: Array<{ id?: string; models?: Record<string, { id?: string; name?: string }> }> }>(
    root,
    apiKey,
    '/provider'
  ).catch(() => null)
  if (!v1 || !Array.isArray(v1.all)) return []
  const models: OpenCodeModelInfo[] = []
  for (const provider of v1.all) {
    for (const model of Object.values(provider.models ?? {})) {
      const id = model.id ?? ''
      if (id) models.push({ id, name: model.name || id, providerID: provider.id ?? 'opencode', free: false })
    }
  }
  return models
}

/** Turn our chat turns into the text OpenCode should see. */
function turnsToText(turns: ChatTurn[]): string {
  return turns
    .filter((turn) => turn.role !== 'tool')
    .map((turn) => {
      const label = turn.role === 'assistant' ? 'Klyro' : turn.role === 'system' ? 'System' : 'User'
      return `${label}: ${turn.text}`
    })
    .join('\n\n')
}

/** The text of an assistant message, from either API generation. */
function textOf(message: OpenCodeMessage): string {
  const parts = message.content ?? message.parts ?? []
  return parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('')
}

export const openCodeProvider: Provider = {
  id: 'opencode',

  async test(options: TestOptions): Promise<ProviderTestResult> {
    const started = Date.now()
    try {
      const health = await probeOpenCode(options.baseUrl)
      if (!health.healthy) {
        return {
          ok: false,
          detail: `No OpenCode server answered at ${trimSlash(options.baseUrl || DEFAULT_BASE_URL)}. Start one with "opencode serve" and try again.`
        }
      }
      const models = await listOpenCodeModels(options.baseUrl, options.apiKey)
      const free = models.filter((model) => model.free).length
      return {
        ok: true,
        detail: `OpenCode is running (${health.generation}) with ${models.length} model${models.length === 1 ? '' : 's'}${free ? `, ${free} of them free` : ''}. Klyro needs no key — the server answers with your own account.`,
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return { ok: false, detail: describeFailure(error) }
    }
  },

  async *chat(options: ChatOptions): AsyncGenerator<string, void, unknown> {
    const baseUrl = trimSlash(options.baseUrl || DEFAULT_BASE_URL)
    const prompt = turnsToText(options.turns)
    if (!prompt.trim()) return

    const health = await probeOpenCode(baseUrl)
    if (!health.healthy) {
      throw new ProviderError(
        `No OpenCode server is running at ${baseUrl}. Start one with "opencode serve" — Klyro needs no key of its own.`,
        { kind: 'bad_request', provider: PROVIDER }
      )
    }

    if (health.generation === 'v1') {
      yield* chatV1(baseUrl, options.apiKey, options.model, prompt)
      return
    }
    yield* chatV2(baseUrl, options.apiKey, options.model, prompt)
  }
}

/** Which provider serves a given model id? The catalogue knows; ask it. */
const providerCache = new Map<string, { at: number; models: OpenCodeModelInfo[] }>()
const PROVIDER_CACHE_MS = 60_000

async function resolveProviderId(
  baseUrl: string,
  apiKey: string | null,
  model: string
): Promise<string> {
  const key = trimSlash(baseUrl)
  const cached = providerCache.get(key)
  let models = cached && Date.now() - cached.at < PROVIDER_CACHE_MS ? cached.models : null
  if (!models) {
    models = await listOpenCodeModels(baseUrl, apiKey).catch(() => [] as OpenCodeModelInfo[])
    providerCache.set(key, { at: Date.now(), models })
  }
  const exact = models.find((entry) => entry.id === model)
  if (exact) return exact.providerID
  // Ids like "opencode/big-pickle" carry their provider in the name.
  const slash = model.indexOf('/')
  if (slash > 0) return model.slice(0, slash)
  return 'opencode'
}

/** v1: sessions and messages live at the root of the server. */
async function* chatV1(
  baseUrl: string,
  apiKey: string | null,
  model: string | undefined,
  prompt: string
): AsyncGenerator<string, void, unknown> {
  const session = await request<{ id?: string }>(baseUrl, apiKey, '/session', {
    method: 'POST',
    body: JSON.stringify({ title: 'Klyro' })
  })
  const sessionId = session.id
  if (!sessionId) throw new ProviderError('OpenCode did not return a session id.', { kind: 'bad_request', provider: PROVIDER })

  await request<unknown>(baseUrl, apiKey, `/session/${sessionId}/message`, {
    method: 'POST',
    body: JSON.stringify({
      model: model ? { providerID: 'opencode', modelID: model } : undefined,
      parts: [{ type: 'text', text: prompt }]
    })
  })

  let delivered = ''
  let quiet = 0
  while (quiet < MAX_QUIET_POLLS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    const messages = await request<OpenCodeMessage[]>(baseUrl, apiKey, `/session/${sessionId}/message?limit=20`)
    const last = [...(messages ?? [])].reverse().find((message) => message.info?.role === 'assistant')
    const text = last ? textOf(last) : ''
    if (text.length > delivered.length) {
      const delta = text.slice(delivered.length)
      delivered = text
      quiet = 0
      yield delta
      continue
    }
    quiet += 1
    if (quiet > 2 && delivered.length > 0) break
  }
}

/** v2: the API lives under /api, and answers are read back from the session. */
async function* chatV2(
  baseUrl: string,
  apiKey: string | null,
  model: string | undefined,
  prompt: string
): AsyncGenerator<string, void, unknown> {
  const created = await request<{ data?: { id?: string } }>(baseUrl, apiKey, '/api/session', {
    method: 'POST',
    body: JSON.stringify({ title: 'Klyro' })
  })
  const sessionId = created.data?.id
  if (!sessionId) throw new ProviderError('OpenCode did not return a session id.', { kind: 'bad_request', provider: PROVIDER })

  if (model) {
    // The model is set on the session, then the prompt is queued. The model
    // reference needs both the id and the provider that serves it.
    const providerID = await resolveProviderId(baseUrl, apiKey, model)
    await request<unknown>(baseUrl, apiKey, `/api/session/${sessionId}/model`, {
      method: 'POST',
      body: JSON.stringify({ model: { id: model, providerID } })
    }).catch(() => undefined)
  }

  await request<unknown>(baseUrl, apiKey, `/api/session/${sessionId}/prompt`, {
    method: 'POST',
    body: JSON.stringify({ text: prompt })
  })

  let delivered = ''
  let quiet = 0
  while (quiet < MAX_QUIET_POLLS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    const messages = await request<{ data?: OpenCodeMessage[] }>(baseUrl, apiKey, `/api/session/${sessionId}/message`)
    const list = messages.data ?? []
    const last = [...list].reverse().find((message) => message.type === 'assistant')
    const text = last ? textOf(last) : ''
    if (text.length > delivered.length) {
      const delta = text.slice(delivered.length)
      delivered = text
      quiet = 0
      yield delta
      continue
    }
    quiet += 1
    if (quiet > 2 && delivered.length > 0) break
  }
}
