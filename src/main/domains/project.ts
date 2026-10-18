import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { dialog } from 'electron'
import type { ProjectStatus } from '@shared/types'
import { isIndexableFile, shouldSkipDirectory } from '../knowledge/code-files'
import { logger } from '../logger'
import { JsonStore } from '../store/json-store'
import { documents } from './documents'

interface ProjectState {
  root: string | null
  indexedAt: number | null
  files: number
  skipped: number
}

const MAX_FILES = 1500
const MAX_DEPTH = 12

/** Indexes a code workspace into the shared document store under the `workspace` group. */
class ProjectDomain {
  private readonly store = new JsonStore<ProjectState>('project.json', {
    root: null,
    indexedAt: null,
    files: 0,
    skipped: 0
  })

  status(): ProjectStatus {
    const state = this.store.get()
    const stats = documents.statsFor('workspace')
    return {
      root: state.root,
      files: stats.files,
      chunks: stats.chunks,
      indexedAt: state.indexedAt,
      skipped: state.skipped
    }
  }

  private async walk(
    root: string,
    directory: string,
    depth: number,
    collector: string[]
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
        if (isIndexableFile(relativePath, info.size)) collector.push(absolute)
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

  async indexPath(root: string): Promise<ProjectStatus> {
    const files: string[] = []
    await this.walk(root, root, 0, files)

    documents.clearGroup('workspace')
    let imported = 0
    let skipped = 0
    for (const file of files) {
      const relativePath = relative(root, file).split(sep).join('/')
      try {
        await documents.importFromPath(file, 'workspace', relativePath)
        imported += 1
      } catch {
        skipped += 1
      }
    }

    const next = this.store.set({ root, indexedAt: Date.now(), files: imported, skipped })
    logger.info(`Project: indexed ${imported} file(s) from ${root} (${skipped} skipped)`)
    return {
      root: next.root,
      files: this.status().files,
      chunks: this.status().chunks,
      indexedAt: next.indexedAt,
      skipped: next.skipped
    }
  }

  clear(): ProjectStatus {
    documents.clearGroup('workspace')
    this.store.set({ root: null, indexedAt: null, files: 0, skipped: 0 })
    return this.status()
  }
}

export const project = new ProjectDomain()
