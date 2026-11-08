import { afterEach, describe, expect, it, vi } from 'vitest'
import { installAirgapFetchGuard, setAirgapShield } from './request'
import { runCliAgent } from './cli-agent'

afterEach(() => {
  setAirgapShield(false)
  vi.unstubAllGlobals()
})

describe('Airgap Shield enforcement', () => {
  it('guards every fetch, refusing hosted endpoints and allowing loopback', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        calls.push(String(input))
        return new Response('ok', { status: 200 })
      })
    )
    // Install after the stub so the guard wraps the fake transport instead of
    // making a real request through the loopback branch.
    installAirgapFetchGuard()
    setAirgapShield(true)

    await expect(fetch('https://api.example.com/v1/chat')).rejects.toThrow(/Airgap Shield is on/)
    const loopback = await fetch('http://127.0.0.1:11434/api/tags')
    expect(loopback.ok).toBe(true)
    expect(calls).toEqual(['http://127.0.0.1:11434/api/tags'])

    // Turning the shield off restores the hosted path.
    setAirgapShield(false)
    await fetch('https://api.example.com/v1/chat')
    expect(calls).toHaveLength(2)
  })

  it('refuses to spawn an agent CLI while the shield is on', async () => {
    setAirgapShield(true)
    const consume = async (): Promise<void> => {
      for await (const _line of runCliAgent({ binary: 'echo', args: ['hello'] })) {
        // Nothing should be produced: the refusal happens before spawn.
      }
    }
    await expect(consume()).rejects.toThrow(/Airgap Shield is on/)
  })
})
