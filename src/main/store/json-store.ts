import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { logger } from '../logger'

/**
 * Tiny synchronous JSON store with atomic writes (write-temp-then-rename).
 * Data files are small (settings, conversation history), so sync IO is fine
 * and keeps initialization deterministic.
 */
export class JsonStore<T extends object> {
  readonly file: string
  private data: T

  constructor(filename: string, private readonly defaults: T) {
    this.file = join(app.getPath('userData'), filename)
    this.data = this.read()
  }

  private read(): T {
    try {
      const raw = readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw) as Partial<T>
      return { ...structuredClone(this.defaults), ...parsed }
    } catch {
      return structuredClone(this.defaults)
    }
  }

  get(): T {
    return this.data
  }

  set(next: T): T {
    this.data = next
    this.persist()
    return this.data
  }

  update(mutate: (draft: T) => void): T {
    mutate(this.data)
    this.persist()
    return this.data
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (error) {
      logger.error('Failed to persist store', this.file, error)
    }
  }
}
