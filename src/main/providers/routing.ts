/**
 * Guards around "which provider and model actually runs this?".
 *
 * Every feature (chat, agent, code, knowledge, transcription) used to read
 * `settings.providers[active].model` directly, which meant an empty or stale
 * field silently reached the API and came back as a confusing 404. Routing
 * resolves the same values in one place, falls back to the shipped defaults, and
 * fails early with a message that says what to fix.
 */

import type { AppSettings, ProviderId, VisionSupport } from '@shared/types'
import { DEFAULT_PROVIDERS, PROVIDER_META } from './defaults'
import { ProviderError } from './errors'

export type Purpose = 'chat' | 'agent' | 'code' | 'knowledge' | 'transcription' | 'overlay'

export interface ResolvedRoute {
  providerId: ProviderId
  /** Human label for messages ("Anthropic (Claude)"). */
  label: string
  model: string
  baseUrl: string
  apiKey: string | null
}

/** Models we can *positively* rule out, per provider. */
const TEXT_ONLY_PATTERNS: Partial<Record<ProviderId, RegExp>> = {
  // gpt-4 and its dated snapshots are text-only; gpt-4o / gpt-4-turbo / gpt-4.1 see.
  openai: /^(gpt-3\.5|gpt-4(-\d{4})?$|gpt-4-turbo-preview|davinci|babbage|text-|o1-mini|o3-mini)/i,
  anthropic: /^claude-2/i,
  gemini: /(^gemini-1\.0-pro|embedding|^text-)/i,
  // Groq's gpt-oss (and its OpenAI-prefixed serving) serves text (and tool
  // use) but no vision, nor do the compound, playai, whisper, guard or
  // orpheus lines (llama-4 stays honestly unknown — vision there is per-model).
  groq: /(groq\/compound|^playai|^whisper|^guard|^orpheus|gpt-oss)/i
}

/** Models known to accept images, per provider. */
const VISION_PATTERNS: Record<ProviderId, RegExp> = {
  openai: /(gpt-4o|gpt-4\.1|gpt-5|gpt-4-turbo|chatgpt-4o|^o[134])/i,
  anthropic: /^claude-(3|4|sonnet|opus|haiku)/i,
  gemini: /^gemini-/i,
  groq: /(vision|llava)/i,
  ollama: /(llava|vision|moondream|minicpm|bakllava|qwen.*vl|gemma3)/i,
  // A custom endpoint could be anything; do not guess.
  'openai-compatible': /(vision|llava|gpt-4o|gpt-4\.1|gemini|claude)/i,
  // OpenCode serves whatever the user's account reaches, so the model name is
  // the only signal — the same honest rules as a custom endpoint.
  opencode: /(vision|llava|gpt-4o|gpt-4\.1|gemini|claude|grok-4|glm-4\.6|kimi)/i,
  // Claude Code serves whatever the user's subscription reaches.
  'claude-code': /(vision|llava|claude|gpt-4o|gemini)/i,
  // Codex serves whatever the user's login reaches.
  codex: /(vision|llava|gpt-4o|gpt-5|o3|codex)/i,
  // Antigravity serves Claude, Gemini and GPT-OSS models.
  antigravity: /(vision|llava|claude|gemini|gpt-oss|gpt_oss)/i
}

export function visionSupport(providerId: ProviderId, model: string): VisionSupport {
  const name = model.trim()
  if (!name) return 'unknown'

  const textOnly = TEXT_ONLY_PATTERNS[providerId]
  if (textOnly?.test(name)) return 'no'
  if (VISION_PATTERNS[providerId].test(name)) return 'yes'

  // Anthropic's current line is all multimodal; Ollama and custom endpoints
  // depend on the specific weights, so those stay honestly unknown.
  if (providerId === 'anthropic') return 'yes'
  if (providerId === 'ollama') return 'unknown'
  if (providerId === 'openai-compatible') return 'unknown'
  return 'unknown'
}

