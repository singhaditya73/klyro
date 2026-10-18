import { describe, expect, it, vi } from 'vitest'
import { ProviderError } from './errors'
import { nextDelay, sleepWithSignal, withRetry } from './retry'

/** No real waiting in tests. */
const noSleep = async (): Promise<void> => undefined

describe('withRetry', () => {
  it('returns the first successful result without retrying', async () => {
    const run = vi.fn(async () => 'ok')
    await expect(withRetry(run, { sleep: noSleep })).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('retries a transient failure and succeeds', async () => {
    let calls = 0
    const run = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new ProviderError('busy', { kind: 'server' })
      return 'recovered'
    })
    await expect(withRetry(run, { sleep: noSleep })).resolves.toBe('recovered')
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('never retries a failure that cannot improve', async () => {
    const run = vi.fn(async () => {
      throw new ProviderError('bad key', { kind: 'auth' })
    })
    await expect(withRetry(run, { sleep: noSleep })).rejects.toThrow('bad key')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('gives up after the attempt budget', async () => {
    const run = vi.fn(async () => {
      throw new ProviderError('flaky', { kind: 'server' })
    })
    await expect(withRetry(run, { attempts: 2, sleep: noSleep })).rejects.toBeInstanceOf(ProviderError)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('classifies what it throws coarsely', async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    })
    await expect(withRetry(run, { attempts: 1, sleep: noSleep, provider: 'ollama' })).rejects.toMatchObject({
      kind: 'network'
    })
  })

  it('reports each retry with the delay it will wait', async () => {
    const onRetry = vi.fn()
    let calls = 0
    const run = async (): Promise<string> => {
      calls += 1
      if (calls === 1) throw new ProviderError('busy', { kind: 'rate_limit', retryAfterMs: 2000 })
      return 'ok'
    }
    await withRetry(run, { sleep: noSleep, onRetry, baseDelayMs: 100, maxDelayMs: 5000, random: () => 0.5 })

    expect(onRetry).toHaveBeenCalledTimes(1)
    const info = onRetry.mock.calls[0][0]
    expect(info.attempt).toBe(1)
    expect(info.attempts).toBe(3)
    // The server asked for 2s, which is more than the backoff would have been.
    expect(info.delayMs).toBe(2000)
  })

  it('refuses to hold the user for an unreasonably long Retry-After', async () => {
    const run = vi.fn(async () => {
      throw new ProviderError('slow down', { kind: 'rate_limit', retryAfterMs: 120_000 })
    })
    await expect(withRetry(run, { sleep: noSleep, maxDelayMs: 4000 })).rejects.toThrow('slow down')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('stops retrying once the caller aborts', async () => {
    const controller = new AbortController()
    const run = vi.fn(async () => {
      controller.abort()
      throw new ProviderError('busy', { kind: 'server' })
    })
    await expect(withRetry(run, { signal: controller.signal, sleep: noSleep })).rejects.toMatchObject({
      kind: 'cancelled'
    })
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('nextDelay', () => {
  it('grows exponentially, jitters, and stays capped', () => {
    const error = new ProviderError('busy', { kind: 'server' })
    const options = { baseDelayMs: 100, maxDelayMs: 1000, random: () => 0.5 }
    expect(nextDelay(1, error, options)).toBe(100)
    expect(nextDelay(2, error, options)).toBe(200)
    expect(nextDelay(10, error, options)).toBe(1000)
  })

  it('never returns less than the jitter floor', () => {
    const error = new ProviderError('busy', { kind: 'server' })
    expect(nextDelay(1, error, { baseDelayMs: 100, random: () => 0 })).toBe(80)
  })
})

describe('sleepWithSignal', () => {
  it('resolves after the delay', async () => {
    await expect(sleepWithSignal(1)).resolves.toBeUndefined()
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(sleepWithSignal(50, controller.signal)).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('wakes up when aborted mid-wait', async () => {
    const controller = new AbortController()
    const pending = sleepWithSignal(5000, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' })
  })
})
