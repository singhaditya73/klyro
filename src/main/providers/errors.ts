/**
 * A single vocabulary for "why did the model call fail".
 *
 * Providers return wildly different shapes for the same underlying problem
 * (401 vs "invalid_api_key", 429 vs "rate limit exceeded"). Callers need to make
 * decisions — retry or not, tell the user to check the key or the URL — so every
 * failure is classified once, here, and carries a message written for a person.
 */

import { redactString } from '../logger'
import { PROVIDER_META } from './defaults'
import type { ProviderId } from '@shared/types'

export type ProviderErrorKind =
  /** Bad or missing credentials, or a forbidden request. */
  | 'auth'
  /** Account has no credit/quota left. */
  | 'quota'
  /** Too many requests in a short window. */
  | 'rate_limit'
  /** The request or stream timed out. */
  | 'timeout'
  /** The endpoint could not be reached at all. */
  | 'network'
  /** The provider failed on its own side. */
  | 'server'
  /** The request we sent was rejected as malformed. */
  | 'bad_request'
  /** Wrong URL, wrong model name, or a missing route. */
  | 'not_found'
  /** The user (or the app) aborted the call. */
  | 'cancelled'
  /** The provider cannot do this at all (e.g. no speech-to-text). */
  | 'unsupported'
  | 'unknown'

export type ProviderIdOrLabel = ProviderId | string

const RETRYABLE: Record<ProviderErrorKind, boolean> = {
  auth: false,
  quota: false,
  rate_limit: true,
  timeout: true,
  network: true,
  server: true,
  bad_request: false,
  not_found: false,
  cancelled: false,
  unsupported: false,
  unknown: false
}

export interface ProviderErrorOptions {
  kind: ProviderErrorKind
  provider?: ProviderIdOrLabel
  status?: number
  retryAfterMs?: number
  /** Override the default retryability for the kind. */
  retryable?: boolean
  /** Short excerpt of the provider's own text, already redacted. */
  detail?: string
}

/** The maximum amount of provider text we echo back to the user. */
const MAX_DETAIL = 300

export function providerLabel(provider?: ProviderIdOrLabel): string {
  if (!provider) return 'The provider'
  const meta = PROVIDER_META[provider as ProviderId]
  if (meta) return meta.label
  return provider
}

/** Turn a provider's error body into a short, redacted, single-line excerpt. */
export function extractDetail(body: string): string {
  const text = body.trim()
  if (!text) return ''
  try {
    const parsed = JSON.parse(text) as Record<string, any>
    const nested = parsed?.error?.message ?? parsed?.error?.type ?? parsed?.message ?? parsed?.detail
    if (typeof nested === 'string' && nested.trim()) {
      return redactString(nested.trim().replace(/\s+/g, ' ')).slice(0, MAX_DETAIL)
    }
  } catch {
    // Not JSON — fall through and keep a trimmed plain-text excerpt.
  }
  return redactString(text.replace(/\s+/g, ' ')).slice(0, MAX_DETAIL)
}

function messageFor(kind: ProviderErrorKind, label: string, status?: number, detail?: string): string {
  const tail = detail ? ` ${detail}` : ''
  switch (kind) {
    case 'auth':
      return `${label} rejected the API key${status ? ` (${status})` : ''}. Check the key in Settings.${tail}`
    case 'quota':
      return `${label} says the account is out of credit or quota. Check your billing with them.${tail}`
    case 'rate_limit':
      return `${label} is rate limiting requests right now. Wait a few seconds and try again.${tail}`
    case 'timeout':
      return detail || `${label} stopped responding before finishing. Try again.`
    case 'network':
      return `Could not reach ${label}. Check your internet connection and the endpoint URL in Settings.${tail}`
    case 'server':
      return `${label} had a server error${status ? ` (${status})` : ''}. This is usually temporary — try again.${tail}`
    case 'bad_request':
      return `${label} rejected the request${status ? ` (${status})` : ''}.${tail}`
    case 'not_found':
      return `${label} returned "not found"${status ? ` (${status})` : ''}. Check the model name and endpoint URL in Settings.${tail}`
    case 'cancelled':
      return detail || 'The request was cancelled.'
    case 'unsupported':
      return detail || `${label} does not support this operation.`
    default:
      return detail || `${label} request failed${status ? ` (${status})` : ''}.`
  }
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly provider?: ProviderIdOrLabel
  readonly status?: number
  readonly retryAfterMs?: number
  readonly retryable: boolean
  readonly detail?: string

  constructor(message: string, options: ProviderErrorOptions) {
    super(message)
    this.name = 'ProviderError'
    this.kind = options.kind
    this.provider = options.provider
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    this.retryable = options.retryable ?? RETRYABLE[options.kind]
    this.detail = options.detail
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError
}

/** `Retry-After` may be seconds or an HTTP date; both become milliseconds. */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined
  const value = header.trim()
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const date = Date.parse(value)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - now)
}

