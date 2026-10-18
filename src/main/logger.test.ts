import { describe, expect, it } from 'vitest'
import { redact, redactString } from './logger'

describe('redactString', () => {
  it('masks OpenAI, Anthropic, GitHub, and Google keys', () => {
    const input = [
      'openai=sk-abcdefghijklmnopqrstuvwxyz0123',
      'anthropic=sk-ant-api03-abcdefghijklmnop',
      'github=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      'pat=github_pat_11ABCDEFG0abcdefghijklmn',
      'google=AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ123456789'
    ].join(' ')
    const output = redactString(input)
    expect(output).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123')
    expect(output).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
    expect(output).not.toContain('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ123456789')
    expect(output.match(/\*\*\*/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('masks bearer tokens and key/value pairs case-insensitively', () => {
    expect(redactString('Authorization: Bearer abcdef0123456789XYZ')).toContain('Bearer ***')
    expect(redactString('api_key: "supersecretvalue123"')).toContain('***')
    expect(redactString('PASSWORD=hunter2hunter2')).toContain('***')
  })

  it('leaves ordinary text alone', () => {
    expect(redactString('Agent moved the cursor to (10, 20)')).toBe('Agent moved the cursor to (10, 20)')
  })
})

describe('redact', () => {
  it('scrubs nested objects and errors without changing shape', () => {
    const value = { provider: 'openai', headers: { authorization: 'Bearer sk-abcdefghijklmnop123456' } }
    const output = redact(value) as typeof value
    expect(output.provider).toBe('openai')
    expect(output.headers.authorization).toContain('***')

    const error = new Error('failed with token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
    expect((redact(error) as Error).message).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
  })

  it('passes through primitives', () => {
    expect(redact(42)).toBe(42)
    expect(redact(true)).toBe(true)
    expect(redact(null)).toBe(null)
  })
})
