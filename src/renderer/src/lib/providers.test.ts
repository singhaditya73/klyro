import { describe, expect, it } from 'vitest'
import type { ProviderStatus } from '@shared/types'
import { providerState } from './providers'

/**
 * The state of a provider decides what the interface says about it. A wrong
 * state is a lie about the machine, so each case is pinned here.
 */

function provider(overrides: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    id: 'openai',
    label: 'OpenAI',
    requiresKey: true,
    keyLabel: 'OpenAI API key',
    hasKey: false,
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    ...overrides
  }
}

describe('what the interface says about a provider', () => {
  it('calls a hosted provider without a key "no key yet"', () => {
    const state = providerState(provider(), [], [])
    expect(state.state).toBe('needs-key')
    expect(state.tone).toBe('warn')
  })

  it('calls a hosted provider with a key ready', () => {
    const state = providerState(provider({ hasKey: true }), [], [])
    expect(state.state).toBe('ready')
    expect(state.tone).toBe('ok')
  })

  it('calls a local server that answered running', () => {
    const state = providerState(
      provider({ id: 'ollama', label: 'Local (Ollama)', requiresKey: false, baseUrl: 'http://localhost:11434' }),
      [
        {
          id: 'ollama',
          kind: 'openai-compatible',
          name: 'Ollama',
          baseUrl: 'http://localhost:11434',
          healthy: true,
          models: [],
          note: ''
        }
      ],
      []
    )
    expect(state.state).toBe('running')
    expect(state.tone).toBe('ok')
  })

  it('warns when a running local server still wants its password', () => {
    const state = providerState(
      provider({ id: 'opencode', label: 'OpenCode', requiresKey: false, baseUrl: 'http://127.0.0.1:4096' }),
      [
        {
          id: 'opencode',
          kind: 'opencode',
          name: 'OpenCode',
          baseUrl: 'http://127.0.0.1:4096',
          healthy: true,
          needsAuth: true,
          models: [],
          note: ''
        }
      ],
      []
    )
    expect(state.state).toBe('running')
    expect(state.tone).toBe('warn')
    expect(state.label).toMatch(/password/i)
  })

  it('says an agent CLI that is not installed is not installed', () => {
    const state = providerState(provider({ id: 'codex', label: 'Codex', requiresKey: false }), [], [])
    expect(state.state).toBe('not-installed')
    expect(state.tone).toBe('idle')
  })

  it('says an installed agent CLI is installed', () => {
    const state = providerState(
      provider({ id: 'codex', label: 'Codex', requiresKey: false }),
      [],
      [{ id: 'codex', name: 'Codex', installed: true, providerId: 'codex', note: '' }]
    )
    expect(state.state).toBe('running')
    expect(state.tone).toBe('ok')
  })
})
