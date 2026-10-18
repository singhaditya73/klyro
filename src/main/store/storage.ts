import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../logger'

/**
 * Storage bookkeeping for the files Klyro keeps in `userData`.
 *
 * The rules here are deliberately conservative: nothing that could be the only
 * copy of the user's data is removed. Temp files are unfinished writes, patch
 * backups are copies of source files that a *pending* revert still needs, and
 * quarantined files (see `json-store.ts`) are reported but never deleted.
 */

export const BACKUP_DIR = 'patch-backups'

export interface StorageBreakdown {
  /** Bytes of data files (settings, history, indexes, …) in the root. */
  dataBytes: number
  dataFiles: number
  /** Patch backup copies of edited project files. */
  backupBytes: number
  backupFiles: number
  /** Total bytes of everything above, for the "using N MB" line. */
  totalBytes: number
}

export interface SweepResult {
  removedTempFiles: number
  removedBackups: number
  freedBytes: number
}

function fileInfo(path: string): { bytes: number; isFile: boolean; isDir: boolean; modified: number } | null {
  try {
    const stats = statSync(path)
    return { bytes: stats.size, isFile: stats.isFile(), isDir: stats.isDirectory(), modified: stats.mtimeMs }
  } catch {
    return null
  }
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** Measure what Klyro is using on disk. */
export function measureStorage(root: string): StorageBreakdown {
  let dataBytes = 0
  let dataFiles = 0
  for (const name of listDir(root)) {
    const info = fileInfo(join(root, name))
    // Quarantined files count: they are still the user's data taking space.
    if (info?.isFile) {
      dataBytes += info.bytes
      dataFiles += 1
    }
  }

  let backupBytes = 0
  let backupFiles = 0
  for (const name of listDir(join(root, BACKUP_DIR))) {
    const info = fileInfo(join(root, BACKUP_DIR, name))
    if (info?.isFile) {
      backupBytes += info.bytes
      backupFiles += 1
    }
  }

  return { dataBytes, dataFiles, backupBytes, backupFiles, totalBytes: dataBytes + backupBytes }
}

/**
 * Remove unfinished writes (`<name>.tmp`) and patch backups that no applied
 * patch can still revert to.
 */
export function sweepStorage(root: string, referencedBackups: ReadonlySet<string>): SweepResult {
  const result: SweepResult = { removedTempFiles: 0, removedBackups: 0, freedBytes: 0 }

  for (const name of listDir(root)) {
    if (!name.endsWith('.tmp')) continue
    const path = join(root, name)
    const info = fileInfo(path)
    if (!info?.isFile) continue
    try {
      rmSync(path, { force: true })
      result.removedTempFiles += 1
      result.freedBytes += info.bytes
      logger.warn('Storage: removed an unfinished write', path)
    } catch (error) {
      logger.warn('Storage: could not remove', path, (error as Error).message)
    }
  }

  const backupRoot = join(root, BACKUP_DIR)
  for (const name of listDir(backupRoot)) {
    const path = join(backupRoot, name)
    const info = fileInfo(path)
    if (!info?.isFile) continue
    // Keep anything a stored patch still points at, so revert always works.
    if (referencedBackups.has(path)) continue
    try {
      rmSync(path, { force: true })
      result.removedBackups += 1
      result.freedBytes += info.bytes
    } catch (error) {
      logger.warn('Storage: could not remove backup', path, (error as Error).message)
    }
  }

  return result
}
