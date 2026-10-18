import { describe, expect, it } from 'vitest'
import type { AppSettings, ProviderId } from '@shared/types'
import { DEFAULT_PROVIDERS } from './defaults'
import { assertVisionCapable, resolveRoute, visionSupport } from './routing'

function settingsFor(activeProvider: ProviderId, model?: string): AppSettings {
  const providers = structuredClone(DEFAULT_PROVIDERS)
  if (model !== undefined) providers[activeProvider] = { ...providers[activeProvider], model }
  return { activeProvider, providers } as unknown as AppSettings
}

describe('resolveRoute', () => {
  it('uses what the user configured', () => {
    const route = resolveRoute({
      settings: settingsFor('openai', 'gpt-4o-mini'),
      apiKey: 'sk-live'
    })
    expect(route).toMatchObject({ providerId: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-live' })
    expect(route.baseUrl).toBe(DEFAULT_PROVIDERS.openai.baseUrl)
  })

  it('falls back to the shipped default when the model is blank', () => {
    const route = resolveRoute({ settings: settingsFor('gemini', ''), apiKey: 'key' })
    expect(route.model).toBe(DEFAULT_PROVIDERS.gemini.model)
  })

  it('refuses a hosted provider without a key, and says which key', () => {
    for (const provider of ['openai', 'anthropic', 'gemini'] as ProviderId[]) {
      expect(() => resolveRoute({ settings: settingsFor(provider), apiKey: null })).toThrow(/needs an API key/)
    }
    expect(() => resolveRoute({ settings: settingsFor('anthropic'), apiKey: null })).toThrow(/anthropic api key/)
  })

  it('allows a local endpoint with no key', () => {
    // Local servers commonly ignore auth entirely.
    expect(resolveRoute({ settings: settingsFor('openai-compatible'), apiKey: null }).model).toBe(
      DEFAULT_PROVIDERS['openai-compatible'].model
    )
    expect(resolveRoute({ settings: settingsFor('ollama'), apiKey: null }).providerId).toBe('ollama')
  })

  it('only offers transcription where it can actually work', () => {
    expect(
      resolveRoute({ settings: settingsFor('openai'), apiKey: 'key', purpose: 'transcription' }).providerId
    ).toBe('openai')
    expect(() =>
      resolveRoute({ settings: settingsFor('openai-compatible'), apiKey: null, purpose: 'transcription' })
    ).not.toThrow()
    expect(() => resolveRoute({ settings: settingsFor('anthropic'), apiKey: 'key', purpose: 'transcription' })).toThrow(
      /Speech-to-text/
    )
    expect(() => resolveRoute({ settings: settingsFor('gemini'), apiKey: 'key', purpose: 'transcription' })).toThrow(
      /Whisper/
    )
  })
})

describe('visionSupport', () => {
  it('recognises current multimodal models', () => {
    expect(visionSupport('openai', 'gpt-4o-mini')).toBe('yes')
    expect(visionSupport('openai', 'gpt-4.1')).toBe('yes')
    expect(visionSupport('anthropic', 'claude-3-5-sonnet-latest')).toBe('yes')
    expect(visionSupport('gemini', 'gemini-2.0-flash')).toBe('yes')
    expect(visionSupport('ollama', 'llava:13b')).toBe('yes')
  })

  it('rules out models that cannot see', () => {
    expect(visionSupport('openai', 'gpt-3.5-turbo')).toBe('no')
    expect(visionSupport('anthropic', 'claude-2.1')).toBe('no')
    expect(visionSupport('gemini', 'gemini-1.0-pro')).toBe('no')
  })

  it('stays honest when it cannot know', () => {
    expect(visionSupport('ollama', 'llama3.1')).toBe('unknown')
    expect(visionSupport('openai-compatible', 'local-model')).toBe('unknown')
    expect(visionSupport('openai', '')).toBe('unknown')
  })
})

describe('assertVisionCapable', () => {
  it('passes a vision model and reports unknown rather than guessing', () => {
    expect(assertVisionCapable(resolveRoute({ settings: settingsFor('openai', 'gpt-4o'), apiKey: 'k' }))).toBe('yes')
    expect(assertVisionCapable(resolveRoute({ settings: settingsFor('ollama', 'llama3.1'), apiKey: null }))).toBe(
      'unknown'
    )
  })

  it('refuses to start the agent on a text-only model', () => {
    expect(() =>
      assertVisionCapable(resolveRoute({ settings: settingsFor('openai', 'gpt-3.5-turbo'), apiKey: 'k' }))
    ).toThrow(/cannot read images/)
  })
})
