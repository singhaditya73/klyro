import type { ProviderId } from '@shared/types'
import type { Provider } from './types'
import { openAICompatibleFor } from './openai'
import { anthropic } from './anthropic'
import { gemini } from './gemini'
import { ollama } from './ollama'
import { openCodeProvider } from './opencode'
import { claudeCodeProvider } from './claude-code'
import { codexProvider } from './codex'
import { antigravityProvider } from './antigravity'

/**
 * Every slot gets its own adapter, and the adapter knows its slot: an error
 * raised while talking to Groq says "Groq", not "OpenAI". The three
 * OpenAI-compatible slots share one implementation but never one identity.
 */
const registry: Record<ProviderId, Provider> = {
  openai: openAICompatibleFor('openai'),
  groq: openAICompatibleFor('groq'),
  'openai-compatible': openAICompatibleFor('openai-compatible'),
  anthropic,
  gemini,
  ollama,
  opencode: openCodeProvider,
  'claude-code': claudeCodeProvider,
  codex: codexProvider,
  antigravity: antigravityProvider
}

export function getProvider(id: ProviderId): Provider {
  return registry[id] ?? registry.openai
}

export type { Provider } from './types'
