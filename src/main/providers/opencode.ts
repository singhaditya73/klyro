import type { ProviderTestResult } from '@shared/types'
import type { ChatOptions, ChatTurn, Provider, TestOptions } from './types'
import { classifyThrown, describeFailure, isProviderError, ProviderError } from './errors'
import { hostOf, trimSlash } from './http'

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
/**
 * How many quiet polls mean "the turn is over" when the server does not say
 * so itself. Ten polls is three seconds — long enough for a slow tool call,
 * short enough that a finished answer does not hang around.
 */
const IDLE_POLLS = 10

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
  info?: { id?: string; role?: string; time?: { created?: number } }
  model?: { id?: string; providerID?: string }
  time?: { created?: number }
  /** Only on the `idle` entry: how the turn ended. */
  outcome?: string
  /** Only on the `idle` entry: why it failed. */
  error?: { message?: string; type?: string }
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
    throw classifyThrown(error, { provider: PROVIDER, endpoint: hostOf(url) })
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

/**
 * Free models worth checking on connect — at most one per provider.
 *
 * The catalogue is ordered with OpenCode's own (Zen) models first, and a whole
 * provider can be signed out or out of credit. Taking one candidate per
 * provider means one dead provider does not hide every working one.
 */
export function freeModelCandidates(models: OpenCodeModelInfo[], limit = 3): OpenCodeModelInfo[] {
  const providers = new Set<string>()
  const picked: OpenCodeModelInfo[] = []
  for (const model of models) {
    if (!model.free || providers.has(model.providerID)) continue
    providers.add(model.providerID)
    picked.push(model)
    if (picked.length >= limit) break
  }
  return picked
}

/**
 * Does a model actually answer?
 *
 * A catalogue entry is not a promise: an OpenCode provider can be signed out,
 * out of credit, or unreachable, and then its turn never starts — the server
 * simply stays quiet. Klyro checks this once, when the user connects OpenCode,
 * so the model it saves is one that has answered a question. The check runs in
 * its own session and deletes it afterwards, so it leaves nothing behind in the
 * user's OpenCode history either.
 */
