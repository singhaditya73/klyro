import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-project-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

const { project } = await import('./project')
const { documents } = await import('./documents')

describe('project workspace indexing', () => {
  it('indexes the real repository and makes the code searchable', async () => {
    const root = process.cwd()
    const status = await project.indexPath(root)

    expect(status.root).toBe(root)
    expect(status.files).toBeGreaterThan(10)
    expect(status.chunks).toBeGreaterThan(10)

    const names = documents.list().map((document) => document.name)
    expect(names).toContain('src/main/knowledge/retrieval.ts')
    // Dependency and build directories must never be indexed.
    expect(names.some((name) => name.includes('node_modules'))).toBe(false)
    expect(names.some((name) => name.includes('out/'))).toBe(false)

    const hits = documents.search('BM25 ranking over an in-memory corpus')
    expect(hits[0]?.title).toBe('src/main/knowledge/retrieval.ts')
  })

  it('reports workspace stats separately from manual documents', async () => {
    documents.importText('scratch.md', '# my own note\n\nSomething personal about tomatoes.', null, 'manual')
    const stats = documents.statsFor('workspace')
    expect(stats.files).toBeGreaterThan(10)
    expect(documents.list().filter((d) => d.group === 'manual')).toHaveLength(1)
  })

  it('clears only the workspace group', async () => {
    project.clear()
    const names = documents.list().map((document) => document.name)
    expect(names).toContain('scratch.md')
    expect(names.some((name) => name.endsWith('.ts'))).toBe(false)
    expect(project.status().root).toBeNull()
  })
})
