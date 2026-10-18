import { describe, expect, it, vi } from 'vitest'
import { StreamStalledError, withIdleTimeout } from './idle-timeout'

async function* from(values: (string | number)[], delayMs = 0): AsyncGenerator<string> {
  for (const value of values) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (typeof value === 'number') throw new Error(`boom ${value}`)
    yield value
  }
}

describe('withIdleTimeout', () => {
  it('passes a healthy stream through untouched', async () => {
    const received: string[] = []
    for await (const chunk of withIdleTimeout(from(['a', 'b', 'c']), { idleMs: 1000 })) {
      received.push(chunk)
    }
    expect(received).toEqual(['a', 'b', 'c'])
  })

  it('fails with a clear error when the stream stalls', async () => {
    const onStall = vi.fn()
    const source = (async function* () {
      yield 'first'
      await new Promise(() => undefined) // never resolves
    })()

    const received: string[] = []
    await expect(async () => {
      for await (const chunk of withIdleTimeout(source, { idleMs: 30, onStall })) {
        received.push(chunk)
      }
    }).rejects.toThrow(StreamStalledError)

    expect(received).toEqual(['first'])
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('does not fail while chunks keep arriving within the idle window', async () => {
    const received: string[] = []
    for await (const chunk of withIdleTimeout(from(['a', 'b', 'c'], 15), { idleMs: 60 })) {
      received.push(chunk)
    }
    expect(received).toEqual(['a', 'b', 'c'])
  })

  it('propagates upstream errors instead of masking them', async () => {
    await expect(async () => {
      for await (const _chunk of withIdleTimeout(from(['a', 1]), { idleMs: 1000 })) {
        // drain
      }
    }).rejects.toThrow('boom 1')
  })

  it('closes the upstream iterator when the consumer stops early', async () => {
    let closed = false
    const source = (async function* () {
      try {
        yield 'a'
        yield 'b'
      } finally {
        closed = true
      }
    })()

    for await (const chunk of withIdleTimeout(source, { idleMs: 1000 })) {
      expect(chunk).toBe('a')
      break
    }
    expect(closed).toBe(true)
  })
})
