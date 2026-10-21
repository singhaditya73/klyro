import { describe, expect, it } from 'vitest'
import { antigravityProvider } from './antigravity'

/**
 * The Antigravity provider talks to a service on the user's machine, so the
 * unit test covers the contract that does not need it: an unset model must
 * fail with a message that tells the user what to do, rather than a cryptic
 * provider error.
 */
describe('Antigravity provider', () => {
  it('explains that a model must be picked first', async () => {
    await expect(
      (async () => {
        for await (const _chunk of antigravityProvider.chat({
          model: '',
          baseUrl: 'local://antigravity',
          apiKey: null,
          turns: [{ role: 'user', text: 'hello' }]
        })) {
          // consume
        }
      })()
    ).rejects.toThrow(/pick an antigravity model/i)
  })

  it('reports a clear failure when the service is not running', async () => {
    const result = await antigravityProvider.test({
      baseUrl: 'local://antigravity',
      apiKey: null,
      model: 'MODEL_X'
    })
    expect(typeof result.detail).toBe('string')
    expect(result.detail.length).toBeGreaterThan(0)
  })
})
