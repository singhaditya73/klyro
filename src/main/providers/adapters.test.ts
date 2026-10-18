import { afterEach, describe, expect, it, vi } from 'vitest'
import { isProviderError } from './errors'
import { anthropic } from './anthropic'
import { gemini } from './gemini'
import { ollama } from './ollama'
import { openAICompatible } from './openai'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function collect(source: AsyncGenerator<string>): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of source) chunks.push(chunk)
  return chunks
}

function sse(...lines: string[]): Response {
  return new Response(`${lines.join('\n')}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}

describe('openAICompatible adapter', () => {
  it('streams deltas and sends the key only as an auth header', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      expect(headers.authorization).toBe('Bearer sk-test')
      return sse(
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        'data: [DONE]'
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const chunks = await collect(
      openAICompatible.chat({
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        turns: [{ role: 'user', text: 'hi' }]
      })
    )
    expect(chunks).toEqual(['Hel', 'lo'])
  })

  it('surfaces a rejected key as an actionable error, not a raw status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"message":"Incorrect API key provided"}}', { status: 401 }))
    )

    await expect(
      collect(
        openAICompatible.chat({
          model: 'gpt-4o-mini',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'bad',
          turns: [{ role: 'user', text: 'hi' }]
        })
      )
    ).rejects.toMatchObject({ kind: 'auth' })
  })

  it('classifies a mid-stream failure instead of leaking a raw type error', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
        controller.error(Object.assign(new Error('terminated'), { code: 'UND_ERR_SOCKET' }))
      }
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)))

    try {
      await collect(
        openAICompatible.chat({
          model: 'gpt-4o-mini',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          turns: [{ role: 'user', text: 'hi' }]
        })
      )
      throw new Error('expected the stream to fail')
    } catch (error) {
      expect(isProviderError(error)).toBe(true)
      expect((error as { kind: string }).kind).toBe('network')
    }
  })
})

describe('other adapters', () => {
  it('reads Anthropic text deltas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse(
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}'
        )
      )
    )
    const chunks = await collect(
      anthropic.chat({
        model: 'claude-3-5-sonnet-latest',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'key',
        turns: [{ role: 'user', text: 'hi' }]
      })
    )
    expect(chunks.join('')).toBe('Hi there')
  })

  it('reads Gemini candidate parts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sse('data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}'))
    )
    const chunks = await collect(
      gemini.chat({
        model: 'gemini-2.0-flash',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'key',
        turns: [{ role: 'user', text: 'hi' }]
      })
    )
    expect(chunks).toEqual(['Hello'])
  })

  it('reads Ollama NDJSON and stops at done', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"message":{"content":"Hello"}}\n{"message":{"content":" world"}}\n{"done":true}\n{"message":{"content":"ignored"}}\n')
      )
    )
    const chunks = await collect(
      ollama.chat({
        model: 'llama3.1',
        baseUrl: 'http://localhost:11434',
        apiKey: null,
        turns: [{ role: 'user', text: 'hi' }]
      })
    )
    expect(chunks.join('')).toBe('Hello world')
  })
})
