import type { ChatOptions, ChatTurn, Provider, TestOptions, TranscribeOptions } from './types'
import { errorText, sseJson, trimSlash } from './http'

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
    const res = await fetch(`${trimSlash(options.baseUrl)}/chat/completions`, {
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
    })
    if (!res.ok) throw new Error(await errorText(res))
    for await (const event of sseJson(res)) {
      const delta = event?.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta.length > 0) yield delta
    }
  },

  async test(options: TestOptions) {
    const started = Date.now()
    try {
      const res = await fetch(`${trimSlash(options.baseUrl)}/models`, {
        headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}
      })
      if (!res.ok) return { ok: false, detail: await errorText(res) }
      return { ok: true, detail: 'Connected', latencyMs: Date.now() - started }
    } catch (error) {
      return { ok: false, detail: (error as Error).message }
    }
  },

  async transcribe(options: TranscribeOptions): Promise<string> {
    const blob = new Blob([options.audio], { type: options.mimeType })
    const form = new FormData()
    form.append('file', blob, 'audio.webm')
    form.append('model', options.model || 'whisper-1')
    const res = await fetch(`${trimSlash(options.baseUrl)}/audio/transcriptions`, {
      method: 'POST',
      headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {},
      body: form
    })
    if (!res.ok) throw new Error(await errorText(res))
    const json = (await res.json()) as { text?: string }
    return json.text ?? ''
  }
}
