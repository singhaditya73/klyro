import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

describe('incremental re-indexing', () => {
  it('only re-reads files that changed, and drops files that vanished', async () => {
    const root = mkdtempSync(join(tmpdir(), 'klyro-inc-'))
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'keep.ts'), 'export const keepAlive = 1\n', 'utf8')
    writeFileSync(join(root, 'src', 'edit.ts'), 'export const previousValue = 1\n', 'utf8')
    writeFileSync(join(root, 'src', 'gone.ts'), 'export const vanished = 1\n', 'utf8')

    const first = await project.indexPath(root)
    expect(first.files).toBe(3)
    expect(first.lastScan).toMatchObject({ added: 3, updated: 0, reused: 0, removed: 0 })

    // Change one file (and make sure its mtime moves), delete another.
    await new Promise((resolve) => setTimeout(resolve, 10))
    writeFileSync(join(root, 'src', 'edit.ts'), 'export const revisedValue = 2\n', 'utf8')
    rmSync(join(root, 'src', 'gone.ts'))

    const second = await project.indexPath(root)
    expect(second.lastScan).toMatchObject({ added: 0, updated: 1, reused: 1, removed: 1 })
    expect(second.files).toBe(2)

    const names = documents.list().map((document) => document.name)
    expect(names).toContain('src/keep.ts')
    expect(names).toContain('src/edit.ts')
    expect(names).not.toContain('src/gone.ts')

    // The edited file's new contents are searchable; the old text is gone.
    expect(documents.search('revisedValue').length).toBeGreaterThan(0)
    expect(documents.search('previousValue')).toHaveLength(0)
    expect(documents.search('vanished')).toHaveLength(0)
  })

  it('rebuilds from scratch when a different folder is indexed', async () => {
    const first = mkdtempSync(join(tmpdir(), 'klyro-inc-a-'))
    const second = mkdtempSync(join(tmpdir(), 'klyro-inc-b-'))
    writeFileSync(join(first, 'a.ts'), 'export const fromAlpha = 1\n', 'utf8')
    writeFileSync(join(second, 'b.ts'), 'export const fromBeta = 2\n', 'utf8')

    await project.indexPath(first)
    const status = await project.indexPath(second)

    expect(status.root).toBe(second)
    expect(status.lastScan).toMatchObject({ added: 1, reused: 0 })
    const names = documents.list().map((document) => document.name)
    expect(names).toContain('b.ts')
    expect(names).not.toContain('a.ts')
  })
})
