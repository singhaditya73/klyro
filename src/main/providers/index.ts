import type { ProviderId } from '@shared/types'
import type { Provider } from './types'
import { openAICompatible } from './openai'
import { anthropic } from './anthropic'
import { gemini } from './gemini'
import { ollama } from './ollama'
import { openCodeProvider } from './opencode'

const registry: Record<ProviderId, Provider> = {
  openai: openAICompatible,
  groq: { ...openAICompatible, id: 'groq' },
  'openai-compatible': { ...openAICompatible, id: 'openai-compatible' },
  anthropic,
  gemini,
  ollama,
  opencode: openCodeProvider
}

export function getProvider(id: ProviderId): Provider {
  return registry[id] ?? registry.openai
}

export type { Provider } from './types'
