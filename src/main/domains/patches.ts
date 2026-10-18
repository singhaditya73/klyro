import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { app } from 'electron'
import type { PatchRecord, PatchRequest } from '@shared/types'
import { isIndexableFile, isSecretFile } from '../knowledge/code-files'
import { logger } from '../logger'
import { JsonStore } from '../store/json-store'
import { buildHunks, formatUnified, summarize } from '../util/diff'
import { documents } from './documents'
import { project } from './project'

interface PatchState {
  patches: PatchRecord[]
}

/** Pending + applied edits, kept so a change can always be reverted. */
const MAX_PATCHES = 50
const MAX_FILE_BYTES = 2 * 1024 * 1024

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

/**
 * Reviewable file edits.
 *
 * Nothing is written until the user approves a patch, the file is re-checked
 * against the version the diff was built from, and a backup is taken first.
 * These edits are driven by explicit UI actions — never by model output alone.
 */
class PatchDomain {
  private readonly store = new JsonStore<PatchState>('patches.json', { patches: [] })
  private readonly backupRoot = join(app.getPath('userData'), 'patch-backups')

  list(): PatchRecord[] {
    return [...this.store.get().patches].sort((a, b) => b.created - a.created)
  }

  get(id: string): PatchRecord {
    const patch = this.store.get().patches.find((candidate) => candidate.id === id)
    if (!patch) throw new Error('That patch no longer exists.')
    return patch
  }

  /** Resolve a workspace-relative path to an absolute path inside the index. */
  private resolveTarget(relativePath: string): { absolute: string; relativePath: string } {
    const root = project.status().root
    if (!root) throw new Error('Index a project folder first — edits are limited to the indexed project.')

    const cleaned = relativePath.trim().replace(/^[/\\]+/, '')
    if (!cleaned) throw new Error('Give the file path relative to the project root.')
    const absolute = resolve(root, cleaned)
    const inside = absolute === resolve(root) || absolute.startsWith(resolve(root) + sep)
    if (!inside) throw new Error('That path is outside the indexed project.')
    if (isSecretFile(basename(absolute))) throw new Error('Files that hold credentials are never edited.')

    return { absolute, relativePath: relative(root, absolute).split(sep).join('/') }
  }

