import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { logger } from '../logger'

/**
 * Tiny synchronous JSON store with atomic writes (write-temp-then-rename).
 * Data files are small (settings, conversation history), so sync IO is fine
 * and keeps initialization deterministic.
 *
 * A file that cannot be parsed is *moved aside*, never overwritten. Silently
 * starting from defaults would look identical to the user but would destroy the
 * only copy of their history on the next write.
 */
export class JsonStore<T extends object> {
  readonly file: string
  private readonly defaults: T
  private data: T

  constructor(filename: string, defaults: T) {
    this.file = join(app.getPath('userData'), filename)
    this.defaults = defaults
    this.discardTempWrite()
    this.data = this.read()
  }

  /**
   * A crash between write and rename leaves `<file>.tmp` behind. It is unfinished
   * by definition, so it is removed rather than mistaken for data.
   */
  private discardTempWrite(): void {
    const tmp = `${this.file}.tmp`
    try {
      if (!existsSync(tmp)) return
      rmSync(tmp, { force: true })
      logger.warn('Removed an unfinished store write', tmp)
    } catch (error) {
      logger.warn('Could not remove an unfinished store write', tmp, (error as Error).message)
    }
  }

  private read(): T {
    let raw: string
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // A missing file is the normal first run.
      if (code !== 'ENOENT') {
        logger.error('Could not read store, starting from defaults', this.file, (error as Error).message)
      }
      return structuredClone(this.defaults)
    }

    try {
      const parsed = JSON.parse(raw) as Partial<T>
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('the file does not contain an object')
      }
      return { ...structuredClone(this.defaults), ...parsed }
    } catch (error) {
      const kept = quarantineFile(this.file)
      logger.error(
        'Store file could not be parsed; it was set aside instead of being overwritten',
        this.file,
        kept ?? '(could not be moved)',
        (error as Error).message
      )
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

  /** True when the file exists on disk and was written by `persist`. */
  exists(): boolean {
    return existsSync(this.file)
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

/**
 * Move an unreadable data file aside so the user keeps a copy to recover from.
 * Returns the new path, or null when the file could not be moved.
 */
export function quarantineFile(file: string, now = new Date()): string | null {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const target = `${file}.corrupt-${stamp}`
  try {
    renameSync(file, target)
    return target
  } catch {
    return null
  }
}

/** Data files that were set aside because they could not be parsed. */
export function quarantinedFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.includes('.corrupt-'))
      .sort()
  } catch {
    return []
  }
}
