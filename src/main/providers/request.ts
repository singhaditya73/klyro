/**
 * One place where every provider HTTP request is made.
 *
 * It retries the request *before* any response body is streamed, classifies the
 * failure, and never retries something the taxonomy says is pointless (a bad key
 * will still be a bad key on the second attempt).
 */

import { logger } from '../logger'
import { classifyStatus, classifyThrown } from './errors'
import { hostOf } from './http'
import { withRetry, type RetryInfo } from './retry'

let airgapShield = false
let airgapFetchGuardInstalled = false

export function setAirgapShield(enabled: boolean): void {
  airgapShield = enabled
}

export function isAirgapShield(): boolean {
  return airgapShield
}

/** Loopback endpoints stay reachable while the airgap shield is on. */
export function isLocalEndpoint(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  } catch {
    return false
  }
}

export function airgapError(endpoint: string): Error {
  return new Error(
    `Airgap Shield is on: ${endpoint} is not a local endpoint. Turn it off in Settings to use a hosted service.`
  )
}

/** Throws when the airgap shield is on and the URL is not loopback. */
export function assertAirgapAllowsUrl(url: string): void {
  if (!airgapShield || isLocalEndpoint(url)) return
  throw airgapError(hostOf(url))
}

/**
 * Route every `fetch` in the main process through the airgap check.
 *
 * `openResponse` is the door provider traffic goes through, but calendar
 * syncs, webhooks, diagnostics and model discovery each call `fetch` directly.
 * Wrapping the global once means a future call site cannot forget the switch.
 * Loopback is still allowed, so the local daemon and Ollama keep working.
 */
export function installAirgapFetchGuard(): void {
  if (airgapFetchGuardInstalled || typeof globalThis.fetch !== 'function') return
  const originalFetch = globalThis.fetch.bind(globalThis)
  const guarded: typeof fetch = (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    try {
      assertAirgapAllowsUrl(url)
    } catch (error) {
      return Promise.reject(error)
    }
    return originalFetch(input, init)
  }
  globalThis.fetch = guarded
  airgapFetchGuardInstalled = true
}

export interface OpenResponseOptions {
  provider?: string
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  signal?: AbortSignal
  /** Override how a response is judged (default: `response.ok`). */
  accept?: (response: Response) => boolean
  onRetry?: (info: RetryInfo) => void
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
}

/**
 * The classified, user-facing explanation of a failed response. Used by the
 * "test connection" buttons so they report the same thing a real call would.
 */
export async function responseDetail(response: Response, provider?: string): Promise<string> {
  const body = await response.text().catch(() => '')
  return classifyStatus(response.status, body, {
    provider,
    retryAfter: response.headers.get('retry-after')
  }).message
}

/**
 * `init` may be a function so that request bodies are rebuilt for each attempt
 * (a consumed body cannot be replayed).
 */
export async function openResponse(
  url: string,
  init: RequestInit | (() => RequestInit),
  options: OpenResponseOptions = {}
): Promise<Response> {
  // The endpoint is part of the failure message: "could not reach Groq" is
  // only half an answer without the host that was actually contacted.
  const endpoint = hostOf(url)
  assertAirgapAllowsUrl(url)
  return withRetry(
    async () => {
      let response: Response
      try {
        const resolved = typeof init === 'function' ? init() : { ...init }
        response = await fetch(url, resolved)
      } catch (error) {
        throw classifyThrown(error, { provider: options.provider, endpoint })
      }

      const accepted = options.accept ? options.accept(response) : response.ok
      if (!accepted) {
        const body = await response.text().catch(() => '')
        throw classifyStatus(response.status, body, {
          provider: options.provider,
          retryAfter: response.headers.get('retry-after'),
          endpoint
        })
      }
      return response
    },
    {
      attempts: options.attempts,
      baseDelayMs: options.baseDelayMs,
      maxDelayMs: options.maxDelayMs,
      signal: options.signal,
      sleep: options.sleep,
      random: options.random,
      provider: options.provider,
      onRetry:
        options.onRetry ??
        ((info) => logger.warn(`Provider ${options.provider ?? ''} attempt ${info.attempt} failed, retrying`, info.error.message))
    }
  )
}
