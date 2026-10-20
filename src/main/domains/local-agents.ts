import { logger } from '../logger'
import { settingsDomain } from './settings'
import {
  listOpenCodeModels,
  probeOpenCode as probeOpenCodeServer,
  type OpenCodeModelInfo
} from '../providers/opencode'

/**
 * Find the AI services already running on this machine.
 *
 * Plenty of people already have an agent or a local model server running:
 * OpenCode (which holds its own account, so Klyro needs no key), Ollama,
 * LM Studio, LiteLLM, vLLM, or a bridge that exposes another IDE's
 * subscription as an OpenAI-compatible endpoint. Klyro probes the usual
 * ports and offers to use whatever it finds — no key, no signup, no copying
 * credentials around.
 */

export interface LocalAgent {
  id: string
  kind: 'opencode' | 'openai-compatible'
  name: string
  baseUrl: string
  healthy: boolean
  /** The server is running but wants its password before it will answer. */
  needsAuth: boolean
  version?: string
  models: string[]
  note: string
}

interface Candidate {
  id: string
  kind: 'opencode' | 'openai-compatible'
  name: string
  baseUrl: string
  note: string
}

const CANDIDATES: Candidate[] = [
  {
    id: 'opencode',
    kind: 'opencode',
    name: 'OpenCode',
    baseUrl: 'http://127.0.0.1:4096',
    note: 'Your OpenCode account, its free models and its limits — no key needed.'
  },
  {
    id: 'ollama',
    kind: 'openai-compatible',
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    note: 'Local models on your machine. Nothing leaves the device.'
  },
  {
    id: 'lmstudio',
    kind: 'openai-compatible',
    name: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    note: 'Local models served by LM Studio.'
  },
  {
    id: 'litellm',
    kind: 'openai-compatible',
    name: 'LiteLLM',
    baseUrl: 'http://127.0.0.1:4000/v1',
    note: 'A proxy in front of several providers, run locally.'
  },
  {
    id: 'vllm',
    kind: 'openai-compatible',
    name: 'vLLM',
    baseUrl: 'http://127.0.0.1:8000/v1',
    note: 'A model you are serving yourself.'
  },
  {
    id: 'antigravity-bridge',
    kind: 'openai-compatible',
    name: 'Antigravity bridge',
    baseUrl: 'http://127.0.0.1:11435/v1',
    note: 'A local bridge that exposes an Antigravity subscription as an API.'
  }
]

const PROBE_TIMEOUT_MS = 1500

async function probeOpenAICompatible(candidate: Candidate): Promise<LocalAgent> {
  const base: LocalAgent = {
    id: candidate.id,
    kind: candidate.kind,
    name: candidate.name,
    baseUrl: candidate.baseUrl,
    healthy: false,
    needsAuth: false,
    models: [],
    note: candidate.note
  }
  try {
    const response = await fetch(`${candidate.baseUrl}/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!response.ok) return base
    const payload = (await response.json()) as { data?: Array<{ id?: string }> }
    const models = (payload.data ?? []).map((entry) => entry.id ?? '').filter(Boolean).slice(0, 40)
    return { ...base, healthy: true, models, version: 'OpenAI-compatible' }
  } catch {
    return base
  }
}

async function probeOpenCodeService(candidate: Candidate): Promise<LocalAgent> {
  const base: LocalAgent = {
    id: candidate.id,
    kind: candidate.kind,
    name: candidate.name,
    baseUrl: candidate.baseUrl,
    healthy: false,
    needsAuth: false,
    models: [],
    note: candidate.note
  }
  try {
    // A protected server still counts as running; we use the stored password
    // when the user has already pasted it.
    const stored = settingsDomain.apiKey('opencode')
    const health = await probeOpenCodeServer(candidate.baseUrl, stored)
    if (!health.healthy) return base
    const models = await listOpenCodeModels(candidate.baseUrl, stored).catch(() => [] as OpenCodeModelInfo[])
    return {
      ...base,
      healthy: true,
      needsAuth: health.needsAuth,
      models: models.map((model) => model.id).slice(0, 40),
      version: health.version
    }
  } catch (error) {
    logger.debug('OpenCode probe failed', error)
    return base
  }
}

class LocalAgentDomain {
  /** Probe the usual ports; healthy services come first. */
  async detect(): Promise<LocalAgent[]> {
    const results = await Promise.all(
      CANDIDATES.map((candidate) =>
        candidate.kind === 'opencode' ? probeOpenCodeService(candidate) : probeOpenAICompatible(candidate)
      )
    )
    return results.sort((a, b) => Number(b.healthy) - Number(a.healthy))
  }
}

export const localAgents = new LocalAgentDomain()
