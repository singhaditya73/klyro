import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderError } from './errors'
import { openResponse, responseDetail } from './request'

const noSleep = async (): Promise<void> => undefined

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('openResponse', () => {
  it('returns an acceptable response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })))
    const response = await openResponse('https://api.example.com/v1/models', {}, { sleep: noSleep })
    expect(response.status).toBe(200)
  })

  it('retries a server error and then succeeds', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      if (calls === 1) return new Response('upstream exploded', { status: 502 })
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await openResponse('https://api.example.com/v1/chat/completions', {}, { sleep: noSleep })
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a rejected key, and explains it', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: { message: 'Invalid API key' } }, 401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      openResponse('https://api.example.com/v1/chat/completions', {}, { provider: 'openai', sleep: noSleep })
    ).rejects.toMatchObject({ kind: 'auth', status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('classifies a network failure and retries it', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      openResponse('http://localhost:11434/api/chat', {}, { provider: 'ollama', sleep: noSleep })
    ).resolves.toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('honours a short Retry-After header', async () => {
    const delays: number[] = []
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        return new Response('slow down', { status: 429, headers: { 'retry-after': '2' } })
      }
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await openResponse(
      'https://api.example.com/v1/chat/completions',
      {},
      {
        attempts: 2,
        maxDelayMs: 5000,
        random: () => 0.5,
        sleep: async (ms) => {
          delays.push(ms)
        }
      }
    )
    expect(delays).toEqual([2000])
  })

  it('rebuilds a function-shaped body for each attempt', async () => {
    const seen: unknown[] = []
    let calls = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      calls += 1
      seen.push(init?.body)
      if (calls === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
      return jsonResponse({ ok: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    await openResponse(
      'https://api.example.com/v1/chat/completions',
      () => ({ method: 'POST', body: JSON.stringify({ attempt: 'fresh' }) }),
      { sleep: noSleep }
    )
    expect(seen).toEqual([JSON.stringify({ attempt: 'fresh' }), JSON.stringify({ attempt: 'fresh' })])
  })

  it('stops immediately when the caller has aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn(async () => new Response('aborted', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      openResponse('https://api.example.com/v1/models', {}, { signal: controller.signal, sleep: noSleep })
    ).rejects.toMatchObject({ kind: 'cancelled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('responseDetail', () => {
  it('describes a failed response in the same words a real call would', async () => {
    const detail = await responseDetail(new Response('{"error":{"message":"nope"}}', { status: 403 }), 'anthropic')
    expect(detail).toContain('Anthropic')
    expect(detail).toContain('nope')
  })

  it('produces a ProviderError-shaped message', async () => {
    const error = new ProviderError('x', { kind: 'unknown' })
    expect(error.retryable).toBe(false)
  })
})
