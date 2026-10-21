import type { ChatOptions, ChatTurn, Provider, TestOptions } from './types'
import { parseDataUrl, sseJson, trimSlash, hostOf } from './http'
import { classifyThrown, describeFailure } from './errors'
import { openResponse, responseDetail } from './request'

const PROVIDER = 'gemini'

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

    const res = await openResponse(
      url,
      {
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
      },
      { provider: PROVIDER, signal: options.signal }
    )
    try {
      for await (const event of sseJson(res)) {
        const parts = event?.candidates?.[0]?.content?.parts ?? []
        for (const part of parts) {
          if (typeof part?.text === 'string' && part.text.length > 0) yield part.text
        }
      }
    } catch (error) {
      throw classifyThrown(error, { provider: PROVIDER, endpoint: hostOf(trimSlash(options.baseUrl)) })
    }
  },

  async test(options: TestOptions) {
    const started = Date.now()
    try {
      const res = await fetch(`${trimSlash(options.baseUrl)}/models?key=${encodeURIComponent(options.apiKey ?? '')}`)
      if (!res.ok) return { ok: false, detail: await responseDetail(res, PROVIDER) }
      return { ok: true, detail: 'Connected', latencyMs: Date.now() - started }
    } catch (error) {
      return { ok: false, detail: describeFailure(error, PROVIDER, hostOf(trimSlash(options.baseUrl))) }
    }
  }
}
