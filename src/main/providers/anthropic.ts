import type { ChatOptions, ChatTurn, Provider, TestOptions } from './types'
import { errorText, parseDataUrl, sseJson, trimSlash } from './http'

const API_VERSION = '2023-06-01'

function toAnthropicContent(turn: ChatTurn): unknown {
  if (!turn.images?.length) return turn.text
  return [
    ...turn.images.map((image) => {
      const { mime, base64 } = parseDataUrl(image.dataUrl)
      return { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } }
    }),
    { type: 'text', text: turn.text }
  ]
}

export const anthropic: Provider = {
  id: 'anthropic',

  async *chat(options: ChatOptions): AsyncGenerator<string> {
    const messages = options.turns
      .filter((turn) => turn.role !== 'system')
      .map((turn) => ({ role: turn.role, content: toAnthropicContent(turn) }))

    const res = await fetch(`${trimSlash(options.baseUrl)}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': options.apiKey ?? '',
        'anthropic-version': API_VERSION
      },
      body: JSON.stringify({
        model: options.model,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
        ...(options.system ? { system: options.system } : {}),
        messages,
        stream: true
      }),
      signal: options.signal
    })
    if (!res.ok) throw new Error(await errorText(res))
    for await (const event of sseJson(res)) {
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        yield event.delta.text as string
      }
    }
  },

  async test(options: TestOptions) {
    const started = Date.now()
    try {
      const res = await fetch(`${trimSlash(options.baseUrl)}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey ?? '',
          'anthropic-version': API_VERSION
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }]
        })
      })
      if (!res.ok) return { ok: false, detail: await errorText(res) }
      return { ok: true, detail: 'Connected', latencyMs: Date.now() - started }
    } catch (error) {
      return { ok: false, detail: (error as Error).message }
    }
  }
}
