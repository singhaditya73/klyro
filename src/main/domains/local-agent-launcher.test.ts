import { mkdtempSync, chmodSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-launcher-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData, on: () => undefined, getVersion: () => '0-test' },
  // The secret store needs a keyring; a fake one is enough for the test.
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`).toString('base64'),
    decryptString: (value: string) => Buffer.from(value, 'base64').toString().replace(/^enc:/, '')
  }
}))

const { findOpenCodeBinary, localAgentLauncher } = await import('./local-agent-launcher')

/** A fake `opencode` that behaves like the real one: it prints its URL and a
 *  generated password, then stays alive. */
function writeFakeBinary(): string {
  const dir = mkdtempSync(join(tmpdir(), 'klyro-fakebin-'))
  const file = join(dir, 'opencode')
  writeFileSync(
    file,
    `#!/bin/sh
echo "server listening on http://127.0.0.1:$3"
echo "server password fake-password-123"
while true; do sleep 1; done
`
  )
  chmodSync(file, 0o755)
  return file
}

let fakeBinary = ''
// PATH is process-wide and the worker is shared between test files, so the
// fake binary comes off again when this file is done.
const originalPath = process.env.PATH

beforeAll(() => {
  fakeBinary = writeFakeBinary()
  // Put the fake binary first on PATH.
  process.env.PATH = `${fakeBinary.slice(0, fakeBinary.lastIndexOf('/'))}:${process.env.PATH ?? ''}`
})

afterAll(() => {
  localAgentLauncher.stopOpenCode()
  process.env.PATH = originalPath
})

describe('local agent launcher', () => {
  it('finds an OpenCode binary on PATH', () => {
    expect(findOpenCodeBinary()).toBe(fakeBinary)
  })

  it('starts the server, reads the password it printed, and keeps it encrypted', async () => {
    const result = await localAgentLauncher.startOpenCode()
    expect(result.started).toBe(true)
    expect(result.spawned).toBe(true)
    expect(result.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    // The password the server printed is now stored for the provider to use.
    const { secrets } = await import('../security/secrets')
    expect(secrets.get('opencode')).toBe('fake-password-123')
  }, 30000)

  it('stops the server it started', () => {
    localAgentLauncher.stopOpenCode()
    expect(localAgentLauncher.status().running).toBe(false)
  })
})
