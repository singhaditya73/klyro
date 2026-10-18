import type { ProviderId, ProviderSettings } from '@shared/types'

export const PROVIDER_IDS: ProviderId[] = ['openai', 'anthropic', 'gemini', 'groq', 'ollama', 'openai-compatible']

export const PROVIDER_META: Record<ProviderId, { label: string; requiresKey: boolean; keyLabel: string }> = {
  openai: { label: 'OpenAI', requiresKey: true, keyLabel: 'OpenAI API key' },
  anthropic: { label: 'Anthropic (Claude)', requiresKey: true, keyLabel: 'Anthropic API key' },
  gemini: { label: 'Google Gemini', requiresKey: true, keyLabel: 'Google AI Studio API key' },
  groq: { label: 'Groq', requiresKey: true, keyLabel: 'Groq API key (gsk_…)' },
  ollama: { label: 'Local (Ollama)', requiresKey: false, keyLabel: 'Not required' },
  'openai-compatible': {
    label: 'OpenAI-compatible endpoint',
    requiresKey: true,
    keyLabel: 'API key (or any value for local servers)'
  }
}

export const DEFAULT_PROVIDERS: Record<ProviderId, ProviderSettings> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', transcribeModel: 'whisper-1' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' },
  // Groq decommissioned llama-3.1-8b-instant / llama-3.3-70b-versatile on
  // 2026-08-16; gpt-oss-120b is the current production default.
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', transcribeModel: 'whisper-large-v3' },
  ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.1' },
  'openai-compatible': { baseUrl: 'http://localhost:1234/v1', model: 'local-model', transcribeModel: 'whisper-1' }
}

export const DEFAULT_TRANSCRIBE_MODEL = 'whisper-1'
