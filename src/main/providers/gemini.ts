import type { ChatOptions, ChatTurn, Provider, TestOptions } from './types'
import { errorText, parseDataUrl, sseJson, trimSlash } from './http'

function toParts(turn: ChatTurn): unknown[] {
  const parts: unknown[] = [{ text: turn.text }]
  for (const image of turn.images ?? []) {
    const { mime, base64 } = parseDataUrl(image.dataUrl)
    parts.push({ inline_data: { mime_type: mime, data: base64 } })
  }
  return parts
}

export const gemini: Provider = {
  id: 'gemini',

  async *chat(options: ChatOptions): AsyncGenerator<string> {
    const contents = options.turns
      .filter((turn) => turn.role !== 'system')
      .map((turn) => ({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: toParts(turn)
      }))

    const url =
      `${trimSlash(options.baseUrl)}/models/${encodeURIComponent(options.model)}` +
      `:streamGenerateContent?alt=sse&key=${encodeURIComponent(options.apiKey ?? '')}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents,
        ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          ...(options.maxTokens ? { maxOutputTokens: options.maxTokens } : {})
        }
      }),
      signal: options.signal
    })
    if (!res.ok) throw new Error(await errorText(res))
    for await (const event of sseJson(res)) {
      const parts = event?.candidates?.[0]?.content?.parts ?? []
      for (const part of parts) {
        if (typeof part?.text === 'string' && part.text.length > 0) yield part.text
      }
    }
  },

  async test(options: TestOptions) {
    const started = Date.now()
    try {
      const res = await fetch(`${trimSlash(options.baseUrl)}/models?key=${encodeURIComponent(options.apiKey ?? '')}`)
      if (!res.ok) return { ok: false, detail: await errorText(res) }
      return { ok: true, detail: 'Connected', latencyMs: Date.now() - started }
    } catch (error) {
      return { ok: false, detail: (error as Error).message }
    }
  }
}
