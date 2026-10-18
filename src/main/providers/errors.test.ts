import { describe, expect, it } from 'vitest'
import {
  ProviderError,
  classifyStatus,
  classifyThrown,
  extractDetail,
  isProviderError,
  isRetryable,
  parseRetryAfter,
  toUserMessage
} from './errors'

describe('parseRetryAfter', () => {
  it('reads seconds', () => {
    expect(parseRetryAfter('12')).toBe(12_000)
    expect(parseRetryAfter('0')).toBe(0)
  })

  it('reads an HTTP date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000)
  })

  it('ignores junk', () => {
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter('soon')).toBeUndefined()
    expect(parseRetryAfter('   ')).toBeUndefined()
  })
})

describe('extractDetail', () => {
  it('pulls the provider message out of JSON', () => {
    expect(extractDetail('{"error":{"message":"Invalid model name"}}')).toBe('Invalid model name')
    expect(extractDetail('{"message":"no credit"}')).toBe('no credit')
  })

  it('collapses plain text and truncates', () => {
    expect(extractDetail('  Bad\n\nrequest  ')).toBe('Bad request')
    expect(extractDetail('x'.repeat(1000))).toHaveLength(300)
  })

  it('never echoes something that looks like a credential', () => {
    const detail = extractDetail('{"error":{"message":"bad key sk-abcdefghijklmnopqrstuvwx"}}')
    expect(detail).not.toContain('sk-abcdefghijklmnopqrstuvwx')
    expect(detail).toContain('sk-***')
  })
})

describe('classifyStatus', () => {
  const cases: Array<[number, string]> = [
    [401, 'auth'],
    [403, 'auth'],
    [402, 'quota'],
    [404, 'not_found'],
    [408, 'timeout'],
    [429, 'rate_limit'],
    [418, 'unknown'],
    [400, 'bad_request'],
    [422, 'bad_request'],
    [500, 'server'],
    [503, 'server']
  ]

  it('maps provider statuses to kinds', () => {
    for (const [status, kind] of cases) {
      expect(classifyStatus(status, '', { provider: 'openai' }).kind).toBe(kind)
    }
  })

  it('writes an actionable, provider-specific message', () => {
    const auth = classifyStatus(401, '{"error":{"message":"Incorrect API key"}}', { provider: 'openai' })
    expect(auth.message).toContain('OpenAI')
    expect(auth.message).toMatch(/Settings/)
    expect(auth.message).toContain('Incorrect API key')

    expect(classifyStatus(429, '', { provider: 'anthropic' }).message).toMatch(/rate limiting/i)
    expect(classifyStatus(500, '', { provider: 'gemini' }).message).toMatch(/temporary/i)
    expect(classifyStatus(404, '', { provider: 'ollama' }).message).toMatch(/model name/i)
  })

  it('marks only transient failures as retryable', () => {
    for (const [status, kind] of cases) {
      const retryable = isRetryable(classifyStatus(status, ''))
      expect(retryable).toBe(['rate_limit', 'timeout', 'server'].includes(kind))
    }
  })

  it('carries the Retry-After hint', () => {
    const error = classifyStatus(429, '', { retryAfter: '7' })
    expect(error.retryAfterMs).toBe(7000)
  })
})

describe('classifyThrown', () => {
  it('passes an existing ProviderError through untouched', () => {
    const original = new ProviderError('nope', { kind: 'auth' })
    expect(classifyThrown(original)).toBe(original)
  })

  it('recognizes cancellation', () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(classifyThrown(aborted).kind).toBe('cancelled')
    expect(isRetryable(classifyThrown(aborted))).toBe(false)
  })

  it('recognizes a stalled stream as a timeout', () => {
    const stalled = Object.assign(new Error('no data for 90s'), { name: 'StreamStalledError' })
    const classified = classifyThrown(stalled)
    expect(classified.kind).toBe('timeout')
    expect(classified.message).toContain('no data for 90s')
  })

  it('recognizes unreachable endpoints', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' })
    const classified = classifyThrown(refused, { provider: 'ollama' })
    expect(classified.kind).toBe('network')
    expect(classified.message).toContain('Ollama')
    expect(isRetryable(classified)).toBe(true)

    expect(classifyThrown(new TypeError('fetch failed')).kind).toBe('network')
  })

  it('falls back to unknown rather than pretending', () => {
    expect(classifyThrown(new Error('something odd')).kind).toBe('unknown')
  })
})

describe('messages', () => {
  it('is safe to show a user', () => {
    expect(toUserMessage(new Error('boom'))).toBe('boom')
    expect(toUserMessage(new ProviderError('polite', { kind: 'server' }))).toBe('polite')
    expect(toUserMessage('a string')).toBe('Request failed.')
  })

  it('redacts a raw error that carries a key', () => {
    expect(toUserMessage(new Error('auth failed for sk-abcdefghijklmnopqrstuvwx'))).not.toContain(
      'sk-abcdefghijklmnopqrstuvwx'
    )
  })

  it('identifies provider errors', () => {
    expect(isProviderError(new ProviderError('x', { kind: 'unknown' }))).toBe(true)
    expect(isProviderError(new Error('x'))).toBe(false)
  })
})
