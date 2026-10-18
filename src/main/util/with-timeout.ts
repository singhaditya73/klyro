/** Raised when an operation is abandoned because it exceeded its time budget. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * Reject when `promise` has not settled within `ms`.
 *
 * The underlying work is expected to observe `onTimeout` (typically an
 * AbortController) so that a timed-out network request is actually cancelled
 * rather than left running in the background.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout?: () => void
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        onTimeout?.()
      } catch {
        // Aborting is best-effort; the timeout itself is what we report.
      }
      reject(new TimeoutError(message))
    }, ms)

    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
