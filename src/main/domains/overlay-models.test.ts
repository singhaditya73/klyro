import { describe, expect, it, vi } from 'vitest'
import type { AppSettings, ProviderId } from '@shared/types'
import { DEFAULT_PROVIDERS } from '../providers/defaults'
import {
  configuredProviders,
  overlayCatalogue,
  providerGroupLabel,
  type Availability
} from './overlay-models'

/**
 * The overlay's picker shows every provider the person has connected, not just
 * the one in use. These checks pin down which providers count as connected and
 * how the combined catalogue is ordered.
 */

vi.mock('./settings', () => ({
  // The tests pass their own settings; the default is never consulted.
  settingsDomain: { get: () => { throw new Error('pass settings explicitly') }, apiKey: () => null }
}))
vi.mock('./provider-models', () => ({ listProviderModels: async () => ({ models: [], note: null }) }))
vi.mock('./antigravity-service', () => ({ findLanguageServerPids: () => [] }))
vi.mock('../providers/claude-code', () => ({ findClaudeBinary: () => null }))
vi.mock('../providers/codex', () => ({ findCodexBinary: () => null }))

function base(active: ProviderId = 'ollama'): AppSettings {
  return {
    activeProvider: active,
    providers: structuredClone(DEFAULT_PROVIDERS)
  } as AppSettings
}

function availability(overrides: Partial<Availability> = {}): Availability {
  return {
    hasKey: () => false,
    hasBinary: () => false,
    antigravityRunning: false,
    ...overrides
  }
}

describe('configuredProviders', () => {
  it('offers the local providers that need no credential', () => {
    const ids = configuredProviders(base(), availability())
    expect(ids).toContain('ollama')
    expect(ids).toContain('opencode')
  })

  it('does not offer a hosted provider without a key', () => {
    const ids = configuredProviders(base(), availability())
    expect(ids).not.toContain('openai')
    expect(ids).not.toContain('anthropic')
  })

  it('offers a hosted provider once it has a key', () => {
    const ids = configuredProviders(
      base(),
      availability({ hasKey: (id) => id === 'openai' || id === 'groq' })
    )
    expect(ids).toContain('openai')
    expect(ids).toContain('groq')
    expect(ids).not.toContain('anthropic')
  })

  it('offers an agent CLI only when it is installed', () => {
    expect(configuredProviders(base(), availability())).not.toContain('claude-code')
    const ids = configuredProviders(base(), availability({ hasBinary: (id) => id === 'claude-code' }))
    expect(ids).toContain('claude-code')
    expect(ids).not.toContain('codex')
  })

  it('offers Antigravity only while its language server is up', () => {
    expect(configuredProviders(base(), availability())).not.toContain('antigravity')
    expect(configuredProviders(base(), availability({ antigravityRunning: true }))).toContain('antigravity')
  })

  it('includes the active provider even when it is not ready', () => {
    // The picker then says why it is empty instead of quietly offering another
    // provider's models.
    const ids = configuredProviders(base('antigravity'), availability())
    expect(ids).toContain('antigravity')
  })

  it('offers a local OpenAI-compatible endpoint without a key', () => {
    const settings = base()
    settings.providers['openai-compatible'] = {
      ...settings.providers['openai-compatible'],
      baseUrl: 'http://127.0.0.1:1234/v1'
    }
    expect(configuredProviders(settings, availability())).toContain('openai-compatible')
  })

  it('does not offer a hosted OpenAI-compatible endpoint without a key', () => {
    const settings = base()
    settings.providers['openai-compatible'] = {
      ...settings.providers['openai-compatible'],
      baseUrl: 'https://llm.example.com/v1'
    }
    expect(configuredProviders(settings, availability())).not.toContain('openai-compatible')
  })
})

describe('overlayCatalogue', () => {
  it('puts the provider in use first and asks every other connected one', async () => {
    const asked: ProviderId[] = []
    const groups = await overlayCatalogue(base('claude-code'), {
      availability: availability({
        hasKey: (id) => id === 'openai',
        hasBinary: (id) => id === 'claude-code'
      }),
      list: async (id) => {
        asked.push(id)
        return { models: [{ id: `${id}-model`, name: `${id} model`, provider: id, quota: null, free: false }], note: null }
      }
    })

    expect(groups.map((group) => group.id)).toEqual([
      'claude-code',
      'opencode',
      'ollama',
      'openai',
      'openai-compatible'
    ])
    expect(new Set(asked)).toEqual(
      new Set(['claude-code', 'opencode', 'ollama', 'openai', 'openai-compatible'])
    )
  })

  it('drops a provider with nothing to offer, and keeps the active one with its note', async () => {
    const groups = await overlayCatalogue(base('opencode'), {
      availability: availability(),
      list: async (id) =>
        id === 'opencode'
          ? { models: [], note: 'The OpenCode server is not running.' }
          : { models: [], note: null }
    })

    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('opencode')
    expect(groups[0].models).toEqual([])
    expect(groups[0].note).toBe('The OpenCode server is not running.')
  })

  it('turns a provider that fails into a note, not an error', async () => {
    const groups = await overlayCatalogue(base('ollama'), {
      availability: availability(),
      list: async (id) => {
        if (id === 'ollama') throw new Error('connect ECONNREFUSED')
        return { models: [{ id: 'm', name: 'm', provider: id, quota: null, free: false }], note: null }
      }
    })

    expect(groups[0].id).toBe('ollama')
    expect(groups[0].note).toBe('Could not ask this provider for its models.')
    expect(groups.map((group) => group.id)).toContain('opencode')
  })

  it('labels the groups for the picker', async () => {
    const groups = await overlayCatalogue(base('opencode'), {
      availability: availability(),
      list: async () => ({
        models: [{ id: 'm', name: 'm', provider: 'x', quota: null, free: false }],
        note: null
      })
    })
    expect(groups[0].label).toBe('OpenCode')
    expect(providerGroupLabel('claude-code')).toBe('Claude Code')
    expect(providerGroupLabel('openai-compatible')).toBe('Compatible endpoint')
  })

  it('clears a note when the provider did offer models', async () => {
    const groups = await overlayCatalogue(base('ollama'), {
      availability: availability(),
      list: async () => ({
        models: [{ id: 'llama3.1', name: 'Llama 3.1', provider: 'meta', quota: null, free: true }],
        note: 'stale note'
      })
    })
    expect(groups[0].note).toBeNull()
  })
})
