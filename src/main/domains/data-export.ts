import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import { logger } from '../logger'
import { memory } from './memory'
import { documents } from './documents'
import { interviews } from './interviews'

export interface ExportBundleResult {
  ok: boolean
  /** Where the bundle was written, when it was. */
  path?: string
  error?: string
}

/**
 * One file the user owns: every memory, every indexed document with its text,
 * and every meeting/interview record. It is deliberately a plain JSON bundle
 * rather than a proprietary backup, so the data is readable without Klyro.
 *
 * The file is written with owner-only permissions; it can contain everything
 * the user has told the assistant, so it must not be world-readable.
 */
export async function exportDataBundle(): Promise<ExportBundleResult> {
  const day = new Date().toISOString().slice(0, 10)
  const chosen = await dialog.showSaveDialog({
    title: 'Export Klyro data',
    buttonLabel: 'Export',
    defaultPath: join(app.getPath('documents'), `klyro-export-${day}.json`),
    filters: [{ name: 'Klyro data bundle', extensions: ['json'] }]
  })
  if (chosen.canceled || !chosen.filePath) {
    return { ok: false, error: 'Export cancelled' }
  }

  const bundle = {
    app: 'Klyro',
    version: app.getVersion(),
    exportedAt: new Date().toISOString(),
    memories: memory.list(),
    documents: documents.list().map((document) => ({
      ...document,
      text: documents.documentText(document.id)?.text ?? ''
    })),
    meetings: interviews
      .list()
      .map((summary) => interviews.get(summary.id))
      // Ephemeral sessions were promised never to be written down; an export
      // is still writing them, so they are not part of the bundle.
      .filter((session): session is NonNullable<typeof session> => session !== null && session.ephemeral !== true)
  }

  try {
    await writeFile(chosen.filePath, JSON.stringify(bundle, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
    logger.info('Exported a data bundle', chosen.filePath)
    return { ok: true, path: chosen.filePath }
  } catch (error) {
    logger.warn('Could not write the data bundle', (error as Error).message)
    return { ok: false, error: `Could not write the file: ${(error as Error).message}` }
  }
}