/**
 * Can this provider's *transport* carry an image at all?
 *
 * A model may well be able to read images while the way Klyro talks to it
 * cannot deliver one — that is a different question from "does this model
 * have vision", and it is the one that decides whether an attachment is
 * useful. Providers whose transport has no way to pass an image say so here,
 * so the user is told instead of the image being dropped in silence.
 */
export function providerCarriesImages(providerId: ProviderId): boolean {
  switch (providerId) {
    case 'openai':
    case 'anthropic':
    case 'gemini':
    case 'groq':
    case 'ollama':
    case 'openai-compatible':
    case 'opencode':
    case 'claude-code':
    case 'codex':
      return true
    // The Antigravity model call is a plain prompt and a model id: the
    // transport has nowhere to put an image.
    case 'antigravity':
      return false
    default:
      return false
  }
}

export interface RouteInput {
  settings: AppSettings
  /** Resolved from the encrypted store by the caller (keeps this pure). */
  apiKey: string | null
  purpose?: Purpose
}

const KEY_REQUIRED: ReadonlySet<ProviderId> = new Set<ProviderId>(['openai', 'anthropic', 'gemini'])

/** Providers that are a program on this machine, not a service with a URL. */
const NO_ENDPOINT: ReadonlySet<ProviderId> = new Set<ProviderId>(['claude-code', 'codex'])

export function resolveRoute({ settings, apiKey, purpose = 'chat' }: RouteInput): ResolvedRoute {
  const providerId = settings.activeProvider
  const meta = PROVIDER_META[providerId] ?? PROVIDER_META.openai
  const defaults = DEFAULT_PROVIDERS[providerId] ?? DEFAULT_PROVIDERS.openai
  const configured = settings.providers?.[providerId]

  // The overlay asks for the fast model: it wants an answer now, not the
  // most thorough one.
  const fastModel = (configured?.fastModel ?? '').trim()
  const model =
    purpose === 'overlay' && fastModel
      ? fastModel
      : (configured?.model ?? '').trim() || defaults.model
  const baseUrl = (configured?.baseUrl ?? '').trim() || defaults.baseUrl

  // The agent CLIs are programs, not endpoints: they have no URL to set.
  if (!baseUrl && !NO_ENDPOINT.has(providerId)) {
    throw new ProviderError(`No endpoint URL is set for ${meta.label}. Add one in Settings.`, {
      kind: 'bad_request',
      provider: providerId
    })
  }
  // A local OpenAI-compatible server often ignores auth entirely, so a missing
  // key is allowed there; the hosted providers genuinely cannot work without one.
  if (KEY_REQUIRED.has(providerId) && !apiKey) {
    throw new ProviderError(`${meta.label} needs an API key. Add ${meta.keyLabel.toLowerCase()} in Settings.`, {
      kind: 'auth',
      provider: providerId
    })
  }
  if (purpose === 'transcription' && providerId !== 'openai' && providerId !== 'groq' && providerId !== 'openai-compatible') {
    throw new ProviderError(
      `Speech-to-text needs an OpenAI-compatible provider (currently "${meta.label}"). Switch provider in Settings, or point the OpenAI-compatible endpoint at a local Whisper server.`,
      { kind: 'unsupported', provider: providerId }
    )
  }

  return { providerId, label: meta.label, model, baseUrl, apiKey }
}

/**
 * The agent loop is useless without image input, so refuse to start rather than
 * burn screenshots and steps on a model that cannot see.
 */
export function assertVisionCapable(route: ResolvedRoute): VisionSupport {
  const support = visionSupport(route.providerId, route.model)
  if (support === 'no') {
    throw new ProviderError(
      `${route.label} model "${route.model}" cannot read images. The agent needs a vision model — choose one in Settings.`,
      { kind: 'unsupported', provider: route.providerId }
    )
  }
  return support
}
