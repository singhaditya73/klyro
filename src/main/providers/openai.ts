import type { ProviderId } from '@shared/types'
import type { ChatOptions, ChatTurn, Provider, ProviderChunk, ProviderToolSpec, TestOptions, TranscribeOptions } from './types'
import { sseJson, trimSlash, hostOf } from './http'
import { classifyThrown, describeFailure, isProviderError, ProviderError } from './errors'
import { openResponse, responseDetail } from './request'

/**
 * A 404 on chat almost always means a wrong model name or a wrong base URL.
 * The classiest way to help: ask the same endpoint which models it actually
 * serves and put the list in front of the user. Best effort — any failure in
 * this enrichment returns the original error untouched.
 */
async function enrichNotFound(error: unknown, options: ChatOptions): Promise<unknown> {
  const known = error instanceof Error && /(?:not found|404)/i.test(error.message)
  if (!known || !options.baseUrl) return error
  try {
    const res = await fetch(`${trimSlash(options.baseUrl)}/models`, {
      headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}
    })
    if (!res.ok) return error
    const json = (await res.json()) as { data?: Array<{ id?: string }> }
    const ids = (json.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) return error
    const wanted = (options.model ?? '').trim()
    const served = ids.includes(wanted)
    const preview = ids.slice(0, 8).join(', ')
    const more = ids.length > 8 ? ` … and ${ids.length - 8} more (see the endpoint's /models)` : ''
    const detail = served
      ? `The endpoint does serve "${wanted}", so the 404 is about something else.`
      : `"${wanted}" is not one of this endpoint's models.`
    // Keep the original classification (kind, status, retryability) so callers
    // can still make decisions; only the message is enriched.
    if (isProviderError(error)) {
      return new ProviderError(`${error.message} ${detail} Available models here: ${preview}${more}`, {
        kind: error.kind,
        provider: error.provider,
        status: error.status,
        retryAfterMs: error.retryAfterMs,
        retryable: error.retryable,
        detail: error.detail,
        endpoint: error.endpoint
      })
    }
    return new Error(
      `${error.message} ${detail} Available models here: ${preview}${more}`
    )
  } catch {
    return error
  }
}

function toOpenAIMessage(turn: ChatTurn): unknown {
  // A tool result answers a specific assistant call.
  if (turn.role === 'tool') {
    return { role: 'tool', tool_call_id: turn.toolCallId ?? '', content: turn.text }
  }
  // An assistant turn that made tool calls carries them alongside any prose.
  if (turn.toolCalls && turn.toolCalls.length > 0) {
    return {
      role: turn.role,
      content: turn.text.length > 0 ? turn.text : null,
      tool_calls: turn.toolCalls.map((call) => ({
        type: 'function',
        id: call.id,
        function: { name: call.name, arguments: call.argsJson }
      }))
    }
  }
  if (!turn.images?.length) return { role: turn.role, content: turn.text }
  return {
    role: turn.role,
    content: [
      { type: 'text', text: turn.text },
      ...turn.images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } }))
    ]
  }
}

/** Tool fragments arrive spread across chunks; reassemble them by index. */
interface PendingCall {
  id: string
  name: string
  args: string
}

/**
 * OpenAI Chat Completions. Also powers any OpenAI-compatible endpoint.
 *
 * One adapter serves three Settings slots — OpenAI, Groq and a custom
 * OpenAI-compatible endpoint — so the slot has to travel with the adapter.
 * It used to be hardcoded to "openai", which made Klyro blame OpenAI for
 * somebody else's outage: a Groq that could not be reached was reported as
 * "Could not reach OpenAI", and the user was sent to the wrong Settings card.
 * Each slot now gets its own adapter, and its own name in every error.
 */
