import type { ChatOptions, Provider, TestOptions } from './types'
import { errorText, parseDataUrl, rawLines, trimSlash } from './http'

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

    const res = await fetch(`${trimSlash(options.baseUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        stream: true,
        messages,
        options: { temperature: options.temperature ?? 0.7 }
      }),
      signal: options.signal
    })
    if (!res.ok) throw new Error(await errorText(res))
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
  },

  async test(options: TestOptions) {
    const started = Date.now()
    try {
      const res = await fetch(`${trimSlash(options.baseUrl)}/api/tags`)
      if (!res.ok) return { ok: false, detail: await errorText(res) }
      const json = (await res.json()) as { models?: { name: string }[] }
      const names = (json.models ?? []).map((m) => m.name).slice(0, 5)
      return {
        ok: true,
        detail: names.length ? `Connected — models: ${names.join(', ')}` : 'Connected (no models pulled yet)',
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return { ok: false, detail: (error as Error).message }
    }
  }
}
