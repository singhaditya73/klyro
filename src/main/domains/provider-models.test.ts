import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { listProviderModels } from './provider-models'

/**
 * The model lister is what makes "pick the model you want" possible, so it is
 * checked against every shape of provider: a local server, a hosted API that
 * needs a key, and the agent CLIs.
 */

const fetchMock = vi.fn()

vi.mock('../logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

const settings = {
  activeProvider: 'openai',
  providers: {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest' },
    gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
    groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'gpt-oss-120b' },
    ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.1' },
    'openai-compatible': { baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
    opencode: { baseUrl: 'http://127.0.0.1:4096', model: '' },
    'claude-code': { baseUrl: '', model: '' },
    codex: { baseUrl: '', model: '' },
    antigravity: { baseUrl: 'local://antigravity', model: '' }
  }
}

const keys: Record<string, string | null> = {
  openai: 'sk-test',
  anthropic: 'sk-ant',
  gemini: 'key-gem',
  groq: 'gsk-test'
}

vi.mock('./settings', () => ({
  settingsDomain: {
    get: () => settings,
    apiKey: (id: string) => keys[id] ?? null
  }
}))

vi.mock('./antigravity', () => ({
  antigravity: {
    status: async () => ({
      running: true,
      plan: 'Pro',
      account: 'a@b.c',
      error: null,
      models: [
        { id: 'MODEL_PLACEHOLDER_M26', name: 'Claude Opus 4.6', provider: 'MODEL_PROVIDER_ANTHROPIC', quota: 0.5 },
        { id: 'MODEL_GOOGLE_GEMINI_2_5_FLASH', name: 'Gemini 3.5 Flash Lite', provider: 'MODEL_PROVIDER_GOOGLE', quota: 1 }
      ]
    })
  }
}))

vi.mock('../providers/opencode', () => ({
  listOpenCodeModels: async () => [
    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', providerID: 'openai', free: true }
  ]
}))

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as unknown as Response
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listing the models a provider has', () => {
  it('lists an OpenAI-shaped provider', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [{ id: 'gpt-4o', owned_by: 'openai' }, { id: 'gpt-4o-mini', owned_by: 'openai' }] })
    )
    const result = await listProviderModels('openai')
    expect(result.models.map((model) => model.id)).toEqual(['gpt-4o', 'gpt-4o-mini'])
    expect(result.note).toBeNull()
    // The key goes with the request.
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-test')
  })

  it('lists Anthropic with the header it expects', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' }] }))
    const result = await listProviderModels('anthropic')
    expect(result.models[0]).toMatchObject({ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' })
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant')
  })

  it('lists Gemini and drops the models/ prefix', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }] }))
    const result = await listProviderModels('gemini')
    expect(result.models[0].id).toBe('gemini-2.5-pro')
    expect(fetchMock.mock.calls[0][0]).toContain('/models?key=key-gem')
  })

  it('lists Ollama from its own endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ models: [{ name: 'jurisai:latest' }] }))
    const result = await listProviderModels('ollama')
    expect(result.models[0].id).toBe('jurisai:latest')
    expect(result.models[0].free).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/tags')
  })

  it('lists OpenCode from its server', async () => {
    const result = await listProviderModels('opencode')
    expect(result.models[0].id).toBe('openai/gpt-oss-120b')
    expect(result.models[0].free).toBe(true)
  })

  it('lists Antigravity from its own catalogue, with the quota', async () => {
    const result = await listProviderModels('antigravity')
    expect(result.models.map((model) => model.id)).toEqual(['MODEL_PLACEHOLDER_M26', 'MODEL_GOOGLE_GEMINI_2_5_FLASH'])
    expect(result.models[0].quota).toBe(0.5)
  })

  it('offers the models the agent CLIs accept', async () => {
    const claude = await listProviderModels('claude-code')
    expect(claude.models.map((model) => model.id)).toContain('sonnet')
    expect(claude.models.map((model) => model.id)).toContain('claude-sonnet-4-6')
    const codex = await listProviderModels('codex')
    expect(codex.models.map((model) => model.id)).toContain('gpt-5-codex')
  })
})

describe('when a provider cannot be asked', () => {
  it('says the key was rejected', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 401))
    const result = await listProviderModels('openai')
    expect(result.models).toEqual([])
    expect(result.note).toMatch(/rejected the key/i)
  })

  it('says a key is missing', async () => {
    keys.anthropic = null
    const result = await listProviderModels('anthropic')
    expect(result.models).toEqual([])
    expect(result.note).toMatch(/key/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says the server could not be reached', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await listProviderModels('openai')
    expect(result.models).toEqual([])
    expect(result.note).toMatch(/could not reach/i)
  })

  it('says the base URL is missing', async () => {
    settings.providers.ollama.baseUrl = ''
    const result = await listProviderModels('ollama')
    expect(result.note).toMatch(/base url/i)
  })
})
