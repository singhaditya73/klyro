/**
 * Idle-timeout guard for model streams.
 *
 * A stalled provider would otherwise leave the caller waiting forever (there is
 * no cancel button for code actions, meetings, or workflows). This wraps a stream
 * and fails once the gap between values exceeds `idleMs`, so the user gets an
 * actionable error instead of an endless spinner.
 */

export const DEFAULT_IDLE_MS = 90_000

export class StreamStalledError extends Error {
  constructor(idleMs: number) {
    super(`The model stopped responding (no data for ${Math.round(idleMs / 1000)}s).`)
    this.name = 'StreamStalledError'
  }
}

export interface IdleTimeoutOptions {
  idleMs?: number
  /** Called before failing, so the caller can abort the underlying request. */
  onStall?: () => void
}

export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  options: IdleTimeoutOptions = {}
): AsyncGenerator<T> {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const iterator = source[Symbol.asyncIterator]()
  let finished = false

  const close = async (): Promise<void> => {
    if (finished) return
    finished = true
    try {
      await Promise.resolve(iterator.return?.(undefined as never))
    } catch {
      // The upstream already failed; nothing left to release.
    }
  }

  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const stalled = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          options.onStall?.()
          reject(new StreamStalledError(idleMs))
        }, idleMs)
      })

      let next: IteratorResult<T>
      try {
        next = await Promise.race([iterator.next(), stalled])
      } catch (error) {
        // Closing awaits the upstream generator, which may be parked on a promise
        // that only settles once the abort above lands — so release it without
        // blocking the error we are about to throw.
        void close()
        throw error
      } finally {
        if (timer) clearTimeout(timer)
      }

      if (next.done) {
        finished = true
        return
      }
      yield next.value
    }
  } finally {
    await close()
  }
}