export function openAICompatibleFor(providerId: ProviderId = 'openai'): Provider {
  const PROVIDER = providerId
  return {
    id: providerId,

    /** Streaming chat with function calling (OpenAI-compatible endpoints). */
    async *chatWithTools(options: ChatOptions & { tools: ProviderToolSpec[] }): AsyncGenerator<ProviderChunk> {
      let res: Awaited<ReturnType<typeof openResponse>>
      try {
        res = await openResponse(
          `${trimSlash(options.baseUrl)}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {})
            },
            body: JSON.stringify({
              model: options.model,
              stream: true,
              temperature: options.temperature ?? 0.7,
              ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
              tools: options.tools.map((tool) => ({ type: 'function', function: tool })),
              messages: [
                ...(options.system ? [{ role: 'system', content: options.system }] : []),
                ...options.turns.map(toOpenAIMessage)
              ]
            }),
            signal: options.signal
          },
          { provider: PROVIDER, signal: options.signal }
        )
      } catch (error) {
        throw await enrichNotFound(classifyThrown(error, { provider: PROVIDER }), options)
      }

      const pending = new Map<number, PendingCall>()
      try {
        for await (const event of sseJson(res)) {
          const choice = event?.choices?.[0]
          const delta = choice?.delta
          const content = delta?.content
          if (typeof content === 'string' && content.length > 0) yield { kind: 'text', text: content }
          const fragments = delta?.tool_calls
          if (Array.isArray(fragments)) {
            for (const fragment of fragments as Array<Record<string, unknown>>) {
              const index = typeof fragment.index === 'number' ? fragment.index : pending.size
              const current = pending.get(index) ?? { id: '', name: '', args: '' }
              if (typeof fragment.id === 'string' && fragment.id) current.id = fragment.id
              const fn = fragment.function as Record<string, unknown> | undefined
              if (typeof fn?.name === 'string' && fn.name) current.name = fn.name
              if (typeof fn?.arguments === 'string') current.args += fn.arguments
              pending.set(index, current)
            }
          }
          if (choice?.finish_reason === 'tool_calls') break
        }
      } catch (error) {
        throw await enrichNotFound(classifyThrown(error, { provider: PROVIDER }), options)
      }

      const calls = [...pending.values()]
        .filter((call) => call.id && call.name)
        .map((call) => ({ id: call.id, name: call.name, argsJson: call.args.slice(0, 200000) }))
      if (calls.length > 0) yield { kind: 'tool_calls', calls }
    },

    async *chat(options: ChatOptions): AsyncGenerator<string> {
      // openResponse can fail before any stream starts (a wrong model name 404s
      // here), so it sits in its own try so the same not-found enrichment applies.
      let res: Awaited<ReturnType<typeof openResponse>>
      try {
        res = await openResponse(
          `${trimSlash(options.baseUrl)}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {})
            },
            body: JSON.stringify({
              model: options.model,
              stream: true,
              temperature: options.temperature ?? 0.7,
              ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
              messages: [
                ...(options.system ? [{ role: 'system', content: options.system }] : []),
                ...options.turns.map(toOpenAIMessage)
              ]
            }),
            signal: options.signal
          },
          { provider: PROVIDER, signal: options.signal }
        )
      } catch (error) {
        throw await enrichNotFound(classifyThrown(error, { provider: PROVIDER }), options)
      }
      try {
        for await (const event of sseJson(res)) {
          const delta = event?.choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) yield delta
        }
      } catch (error) {
        // A stream that dies mid-answer lands here; classify it for the caller.
        throw await enrichNotFound(classifyThrown(error, { provider: PROVIDER }), options)
      }
    },

    async test(options: TestOptions) {
      const started = Date.now()
      const endpoint = hostOf(trimSlash(options.baseUrl))
      try {
        const res = await fetch(`${trimSlash(options.baseUrl)}/models`, {
          headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}
        })
        if (!res.ok) return { ok: false, detail: await responseDetail(res, PROVIDER) }
        return { ok: true, detail: 'Connected', latencyMs: Date.now() - started }
      } catch (error) {
        return { ok: false, detail: describeFailure(error, PROVIDER, endpoint) }
      }
    },

    async transcribe(options: TranscribeOptions): Promise<string> {
      const res = await openResponse(
        `${trimSlash(options.baseUrl)}/audio/transcriptions`,
        () => {
          const blob = new Blob([options.audio], { type: options.mimeType })
          const form = new FormData()
          form.append('file', blob, 'audio.webm')
          form.append('model', options.model || 'whisper-1')
          return {
            method: 'POST',
            headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {},
            body: form
          }
        },
        { provider: PROVIDER }
      )
      const json = (await res.json()) as { text?: string }
      return json.text ?? ''
    }
  }
}

/** The OpenAI slot itself. */
export const openAICompatible: Provider = openAICompatibleFor('openai')
