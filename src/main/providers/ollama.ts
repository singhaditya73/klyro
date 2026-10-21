import type { ChatOptions, Provider, TestOptions } from './types'
import { parseDataUrl, rawLines, trimSlash, hostOf } from './http'
import { classifyThrown, describeFailure } from './errors'
import { openResponse, responseDetail } from './request'

const PROVIDER = 'ollama'

/**
 * Ollama's own routes, without the "/v1" an OpenAI-compatible base URL
 * carries.
 */
function ollamaBase(baseUrl: string): string {
  const base = trimSlash(baseUrl)
  return base.endsWith('/v1') ? base.slice(0, -3) : base
}

/** Local models via Ollama's native API (no API key required). */
export const ollama: Provider = {
  id: 'ollama',

  async *chat(options: ChatOptions): AsyncGenerator<string> {
    const messages = [
      ...(options.system ? [{ role: 'system', content: options.system }] : []),
      ...options.turns.map((turn) => ({
        role: turn.role,
        content: turn.text,
        ...(turn.images?.length
          ? { images: turn.images.map((image) => parseDataUrl(image.dataUrl).base64) }
          : {})
      }))
    ]

    const res = await openResponse(
      `${ollamaBase(options.baseUrl)}/api/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: options.model,
          stream: true,
          messages,
          options: { temperature: options.temperature ?? 0.7 }
        }),
        signal: options.signal
      },
      { provider: PROVIDER, signal: options.signal }
    )
    try {
      for await (const line of rawLines(res)) {
        let json: any
        try {
          json = JSON.parse(line)
        } catch {
          continue
        }
        const content = json?.message?.content
        if (typeof content === 'string' && content.length > 0) yield content
        if (json?.done) return
      }
    } catch (error) {
      throw classifyThrown(error, { provider: PROVIDER, endpoint: hostOf(trimSlash(options.baseUrl)) })
    }
  },

  async test(options: TestOptions) {
    const started = Date.now()
    try {
      const res = await fetch(`${ollamaBase(options.baseUrl)}/api/tags`)
      if (!res.ok) return { ok: false, detail: await responseDetail(res, PROVIDER) }
      const json = (await res.json()) as { models?: { name: string }[] }
      const names = (json.models ?? []).map((m) => m.name).slice(0, 5)
      return {
        ok: true,
        detail: names.length ? `Connected — models: ${names.join(', ')}` : 'Connected (no models pulled yet)',
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return { ok: false, detail: describeFailure(error, PROVIDER, hostOf(trimSlash(options.baseUrl))) }
    }
  }
}
