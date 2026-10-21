/**
 * A failure must name the provider the user is actually talking to, and say
 * *why* it failed.
 *
 * These are the two mistakes that made Klyro's provider errors useless:
 *  - the shared OpenAI-compatible adapter hardcoded "openai", so a Groq outage
 *    was reported as "Could not reach OpenAI" and the user was sent to the
 *    wrong Settings card;
 *  - `fetch` fails with a bare "fetch failed" and the real reason (DNS, a
 *    refused connection, a rejected certificate) only lives in `cause`, which
 *    the app threw away.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProvider } from './index'
import { classifyThrown, describeCause } from './errors'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** What undici throws when a name does not resolve. */
function dnsFailure(host: string): TypeError {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
  })
}

async function chatFailure(providerId: 'openai' | 'groq' | 'openai-compatible'): Promise<Error> {
  const provider = getProvider(providerId)
  try {
    for await (const _ of provider.chat({
      model: 'some-model',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'gsk_test',
      turns: [{ role: 'user', text: 'how are u' }]
    })) {
      // The stream is never reached: the request itself fails.
    }
    throw new Error('expected the chat to fail')
  } catch (error) {
    return error as Error
  }
}

describe('provider identity in errors', () => {
  it('blames the slot the user is on, not OpenAI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw dnsFailure('api.groq.com') }))

    const groq = await chatFailure('groq')
    expect(groq.message).toContain('Groq')
    expect(groq.message).not.toContain('OpenAI')

    const compatible = await chatFailure('openai-compatible')
    expect(compatible.message).toContain('OpenAI-compatible endpoint')
  })

  it('still says OpenAI when OpenAI is the provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw dnsFailure('api.openai.com') }))

    const error = await chatFailure('openai')
    expect(error.message).toContain('OpenAI')
  })
})

describe('network failures', () => {
  it('names the endpoint that could not be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw dnsFailure('api.groq.com') }))

    const error = await chatFailure('groq')
    expect(error.message).toContain('api.groq.com')
  })

  it('shows the real reason, not the "fetch failed" wrapper', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw dnsFailure('api.groq.com') }))

    const error = await chatFailure('groq')
    expect(error.message).toContain('getaddrinfo ENOTFOUND api.groq.com')
    expect(error.message).not.toContain(' fetch failed')
  })

  it('keeps a refused connection readable', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4096'), { code: 'ECONNREFUSED' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw refused }))

    const error = await chatFailure('groq')
    expect(error.message).toContain('ECONNREFUSED 127.0.0.1:4096')
  })
})

describe('describeCause', () => {
  it('walks the chain and skips the wrapper', () => {
    expect(describeCause(dnsFailure('api.groq.com'))).toBe('getaddrinfo ENOTFOUND api.groq.com')
  })

  it('falls back to a plain error message', () => {
    expect(describeCause(new Error('boom'))).toBe('boom')
  })

  it('uses the code when the message says nothing', () => {
    const coded = Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' })
    expect(describeCause(coded)).toBe('ECONNRESET')
  })
})

describe('classifyThrown', () => {
  it('keeps the endpoint on the error it classifies', () => {
    const classified = classifyThrown(dnsFailure('api.groq.com'), {
      provider: 'groq',
      endpoint: 'api.groq.com'
    })
    expect(classified.kind).toBe('network')
    expect(classified.endpoint).toBe('api.groq.com')
    expect(classified.message).toContain('Could not reach Groq at api.groq.com')
  })

  it('does not send a local server to the router when it is simply not running', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1234'), { code: 'ECONNREFUSED' })
    const classified = classifyThrown(refused, {
      provider: 'openai-compatible',
      endpoint: 'localhost:1234'
    })
    expect(classified.message).toContain('local server is running')
    expect(classified.message).not.toContain('internet connection')
  })
})