export function classifyStatus(
  status: number,
  body = '',
  options: { provider?: ProviderIdOrLabel; retryAfter?: string | null; now?: number } = {}
): ProviderError {
  const detail = extractDetail(body)
  const retryAfterMs = parseRetryAfter(options.retryAfter, options.now)
  const label = providerLabel(options.provider)

  let kind: ProviderErrorKind
  if (status === 401 || status === 403) kind = 'auth'
  else if (status === 402) kind = 'quota'
  else if (status === 404) kind = 'not_found'
  else if (status === 408) kind = 'timeout'
  else if (status === 429) kind = 'rate_limit'
  else if (status >= 500) kind = 'server'
  else if (status === 400 || status === 422) kind = 'bad_request'
  else kind = 'unknown'

  return new ProviderError(messageFor(kind, label, status, detail), {
    kind,
    provider: options.provider,
    status,
    retryAfterMs,
    detail
  })
}

function codeOf(error: unknown): string {
  const value = error as { code?: unknown; cause?: { code?: unknown } } | null
  const direct = typeof value?.code === 'string' ? value.code : undefined
  const nested = typeof value?.cause?.code === 'string' ? value.cause.code : undefined
  return direct ?? nested ?? ''
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'ERR_SOCKET_CONNECTION_TIMEOUT'
])

function isAbortError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name
  const code = codeOf(error)
  return name === 'AbortError' || name === 'TimeoutError' || code === 'ABORT_ERR'
}

/** Classify anything thrown by `fetch`, a body read, or our own guards. */
export function classifyThrown(error: unknown, options: { provider?: ProviderIdOrLabel } = {}): ProviderError {
  if (isProviderError(error)) return error

  const label = providerLabel(options.provider)
  const raw = error instanceof Error ? error.message : String(error)
  const detail = redactString(raw).slice(0, MAX_DETAIL)
  const code = codeOf(error)
  const name = (error as { name?: unknown } | null)?.name

  if (isAbortError(error)) {
    return new ProviderError('The request was cancelled.', { kind: 'cancelled', provider: options.provider })
  }
  if (name === 'StreamStalledError') {
    return new ProviderError(detail, { kind: 'timeout', provider: options.provider, detail })
  }
  if (code && NETWORK_CODES.has(code)) {
    return new ProviderError(messageFor('network', label, undefined, detail), {
      kind: 'network',
      provider: options.provider,
      detail
    })
  }
  if (/fetch failed|network|socket hang up|terminated|other side closed|ECONNRESET/i.test(raw)) {
    return new ProviderError(messageFor('network', label, undefined, detail), {
      kind: 'network',
      provider: options.provider,
      detail
    })
  }
  return new ProviderError(detail || `${label} request failed.`, { kind: 'unknown', provider: options.provider, detail })
}

export function isRetryable(error: unknown): boolean {
  if (!isProviderError(error)) return false
  return error.retryable
}

/** A message safe to show a user or store on a message record. */
export function toUserMessage(error: unknown): string {
  if (isProviderError(error)) return error.message
  if (error instanceof Error) return redactString(error.message) || 'Request failed.'
  return 'Request failed.'
}

/** Convenience: classify, then describe. */
export function describeFailure(error: unknown, provider?: ProviderIdOrLabel): string {
  return toUserMessage(isProviderError(error) ? error : classifyThrown(error, { provider }))
}
