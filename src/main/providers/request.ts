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
export interface OpenResponseOptions {  provider?: string
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
