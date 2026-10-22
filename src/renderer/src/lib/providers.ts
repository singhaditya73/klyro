import type { ProviderId, ProviderStatus } from '@shared/types'

/**
 * How a provider is doing, in words.
 *
 * The UI must never claim a provider is connected when it is not, so every
 * state here is derived from something that was actually measured: a key in
 * the secret store, a binary on the disk, a service that answered a health
 * check.
 */

export type ProviderState = 'ready' | 'needs-key' | 'running' | 'stopped' | 'not-installed' | 'local'

export interface ProviderStateInfo {
  state: ProviderState
  label: string
  tone: 'ok' | 'warn' | 'error' | 'idle'
}

/** The providers that live on someone else's servers. */
export const HOSTED_PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'gemini', 'groq']

/** The providers that run on this machine. */
export const LOCAL_PROVIDERS: ProviderId[] = ['ollama', 'openai-compatible', 'opencode']

/** The providers that are programs, not endpoints. */
export const AGENT_PROVIDERS: ProviderId[] = ['claude-code', 'codex', 'antigravity']

export const ALL_PROVIDERS: ProviderId[] = [...HOSTED_PROVIDERS, ...LOCAL_PROVIDERS, ...AGENT_PROVIDERS]

/** A provider that keeps the request on this machine. */
export function isLocalProvider(id: ProviderId): boolean {
  return LOCAL_PROVIDERS.includes(id) || AGENT_PROVIDERS.includes(id)
}

/** What a direct probe of the provider found. */
export type ProviderHealth = 'ok' | 'down' | 'unknown'

export interface LocalAgentInfo {
  id: string
  kind: 'opencode' | 'openai-compatible'
  name: string
  baseUrl: string
  healthy: boolean
  needsAuth?: boolean
  version?: string
  models: string[]
  note: string
}

export interface CliInfo {
  id: string
  name: string
  installed: boolean
  providerId: string
  note: string
}

/**
 * What can be said about a provider right now.
 *
 * `agents` are the local services Klyro found, `clis` the agent programs that
 * are installed. A hosted provider with a key is ready; one without is not,
 * however it is configured.
 */
export function providerState(
  provider: ProviderStatus,
  agents: LocalAgentInfo[],
  clis: CliInfo[],
  health?: ProviderHealth
): ProviderStateInfo {
  const id = provider.id

  if (id === 'claude-code' || id === 'codex') {
    const cli = clis.find((entry) => entry.providerId === id)
    if (!cli?.installed) {
      return { state: 'not-installed', label: 'Not installed', tone: 'idle' }
    }
    return { state: 'running', label: 'Installed', tone: 'ok' }
  }

  if (id === 'antigravity') {
    return { state: 'local', label: 'Local agent', tone: 'idle' }
  }

  if (id === 'opencode' || id === 'ollama' || id === 'openai-compatible') {
    // A direct answer from the provider beats a guess from a port scan.
    if (health === 'ok') {
      return { state: 'running', label: 'Running', tone: 'ok' }
    }
    if (health === 'down') {
      return { state: 'stopped', label: 'Not running', tone: 'warn' }
    }
    const agent = agents.find((entry) => entry.baseUrl === provider.baseUrl)
    if (agent?.healthy) {
      return {
        state: 'running',
        label: agent.needsAuth ? 'Running — needs the server password' : 'Running',
        tone: agent.needsAuth ? 'warn' : 'ok'
      }
    }
    if (!provider.baseUrl) {
      return { state: 'stopped', label: 'No address set', tone: 'idle' }
    }
    return { state: 'stopped', label: 'Not running', tone: 'warn' }
  }

  if (provider.requiresKey && !provider.hasKey) {
    return { state: 'needs-key', label: 'No key yet', tone: 'warn' }
  }
  return { state: 'ready', label: 'Ready', tone: 'ok' }
}

/** The name of a provider, without asking the main process. */
export function providerName(provider: ProviderStatus): string {
  return provider.label
}
