import type { AppSettings, CatalogueGroup, ProviderId } from '@shared/types'
import { findClaudeBinary } from '../providers/claude-code'
import { findCodexBinary } from '../providers/codex'
import { findLanguageServerPids } from './antigravity-service'
import { listProviderModels } from './provider-models'
import { settingsDomain } from './settings'

/**
 * Every model the overlay may answer with, from every provider that is usable
 * right now.
 *
 * The overlay used to list only the active provider's models, which meant that
 * connecting OpenCode while Ollama was active left the picker showing Ollama
 * until the app was restarted. A person who has connected four agents owns four
 * catalogues; the overlay should show all of them and switch when one is
 * chosen.
 */

/** What the app can know about a provider without asking it for models. */
export interface Availability {
  hasKey: (id: ProviderId) => boolean
  hasBinary: (id: 'claude-code' | 'codex') => boolean
  /** True when an Antigravity language server is already running. */
  antigravityRunning: boolean
}

const SHORT_LABEL: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  groq: 'Groq',
  ollama: 'Ollama',
  'openai-compatible': 'Compatible endpoint',
  opencode: 'OpenCode',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  antigravity: 'Antigravity'
}

/** The order a picker should show when nothing is active: local agents first. */
const ORDER: ProviderId[] = [
  'opencode',
  'claude-code',
  'codex',
  'antigravity',
  'ollama',
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'openai-compatible'
]

function isLocalUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host.endsWith('.local')
  } catch {
    return false
  }
}

/**
 * The providers worth asking for a model list.
 *
 * The active provider is always included, even when it is not ready: the picker
 * then says why it is empty instead of silently offering someone else's models.
 */
export function configuredProviders(settings: AppSettings, availability: Availability): ProviderId[] {
  const usable = (id: ProviderId): boolean => {
    const provider = settings.providers[id]
    switch (id) {
      case 'ollama':
        return Boolean(provider?.baseUrl)
      case 'opencode':
        return Boolean(provider?.baseUrl)
      case 'claude-code':
      case 'codex':
        return availability.hasBinary(id)
      case 'antigravity':
        return availability.antigravityRunning
      case 'openai-compatible':
        // A local server may not ask for a key; a hosted one does.
        return Boolean(provider?.baseUrl) && (availability.hasKey(id) || isLocalUrl(provider.baseUrl))
      default:
        return availability.hasKey(id)
    }
  }

  const active = settings.activeProvider
  return ORDER.filter((id) => id === active || usable(id))
}

function defaultAvailability(): Availability {
  return {
    hasKey: (id) => Boolean(settingsDomain.apiKey(id)),
    hasBinary: (id) => Boolean(id === 'claude-code' ? findClaudeBinary() : findCodexBinary()),
    // Starting Antigravity's language server just to fill a dropdown would
    // cost seconds and hundreds of megabytes; it is listed when already up.
    antigravityRunning: findLanguageServerPids().length > 0
  }
}

/**
 * Ask every usable provider what it has, in parallel.
 *
 * A provider that cannot answer contributes a note, not a failure; groups with
 * nothing to offer are dropped unless they are the one in use.
 */
export async function overlayCatalogue(
  settings: AppSettings = settingsDomain.get(),
  options: {
    availability?: Availability
    list?: (id: ProviderId) => Promise<{ models: CatalogueGroup['models']; note: string | null }>
  } = {}
): Promise<CatalogueGroup[]> {
  const availability = options.availability ?? defaultAvailability()
  const list = options.list ?? listProviderModels
  const ids = configuredProviders(settings, availability)

  const groups = await Promise.all(
    ids.map(async (id): Promise<CatalogueGroup> => {
      const result = await list(id).catch(() => ({
        models: [],
        note: 'Could not ask this provider for its models.'
      }))
      return {
        id,
        label: SHORT_LABEL[id],
        models: result.models,
        note: result.models.length > 0 ? null : result.note
      }
    })
  )

  const active = settings.activeProvider
  return groups
    .filter((group) => group.models.length > 0 || group.id === active)
    .sort((a, b) => (a.id === active ? -1 : b.id === active ? 1 : 0))
}

/** For the tests: the labels a picker shows. */
export const providerGroupLabel = (id: ProviderId): string => SHORT_LABEL[id]
