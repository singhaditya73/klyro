import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { dialog } from 'electron'
import type { ProjectStatus } from '@shared/types'
import { isIndexableFile, shouldSkipDirectory } from '../knowledge/code-files'
import { logger } from '../logger'
import { JsonStore } from '../store/json-store'
import { documents } from './documents'

/** What we knew about a file the last time it was indexed. */
interface TrackedFile {
  size: number
  mtimeMs: number
}

interface ProjectState {
  root: string | null
  indexedAt: number | null
  files: number
  skipped: number
  /** Relative path → the file's size/mtime when it was last indexed. */
  tracked: Record<string, TrackedFile>
  lastScan: { added: number; updated: number; reused: number; removed: number; skipped: number } | null
}

const MAX_FILES = 1500
const MAX_DEPTH = 12

/** Indexes a code workspace into the shared document store under the `workspace` group. */
class ProjectDomain {
  private readonly store = new JsonStore<ProjectState>('project.json', {
    root: null,
    indexedAt: null,
    files: 0,
    skipped: 0,
    tracked: {},
    lastScan: null
  })

  status(): ProjectStatus {
    const state = this.store.get()
    const stats = documents.statsFor('workspace')
    return {
      root: state.root,
      files: stats.files,
      chunks: stats.chunks,
      indexedAt: state.indexedAt,
      skipped: state.skipped,
      lastScan: state.lastScan ?? undefined
    }
  }

  private async walk(
    root: string,
    directory: string,
    depth: number,
    collector: { path: string; size: number; mtimeMs: number }[]
  ): Promise<void> {
    if (depth > MAX_DEPTH || collector.length >= MAX_FILES) return
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      logger.warn('Workspace scan skipped unreadable directory', directory, (error as Error).message)
      return
    }
    for (const entry of entries) {
      if (collector.length >= MAX_FILES) return
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) continue
        await this.walk(root, join(directory, entry.name), depth + 1, collector)
        continue
      }
      if (!entry.isFile()) continue
      const absolute = join(directory, entry.name)
      const relativePath = relative(root, absolute).split(sep).join('/')
      try {
        const info = await stat(absolute)
        if (isIndexableFile(relativePath, info.size)) {
          collector.push({ path: absolute, size: info.size, mtimeMs: info.mtimeMs })
        }
      } catch {
        // unreadable entry — skip
      }
    }
  }

  async index(): Promise<ProjectStatus> {
    const selection = await dialog.showOpenDialog({
      title: 'Choose a project folder to index',
      properties: ['openDirectory']
    })
    if (selection.canceled || selection.filePaths.length === 0) return this.status()
    return this.indexPath(selection.filePaths[0])
  }

  /**
   * Re-scan a workspace, only re-reading files that actually changed.
   *
   * Unchanged files (same size and modified time) keep their existing chunks, so
   * re-indexing a large project after editing one file is cheap. Files that
   * disappeared are dropped from the index.
   */
  async indexPath(root: string): Promise<ProjectStatus> {
    const state = this.store.get()
    // Only trust previous file records when re-indexing the same folder.
    const previous = state.root === root ? state.tracked ?? {} : {}

    const scanned: { path: string; size: number; mtimeMs: number }[] = []
    await this.walk(root, root, 0, scanned)

    const tracked: Record<string, TrackedFile> = {}
    let added = 0
    let updated = 0
    let reused = 0
    let skipped = 0

    for (const file of scanned) {
      const relativePath = relative(root, file.path).split(sep).join('/')
      const before = previous[relativePath]
      if (before && before.size === file.size && before.mtimeMs === file.mtimeMs) {
        tracked[relativePath] = before
        reused += 1
        continue
      }
      try {
        await documents.importFromPath(file.path, 'workspace', relativePath)
        tracked[relativePath] = { size: file.size, mtimeMs: file.mtimeMs }
        if (before) updated += 1
        else added += 1
      } catch (error) {
        logger.warn(`Project: skipped ${relativePath}`, (error as Error).message)
        skipped += 1
      }
    }

    // Drop index entries for files that are gone or no longer indexable.
    let removed = 0
    for (const document of documents.list()) {
      if (document.group !== 'workspace' || !document.sourcePath) continue
      const relativePath = relative(root, document.sourcePath).split(sep).join('/')
      if (!tracked[relativePath]) {
        documents.remove(document.id)
        removed += 1
      }
    }

    const lastScan = { added, updated, reused, removed, skipped }
    this.store.set({ root, indexedAt: Date.now(), files: Object.keys(tracked).length, skipped, tracked, lastScan })
    logger.info(
      `Project: indexed ${root} — ${added} added, ${updated} updated, ${reused} unchanged, ${removed} removed, ${skipped} skipped`
    )
    return this.status()
  }

  /** True when the given absolute path is inside the currently indexed project. */
  isInsideProject(absolutePath: string): boolean {
    const root = this.store.get().root
    if (!root) return false
    const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`
    return absolutePath.startsWith(normalizedRoot)
  }

  clear(): ProjectStatus {
    documents.clearGroup('workspace')
    this.store.set({ root: null, indexedAt: null, files: 0, skipped: 0, tracked: {}, lastScan: null })
    return this.status()
  }
}

export const project = new ProjectDomain()
