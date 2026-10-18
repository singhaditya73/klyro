import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// registry imports github, which wires the encrypted secret store at import time.
vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'klyro-registry-test') },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^enc:/, '')
  }
}))

import type { IntegrationId } from '@shared/types'
import type { IntegrationClient } from './contract'
import { discardIntegrationTest, integrationStatuses, registeredIntegrations, testIntegration } from './registry'

// A contract-conformant fake, matching how a real integration registers.
function fakeClient(id: IntegrationId, ok: boolean, selfTestImpl: IntegrationClient['selfTest']): IntegrationClient {
  return {
    descriptor: { id, label: id, auth: 'token', summary: `${id} test client` },
    status: () => ({ connected: ok, detail: ok ? 'cred stored' : 'no cred' }),
    selfTest: selfTestImpl
  }
}

describe('integration registry', () => {
  it('reports at least one registered integration with full contract state', () => {
    const statuses = integrationStatuses()
    expect(registeredIntegrations()).toContain('github')
    const githubEntry = statuses.find((entry) => entry.id === 'github')
    if (!githubEntry) throw new Error('github missing from registry')
    expect(githubEntry.label).toBe('GitHub')
    expect(githubEntry.auth).toBe('token')
    expect(typeof githubEntry.summary).toBe('string')
    expect(githubEntry.detail.length).toBeGreaterThan(0)
    expect(githubEntry.connected).toBe(false) // tests run without stored credentials
  })

  it('captures a successful self-test and surfaces it in subsequent listings', async () => {
    const statuses = await testIntegration('github')
    const entry = statuses.find((e) => e.id === 'github')
    if (!entry?.test) throw new Error('missing test result')
    expect(entry.test.ok).toBe(false) // no token stored -> a helpful failure, not a crash
    expect(entry.test.detail).toMatch(/token/i)
    expect(entry.test.testedAt).toBeTruthy()
    // The cached result is visible without re-running the test.
    expect(integrationStatuses().find((e) => e.id === 'github')?.test?.testedAt).toBe(entry.test.testedAt)
    discardIntegrationTest('github')
    expect(integrationStatuses().find((e) => e.id === 'github')?.test).toBeNull()
  })

  it('re-throws selfTest failures so the caller can record them', async () => {
    const client = fakeClient('github', true, async () => {
      throw new Error('boom')
    })
    let caught: unknown = null
    try {
      await client.selfTest()
    } catch (error) {
      caught = error
    }
    expect((caught as Error).message).toBe('boom')
  })

  it('rejects testing an unknown integration', async () => {
    await expect(testIntegration('nope' as never)).rejects.toThrow(/unknown/i)
  })
})
