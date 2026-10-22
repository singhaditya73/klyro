import { describe, expect, it } from 'vitest'
import { providerSettingsPatchSchema, providersPatchSchema } from './provider-settings'

/**
 * Regression: this schema used to list only `baseUrl` and `model`. Zod drops
 * unknown keys, so `fastModel` was silently stripped from every settings patch —
 * the overlay's model picker and Settings → Fast model showed the choice but it
 * never reached the file.
 */
describe('the provider settings patch', () => {
  it('keeps the fast model the overlay picks', () => {
    const parsed = providerSettingsPatchSchema.parse({
      baseUrl: 'http://127.0.0.1:4096',
      model: 'opencode/big-pickle',
      fastModel: 'opencode/claude-sonnet-4'
    })
    expect(parsed.fastModel).toBe('opencode/claude-sonnet-4')
  })

  it('keeps the transcription model', () => {
    const parsed = providerSettingsPatchSchema.parse({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      transcribeModel: 'whisper-1'
    })
    expect(parsed.transcribeModel).toBe('whisper-1')
  })

  it('keeps every provider in a patch', () => {
    const parsed = providersPatchSchema.parse({
      'claude-code': { baseUrl: '', model: 'sonnet', fastModel: 'haiku' },
      ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'llama3.1' }
    })
    expect(parsed['claude-code'].fastModel).toBe('haiku')
    expect(parsed.ollama.model).toBe('llama3.1')
  })

  it('rejects a provider with the wrong type rather than dropping the field', () => {
    expect(() =>
      providerSettingsPatchSchema.parse({ baseUrl: '', model: 'm', fastModel: 7 })
    ).toThrow()
  })
})