  /** Build a diff for a proposed change. Writes nothing. */
  async propose(request: PatchRequest): Promise<PatchRecord> {
    const { absolute, relativePath } = this.resolveTarget(request.path)

    if (isSecretFile(basename(absolute))) throw new Error('Files that hold credentials are never edited.')
    if (typeof request.content !== 'string') throw new Error('The proposed content must be text.')
    if (Buffer.byteLength(request.content, 'utf8') > MAX_FILE_BYTES) {
      throw new Error(`Proposed content is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`)
    }

    let before = ''
    let exists = true
    try {
      const info = await stat(absolute)
      if (!info.isFile()) throw new Error('That path is not a file.')
      if (info.size > MAX_FILE_BYTES) throw new Error('That file is too large to edit safely.')
      before = await readFile(absolute, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      exists = false
    }

    if (exists) {
      // Only the kinds of file the indexer already accepts may be edited.
      if (!isIndexableFile(relativePath, 1, MAX_FILE_BYTES)) {
        throw new Error('Klyro only edits source and text files inside the indexed project.')
      }
    }

    const hunks = buildHunks(before, request.content)
    if (hunks.length === 0) throw new Error('The proposed content is identical to the current file.')
    const stats = summarize(hunks)

    const patch: PatchRecord = {
      id: randomUUID(),
      path: relativePath,
      absolutePath: absolute,
      createdFile: !exists,
      created: Date.now(),
      appliedAt: null,
      revertedAt: null,
      status: 'pending',
      addedLines: stats.added,
      removedLines: stats.removed,
      beforeHash: hash(before),
      diff: formatUnified(hunks, `a/${relativePath}`, `b/${relativePath}`),
      content: request.content,
      backupPath: null,
      error: null
    }

    this.store.update((state) => {
      state.patches = [patch, ...state.patches].slice(0, MAX_PATCHES)
    })
    return patch
  }

  /** Apply an approved patch, backing up the previous contents first. */
  async apply(id: string): Promise<PatchRecord> {
    const patch = this.get(id)
    if (patch.status !== 'pending') throw new Error(`That patch is already ${patch.status}.`)

    let current = ''
    try {
      current = await readFile(patch.absolutePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (!patch.createdFile) throw new Error('The file was removed outside Klyro — re-check the change.')
    }

    if (!patch.createdFile && hash(current) !== patch.beforeHash) {
      throw new Error('The file changed since this diff was made. Re-check the change before applying it.')
    }

    let backupPath: string | null = null
    if (!patch.createdFile) {
      await mkdir(this.backupRoot, { recursive: true })
      backupPath = join(this.backupRoot, `${patch.id}-${basename(patch.absolutePath)}`)
      await copyFile(patch.absolutePath, backupPath)
    }

    // Write via a temp file in the same directory so a crash cannot truncate the original.
    await mkdir(dirname(patch.absolutePath), { recursive: true })
    const temporary = `${patch.absolutePath}.klyro-tmp`
    try {
      await writeFile(temporary, patch.content, 'utf8')
      await rename(temporary, patch.absolutePath)
    } catch (error) {
      // Never leave a stray temp file next to the user's source.
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }

    logger.info(`Patches: applied edit to ${patch.path}`)
    this.store.update((state) => {
      const target = state.patches.find((candidate) => candidate.id === id)
      if (!target) return
      target.status = 'applied'
      target.appliedAt = Date.now()
      target.backupPath = backupPath
      target.error = null
      // The contents are on disk now; the backup is what revert uses.
      target.content = ''
    })

    // Re-index just this file so later answers see the new contents.
    await this.refreshIndex(patch)

    return this.get(id)
  }

  /** Put a file back the way it was before a patch was applied. */
  async revert(id: string): Promise<PatchRecord> {
    const patch = this.get(id)
    if (patch.status !== 'applied') throw new Error('Only an applied patch can be reverted.')

    if (patch.createdFile) {
      // The file did not exist before, so reverting means removing it.
      await rm(patch.absolutePath, { force: true })
    } else {
      if (!patch.backupPath) throw new Error('This patch has no backup to restore.')
      const backup = await readFile(patch.backupPath, 'utf8')
      await writeFile(patch.absolutePath, backup, 'utf8')
    }

    logger.info(`Patches: reverted edit to ${patch.path}`)
    this.store.update((state) => {
      const target = state.patches.find((candidate) => candidate.id === id)
      if (!target) return
      target.status = 'reverted'
      target.revertedAt = Date.now()
    })

    await this.refreshIndex(patch)
    return this.get(id)
  }

  /** Drop a pending proposal without touching the file. */
  discard(id: string): PatchRecord[] {
    const patch = this.get(id)
    if (patch.status === 'applied') throw new Error('Revert this patch before discarding it.')
    this.store.update((state) => {
      state.patches = state.patches.filter((candidate) => candidate.id !== id)
    })
    return this.list()
  }

  private async refreshIndex(patch: PatchRecord): Promise<void> {
    try {
      await documents.importFromPath(patch.absolutePath, 'workspace', patch.path)
    } catch (error) {
      // The edit is already on disk; a stale index is a lesser problem.
      logger.warn('Patches: could not re-index after edit', (error as Error).message)
    }
  }

  clear(): void {
    this.store.set({ patches: [] })
  }

  /**
   * Backups that an applied patch can still restore. Anything else on disk is an
   * orphan (the patch was reverted, discarded, or aged out of the list).
   */
  referencedBackups(): string[] {
    return this.store
      .get()
      .patches.filter((patch) => patch.status === 'applied' && patch.backupPath)
      .map((patch) => patch.backupPath as string)
  }
}

export const patches = new PatchDomain()
