import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { logger } from '../logger'

interface SecretsFile {
  encrypted: boolean
  keys: Record<string, string>
}

/**
 * Encrypted-at-rest API key storage using the OS keychain via Electron
 * `safeStorage`. If the OS provides no backend (some Linux setups), we fall
 * back to plaintext with an explicit warning so the app remains usable.
 */
class SecretStore {
  private readonly file = join(app.getPath('userData'), 'secrets.json')
  private data: SecretsFile = { encrypted: false, keys: {} }
  private ready = false

  init(): void {
    this.data = this.read()
    this.ready = true
    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn('OS encryption unavailable; API keys will be stored unencrypted.')
    }
  }

  private read(): SecretsFile {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as SecretsFile
    } catch {
      return { encrypted: false, keys: {} }
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data), 'utf8')
      renameSync(tmp, this.file)
    } catch (error) {
      logger.error('Failed to persist secrets', error)
    }
  }

  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  has(id: string): boolean {
    return typeof this.data.keys[id] === 'string' && this.data.keys[id].length > 0
  }

  set(id: string, value: string): void {
    if (!this.ready) this.init()
    const trimmed = value.trim()
    if (!trimmed) {
      this.delete(id)
      return
    }
    if (safeStorage.isEncryptionAvailable()) {
      this.data.encrypted = true
      this.data.keys[id] = safeStorage.encryptString(trimmed).toString('base64')
    } else {
      this.data.encrypted = false
      this.data.keys[id] = trimmed
    }
    this.persist()
  }

  get(id: string): string | null {
    if (!this.ready) this.init()
    const raw = this.data.keys[id]
    if (!raw) return null
    if (!this.data.encrypted) return raw
    try {
      return safeStorage.decryptString(Buffer.from(raw, 'base64'))
    } catch (error) {
      logger.warn('Failed to decrypt secret (keychain changed?)', id, error)
      return null
    }
  }

  delete(id: string): void {
    delete this.data.keys[id]
    this.persist()
  }
}

export const secrets = new SecretStore()