export async function probeOpenCodeModel(
  baseUrl: string,
  apiKey: string | null,
  model: string,
  providerID: string,
  timeoutMs = 6000
): Promise<{ answered: boolean; reason: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = controller.signal
  const seconds = Math.round(timeoutMs / 1000)
  let sessionId: string | undefined
  try {
    const created = await request<{ data?: { id?: string } }>(baseUrl, apiKey, '/api/session', {
      method: 'POST',
      body: JSON.stringify({ title: 'Klyro check' }),
      signal
    })
    sessionId = created?.data?.id
    if (!sessionId) return { answered: false, reason: 'the server did not create a session' }

    await request<unknown>(baseUrl, apiKey, `/api/session/${sessionId}/model`, {
      method: 'POST',
      body: JSON.stringify({ model: { id: model, providerID } }),
      signal
    }).catch(() => undefined)
    await request<unknown>(baseUrl, apiKey, `/api/session/${sessionId}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Reply with the single word: ok' }),
      signal
    })

    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      if (signal.aborted) break
      const listed = await request<{ data?: OpenCodeMessage[] }>(
        baseUrl,
        apiKey,
        `/api/session/${sessionId}/message`,
        { signal }
      )
      const list = listed?.data ?? []
      if (turnText(list).trim().length > 0) return { answered: true, reason: null }
      const idle = idleEntry(list)
      if (idle) {
        const reason = idle.error?.message?.trim()
        if (reason) return { answered: false, reason }
        return {
          answered: false,
          reason:
            idle.outcome && idle.outcome !== 'succeeded'
              ? `the turn ended: ${idle.outcome}`
              : 'the turn ended without text'
        }
      }
    }
    return { answered: false, reason: `no answer in ${seconds} s` }
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || isProviderError(error))) {
      return { answered: false, reason: `no answer in ${seconds} s` }
    }
    return { answered: false, reason: (error as Error).message }
  } finally {
    clearTimeout(timer)
    if (sessionId) {
      // Deliberately not the aborted signal: the cleanup should still run when
      // the check timed out, but it must not hold the caller for long either.
      const cleanup = new AbortController()
      const cleanupTimer = setTimeout(() => cleanup.abort(), 2000)
      await request<unknown>(baseUrl, apiKey, `/api/session/${sessionId}`, {
        method: 'DELETE',
        signal: cleanup.signal
      }).catch(() => undefined)
      clearTimeout(cleanupTimer)
    }
  }
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

/**
 * The images of the newest turn, as data URLs.
 *
 * OpenCode takes an image as a file whose `url` is a data URL, so the bytes
 * Klyro already has are enough — nothing has to be written to disk.
 */
function turnImages(turns: ChatTurn[]): { uri: string; name: string }[] {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn.role !== 'user' || !turn.images?.length) continue
    return turn.images.map((image, position) => ({
      uri: image.dataUrl,
      name: `klyro-image-${position + 1}.${image.mime.split('/')[1] ?? 'png'}`
    }))
  }
  return []
}

/** The text of an assistant message, from either API generation. */
function textOf(message: OpenCodeMessage): string {
  const parts = message.content ?? message.parts ?? []
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text ?? '')
    .join('')
}

/** Is this an assistant message, in either API generation? */
function isAssistant(message: OpenCodeMessage): boolean {
  return message.type === 'assistant' || message.info?.role === 'assistant'
}

/** Is this the user's own message? */
function isUser(message: OpenCodeMessage): boolean {
  return message.type === 'user' || message.info?.role === 'user'
}

/** When the message was written, whichever generation it came from. */
function createdAt(message: OpenCodeMessage): number | undefined {
  return message.time?.created ?? message.info?.time?.created
}

/**
 * The messages oldest first.
 *
 * The server lists a session newest first, so the list arrives in the wrong
 * order for reading a conversation. Timestamps are the honest way to sort it;
 * without them the server's own order is the only clue there is.
 */
function chronological(messages: OpenCodeMessage[]): OpenCodeMessage[] {
  const stamped = messages.some((message) => createdAt(message) !== undefined)
  if (!stamped) return [...messages].reverse()
  return [...messages].sort((a, b) => (createdAt(a) ?? 0) - (createdAt(b) ?? 0))
}

/**
 * Everything the assistant said during the current turn.
 *
 * A turn is not one message: the model can speak, call a tool, think, and then
 * speak again — and each of those is a separate message. Only the part after
 * the last user message belongs to this turn, and all of it is the answer.
 * Separate messages are separated by a line, the way they were said.
 */
function turnText(messages: OpenCodeMessage[]): string {
  const ordered = chronological(messages)
  let start = 0
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (isUser(ordered[index])) {
      start = index + 1
      break
    }
  }
  return ordered
    .slice(start)
    .filter(isAssistant)
    .map(textOf)
    .filter((text) => text.length > 0)
    .join('\n')
}

/**
 * The `idle` entry that closed the turn, with the reason it ended.
 *
 * The server says "the turn is over" with an `idle` entry, which is the only
 * honest signal: a model can be quiet for several seconds between two pieces
 * of its answer. The entry also says how the turn ended — and why it failed.
 */
function idleEntry(messages: OpenCodeMessage[]): OpenCodeMessage | null {
  const last = chronological(messages).at(-1)
  return last && last.type === 'idle' ? last : null
}

/**
 * A turn that ended without a word is a failure, not an empty answer.
 *
 * Klyro used to store an empty assistant message in that case, so the chat
 * showed a blank bubble and nothing else — the user could not tell a silent
 * model from a broken one. The error now names the model and what the server
 * did produce, because "said nothing" is not enough to act on: a model that is
 * not on the person's plan stalls, and only another model will answer.
 */
function noAnswerError(messages: OpenCodeMessage[], model?: string): ProviderError {
  const assistant = chronological(messages)
    .filter(isAssistant)
    .at(-1)
  const parts = (assistant?.content ?? assistant?.parts ?? [])
    .map((part) => part.type)
    .filter((part): part is string => Boolean(part))
  const which = model ? ` (model: ${model})` : ''
  const detail =
    parts.length > 0
      ? ` The model produced ${parts.join(', ')} but no answer text.`
      : ' The server produced no answer message at all.'
  return new ProviderError(
    `OpenCode finished the turn without an answer${which}.${detail} The provider may need a sign-in, or the model may not be available on your plan — pick another model with the chip in the overlay.`,
    { kind: 'unknown', provider: PROVIDER }
  )
}

/** The turn never started: the model is unavailable, not merely quiet. */
function stalledError(model: string | undefined, seconds: number): ProviderError {
  const which = model ? ` (model: ${model})` : ''
  return new ProviderError(
    `OpenCode did not answer within ${seconds} seconds${which}. The model may be unavailable on your OpenCode plan — pick another model with the chip in the overlay.`,
    { kind: 'timeout', provider: PROVIDER }
  )
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
    const images = turnImages(options.turns)

    const health = await probeOpenCode(baseUrl)
    if (!health.healthy) {
      throw new ProviderError(
        `No OpenCode server is running at ${baseUrl}. Start one with "opencode serve" — Klyro needs no key of its own.`,
        { kind: 'bad_request', provider: PROVIDER }
      )
    }

    if (health.generation === 'v1') {
      yield* chatV1(baseUrl, options.apiKey, options.model, prompt, images)
      return
    }
    yield* chatV2(baseUrl, options.apiKey, options.model, prompt, images)
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
  prompt: string,
  images: { uri: string; name: string }[]
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
      // A file part carries the image as a data URL.
      parts: [
        { type: 'text', text: prompt },
        ...images.map((image) => ({
          type: 'file',
          mime: image.uri.startsWith('data:') ? (image.uri.slice(5).split(';')[0] ?? 'image/png') : 'image/png',
          filename: image.name,
          url: image.uri
        }))
      ]
    })
  })

  let delivered = ''
  let quiet = 0
  let last: OpenCodeMessage[] = []
  while (quiet < MAX_QUIET_POLLS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    const messages = await request<OpenCodeMessage[]>(baseUrl, apiKey, `/session/${sessionId}/message?limit=20`)
    const list = messages ?? []
    last = list
    const text = turnText(list)
    if (text.length > delivered.length) {
      const delta = text.slice(delivered.length)
      delivered = text
      quiet = 0
      yield delta
      continue
    }
    quiet += 1
    // The server has no "turn over" marker in this generation, so a turn that
    // stays quiet for a while is over. Generous enough to survive a slow tool.
    if (quiet > IDLE_POLLS && delivered.length > 0) break
  }

  if (delivered.length === 0) throw noAnswerError(last, model)
}

/** v2: the API lives under /api, and answers are read back from the session. */
async function* chatV2(
  baseUrl: string,
  apiKey: string | null,
  model: string | undefined,
  prompt: string,
  images: { uri: string; name: string }[]
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
    // An image travels as a file whose uri is a data URL.
    body: JSON.stringify({ text: prompt, ...(images.length ? { files: images } : {}) })
  })

  let delivered = ''
  let quiet = 0
  let idleSeen = false
  let last: OpenCodeMessage[] = []
  while (quiet < MAX_QUIET_POLLS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    const messages = await request<{ data?: OpenCodeMessage[] }>(baseUrl, apiKey, `/api/session/${sessionId}/message`)
    const list = messages.data ?? []
    last = list
    const idle = idleEntry(list)
    if (idle) idleSeen = true

    // A turn that failed is reported with the server's own reason: that is
    // the answer to "why did my chat come back empty?".
    if (idle?.outcome === 'failed') {
      const reason = idle.error?.message?.trim()
      throw new ProviderError(
        `OpenCode could not finish the turn${reason ? `: ${reason}` : '.'}`,
        { kind: 'server', provider: PROVIDER, detail: reason }
      )
    }
    if (idle?.outcome === 'interrupted') {
      throw new ProviderError('OpenCode was interrupted before the turn finished.', {
        kind: 'cancelled',
        provider: PROVIDER
      })
    }

    const text = turnText(list)
    if (text.length > delivered.length) {
      const delta = text.slice(delivered.length)
      delivered = text
      quiet = 0
      yield delta
      // The server marks the end of the turn with an `idle` entry. Waiting for
      // it is the only way to be sure the answer is whole: a model can go
      // quiet for seconds between a tool call and the rest of its reply.
      if (idle) break
      continue
    }
    quiet += 1
    if (idle) {
      // The turn is over: either it said nothing at all, or what it said is
      // already delivered.
      if (delivered.length === 0) throw noAnswerError(last, model)
      break
    }
    // Fallback for a server that never says "idle": a turn that stays quiet
    // for a while is over. Generous enough to survive a slow tool call.
    if (quiet > IDLE_POLLS && delivered.length > 0) break
  }

  if (delivered.length === 0) {
    // No `idle` means the server never started the turn — the model is not
    // reachable (signed out, out of credit, or not on this plan).
    if (!idleSeen) throw stalledError(model, Math.round((MAX_QUIET_POLLS * POLL_MS) / 1000))
    throw noAnswerError(last, model)
  }
}
