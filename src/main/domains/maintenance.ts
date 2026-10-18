import { app } from 'electron'
import type { StorageReport } from '@shared/types'
import { logger } from '../logger'
import { quarantinedFiles } from '../store/json-store'
import { measureStorage, sweepStorage } from '../store/storage'
import { patches } from './patches'

/**
 * Housekeeping for what Klyro leaves on disk.
 *
 * A sweep runs once at startup so leftover temp files and orphaned backups do not
 * accumulate, and it can be run on demand from Settings. It never deletes a file
 * that could be the only copy of something: unreadable data files are set aside
 * by the JSON store and only reported here.
 */
class MaintenanceDomain {
  report(): StorageReport {
    const root = app.getPath('userData')
    const measured = measureStorage(root)
    return { ...measured, quarantined: quarantinedFiles(root) }
  }

  sweep(): StorageReport {
    const root = app.getPath('userData')
    // A backup is only needed while an applied patch can still be reverted.
    const keep = new Set(patches.referencedBackups())
    const result = sweepStorage(root, keep)
    if (result.removedTempFiles > 0 || result.removedBackups > 0) {
      logger.info(
        `Storage: removed ${result.removedTempFiles} unfinished write(s) and ${result.removedBackups} stale backup(s), freeing ${result.freedBytes} bytes`
      )
    }
    return { ...this.report(), lastSweep: { ...result, at: Date.now() } }
  }
}

export const maintenance = new MaintenanceDomain()
