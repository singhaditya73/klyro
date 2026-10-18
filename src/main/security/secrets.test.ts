import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ userData: '', encryptionAvailable: false }))

vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  safeStorage: {
    isEncryptionAvailable: () => h.encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^enc:/, '')
  }
}))

beforeEach(() => {
  h.userData = mkdtempSync(join(tmpdir(), 'klyro-secrets-'))
  h.encryptionAvailable = false
  vi.resetModules()
})

function secretsFile(): { encrypted: boolean; keys: Record<string, string> } {
  return JSON.parse(readFileSync(join(h.userData, 'secrets.json'), 'utf8'))
}

describe('SecretStore', () => {
  it('refuses to store a secret in plaintext when no keychain exists', async () => {
    const { secrets, SecureStorageUnavailableError } = await import('./secrets')
    secrets.init()
    expect(() => secrets.set('openai', 'sk-test-key')).toThrow(SecureStorageUnavailableError)
    expect(() => secretsFile()).toThrow() // nothing written
  })

  it('stores unencrypted only after an explicit opt-in', async () => {
    const { secrets } = await import('./secrets')
    secrets.init()
    secrets.setPlaintextPolicy(true)
    secrets.set('openai', 'sk-test-key')
    expect(secrets.get('openai')).toBe('sk-test-key')
    expect(secretsFile().encrypted).toBe(false)
    expect(secrets.hasPlaintextSecrets()).toBe(true)
  })

  it('encrypts secrets when a keychain is available', async () => {
    h.encryptionAvailable = true
    const { secrets } = await import('./secrets')
    secrets.init()
    secrets.set('openai', 'sk-test-key')
    expect(secrets.get('openai')).toBe('sk-test-key')
    expect(secretsFile().encrypted).toBe(true)
    expect(secretsFile().keys.openai).not.toContain('sk-test-key')
    expect(secrets.hasPlaintextSecrets()).toBe(false)
  })

  it('re-encrypts existing plaintext secrets when a keychain appears', async () => {
    writeFileSync(
      join(h.userData, 'secrets.json'),
      JSON.stringify({ encrypted: false, keys: { openai: 'sk-plaintext' } }),
      'utf8'
    )
    h.encryptionAvailable = true
    const { secrets } = await import('./secrets')
    secrets.init()
    expect(secretsFile().encrypted).toBe(true)
    expect(secrets.get('openai')).toBe('sk-plaintext')
  })

  it('deletes a stored secret and reports counts', async () => {
    h.encryptionAvailable = true
    const { secrets } = await import('./secrets')
    secrets.init()
    secrets.set('openai', 'sk-a')
    secrets.set('anthropic', 'sk-b')
    expect(secrets.count()).toBe(2)
    secrets.delete('openai')
    expect(secrets.has('openai')).toBe(false)
    expect(secrets.count()).toBe(1)
  })
})
