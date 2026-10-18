import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import { logger } from '../logger'

interface SecretsFile {
  /** True when every value in `keys` is OS-encrypted. */
  encrypted: boolean
  keys: Record<string, string>
}

/** Thrown when a secret cannot be stored securely and plaintext is not allowed. */
export class SecureStorageUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecureStorageUnavailableError'
  }
}

const PLAINTEXT_REFUSED =
  'This system has no OS keychain available, so Klyro cannot encrypt your API key. ' +
  'Install a keyring (e.g. gnome-keyring or kwallet) for secure storage, or explicitly allow unencrypted storage in Settings.'

/**
 * API key storage backed by Electron `safeStorage` (Keychain / DPAPI / libsecret).
 *
 * When no OS keychain is available we do NOT silently write plaintext. Storage
 * fails until the user explicitly opts in (`setPlaintextPolicy(true)`), and any
 * plaintext keys are re-encrypted as soon as a keychain becomes available.
 */
class SecretStore {
  private readonly file = join(app.getPath('userData'), 'secrets.json')
  private data: SecretsFile = { encrypted: false, keys: {} }
  private ready = false
  private allowPlaintext = false

  init(): void {
    this.data = this.read()
    this.ready = true
    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn(
        'OS encryption unavailable; API keys cannot be stored securely until a keyring is installed or plaintext is allowed.'
      )
    } else {
      this.migrateToEncrypted()
    }
  }

  /** Called from settings when the user opts in/out of unencrypted storage. */
  setPlaintextPolicy(allow: boolean): void {
    this.allowPlaintext = allow
  }

  private read(): SecretsFile {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SecretsFile>
      return { encrypted: Boolean(parsed.encrypted), keys: parsed.keys ?? {} }
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

  /** Re-encrypt any plaintext keys once a keychain is available. */
  private migrateToEncrypted(): void {
    if (this.data.encrypted) return
    const ids = Object.keys(this.data.keys)
    if (ids.length === 0) return
    try {
      const keys: Record<string, string> = {}
      for (const id of ids) keys[id] = safeStorage.encryptString(this.data.keys[id]).toString('base64')
      this.data = { encrypted: true, keys }
      this.persist()
      logger.info(`Re-encrypted ${ids.length} stored credential(s) with the OS keychain.`)
    } catch (error) {
      logger.warn('Could not re-encrypt stored credentials', error)
    }
  }

  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /** True when the store holds credentials that are not OS-encrypted. */
  hasPlaintextSecrets(): boolean {
    if (!this.ready) this.init()
    return !this.data.encrypted && Object.keys(this.data.keys).length > 0
  }

  count(): number {
    if (!this.ready) this.init()
    return Object.keys(this.data.keys).length
  }

  has(id: string): boolean {
    if (!this.ready) this.init()
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
    } else if (this.data.encrypted && Object.keys(this.data.keys).length > 0) {
      // Existing secrets are encrypted; writing plaintext would corrupt reads.
      throw new SecureStorageUnavailableError(PLAINTEXT_REFUSED)
    } else if (this.allowPlaintext) {
      this.data.encrypted = false
      this.data.keys[id] = trimmed
    } else {
      throw new SecureStorageUnavailableError(PLAINTEXT_REFUSED)
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
    if (!this.ready) this.init()
    delete this.data.keys[id]
    this.persist()
  }
}

export const secrets = new SecretStore()
