import { describe, expect, it, vi } from 'vitest'
import { TimeoutError, withTimeout } from './with-timeout'

describe('withTimeout', () => {
  it('passes through a value that arrives in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'too slow')).resolves.toBe('ok')
  })

  it('passes through rejection unchanged', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50, 'too slow')).rejects.toThrow('boom')
  })

  it('rejects with a TimeoutError and asks the work to stop', async () => {
    const onTimeout = vi.fn()
    const never = new Promise<string>(() => undefined)
    await expect(withTimeout(never, 5, 'took too long', onTimeout)).rejects.toBeInstanceOf(TimeoutError)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('treats a non-positive budget as no timeout at all', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 0, 'never')).resolves.toBe('ok')
  })
})
