/**
 * Bounded retries for provider calls.
 *
 * Only failures the taxonomy calls retryable are retried, and only while the
 * work has not started producing output (a streaming answer cannot be replayed
 * without duplicating text the user already saw). `Retry-After` is honoured when
 * it is short enough to be reasonable; a longer wait is surfaced instead, so the
 * user is not left staring at a spinner.
 */

import { classifyThrown, isRetryable, ProviderError } from './errors'

export const DEFAULT_ATTEMPTS = 3
export const DEFAULT_BASE_DELAY_MS = 400
export const DEFAULT_MAX_DELAY_MS = 4000

export interface RetryInfo {
  /** 1-based number of the attempt that just failed. */
  attempt: number
  attempts: number
  error: ProviderError
  delayMs: number
}

export interface RetryOptions {
  /** Total attempts, including the first. Clamped to at least 1. */
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  signal?: AbortSignal
  /** Called before each wait, for logging or tests. */
  onRetry?: (info: RetryInfo) => void
  provider?: string
  /** Injectable for deterministic tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Injectable jitter source (0..1). */
  random?: () => number
}

export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort(): void {
      clearTimeout(timer)
      reject(classifyThrown(new DOMException('Aborted', 'AbortError')))
    }
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(classifyThrown(new DOMException('Aborted', 'AbortError')))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/** Exponential backoff with a little jitter, capped, and mindful of `Retry-After`. */
export function nextDelay(attempt: number, error: ProviderError, options: RetryOptions = {}): number {
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const random = options.random ?? Math.random
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1))
  const jittered = exponential * (0.8 + random() * 0.4)
  const preferred = error.retryAfterMs ?? 0
  return Math.min(max, Math.max(jittered, preferred))
}

export async function withRetry<T>(run: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? DEFAULT_ATTEMPTS))
  const sleep = options.sleep ?? sleepWithSignal
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS

  for (let attempt = 1; ; attempt += 1) {
    if (options.signal?.aborted) throw classifyThrown(new DOMException('Aborted', 'AbortError'))
    try {
      return await run(attempt)
    } catch (error) {
      const failure = classifyThrown(error, { provider: options.provider })
      const exhausted = attempt >= attempts
      // A wait longer than we are willing to hold the user for is not a retry:
      // report it now so the message reaches the UI.
      const tooLongToWait = Boolean(failure.retryAfterMs && failure.retryAfterMs > max)
      if (exhausted || !isRetryable(failure) || tooLongToWait) throw failure

      const delayMs = nextDelay(attempt, failure, options)
      options.onRetry?.({ attempt, attempts, error: failure, delayMs })
      await sleep(delayMs, options.signal)
    }
  }
}
