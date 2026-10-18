import type { ChatOptions, ChatTurn, Provider, TestOptions, TranscribeOptions } from './types'
import { sseJson, trimSlash } from './http'
import { classifyThrown, describeFailure } from './errors'
import { openResponse, responseDetail } from './request'

const PROVIDER = 'openai'

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
    return new Error(
      `${error.message} ${detail} Available models here: ${preview}${more}`
    )
  } catch {
    return error
  }
}

function toOpenAIMessage(turn: ChatTurn): unknown {
  if (!turn.images?.length) return { role: turn.role, content: turn.text }
  return {
    role: turn.role,
    content: [
      { type: 'text', text: turn.text },
      ...turn.images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } }))
    ]
  }
}

/** OpenAI Chat Completions. Also powers any OpenAI-compatible endpoint. */
export const openAICompatible: Provider = {
  id: 'openai',

  async *chat(options: ChatOptions): AsyncGenerator<string> {
    const res = await openResponse(
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
    try {
      const res = await fetch(`${trimSlash(options.baseUrl)}/models`, {
        headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}
      })
      if (!res.ok) return { ok: false, detail: await responseDetail(res, PROVIDER) }
      return { ok: true, detail: 'Connected', latencyMs: Date.now() - started }
    } catch (error) {
      return { ok: false, detail: describeFailure(error, PROVIDER) }
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
