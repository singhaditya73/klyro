import type { ChatOptions, ChatTurn, Provider, TestOptions, TranscribeOptions } from './types'
import { sseJson, trimSlash } from './http'
import { classifyThrown, describeFailure } from './errors'
import { openResponse, responseDetail } from './request'

const PROVIDER = 'openai'

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
      throw classifyThrown(error, { provider: PROVIDER })
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
