import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-patches-'))
const workspace = mkdtempSync(join(tmpdir(), 'klyro-ws-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

const { patches } = await import('./patches')
const { project } = await import('./project')
const { documents } = await import('./documents')

function write(relativePath: string, content: string): string {
  const absolute = join(workspace, relativePath)
  mkdirSync(join(absolute, '..'), { recursive: true })
  writeFileSync(absolute, content, 'utf8')
  return absolute
}

describe('reviewable file edits', () => {
  beforeEach(async () => {
    write('src/app.ts', 'export const answer = 1\n')
    await project.indexPath(workspace)
    patches.clear()
  })

  it('proposes a diff without touching the file', async () => {
    const patch = await patches.propose({ path: 'src/app.ts', content: 'export const answer = 2\n' })

    expect(patch.status).toBe('pending')
    expect(patch.diff).toContain('-export const answer = 1')
    expect(patch.diff).toContain('+export const answer = 2')
    expect(patch.addedLines).toBe(1)
    expect(patch.removedLines).toBe(1)
    expect(readFileSync(join(workspace, 'src/app.ts'), 'utf8')).toBe('export const answer = 1\n')
  })

  it('applies an approved patch and keeps a backup', async () => {
    const patch = await patches.propose({ path: 'src/app.ts', content: 'export const answer = 2\n' })
    const applied = await patches.apply(patch.id)

    expect(applied.status).toBe('applied')
    expect(readFileSync(join(workspace, 'src/app.ts'), 'utf8')).toBe('export const answer = 2\n')
    expect(applied.backupPath).toBeTruthy()
    expect(readFileSync(applied.backupPath as string, 'utf8')).toBe('export const answer = 1\n')

    // The index reflects the new contents straight away.
    const hits = documents.search('answer = 2')
    expect(hits.length).toBeGreaterThan(0)
  })

  it('reverts an applied patch', async () => {
    const patch = await patches.propose({ path: 'src/app.ts', content: 'export const answer = 2\n' })
    await patches.apply(patch.id)
    const reverted = await patches.revert(patch.id)

    expect(reverted.status).toBe('reverted')
    expect(readFileSync(join(workspace, 'src/app.ts'), 'utf8')).toBe('export const answer = 1\n')
  })

  it('removes a file again when reverting a creation', async () => {
    const patch = await patches.propose({ path: 'src/new-file.ts', content: 'export const fresh = true\n' })
    expect(patch.createdFile).toBe(true)

    await patches.apply(patch.id)
    expect(readFileSync(join(workspace, 'src/new-file.ts'), 'utf8')).toContain('fresh')

    await patches.revert(patch.id)
    expect(() => statSync(join(workspace, 'src/new-file.ts'))).toThrow()
  })

  it('refuses to apply a diff when the file changed underneath it', async () => {
    const patch = await patches.propose({ path: 'src/app.ts', content: 'export const answer = 2\n' })
    write('src/app.ts', 'export const answer = 99 // edited elsewhere\n')

    await expect(patches.apply(patch.id)).rejects.toThrow(/changed since this diff/)
  })

  it('never edits files outside the indexed project', async () => {
    await expect(patches.propose({ path: '../../etc/hosts', content: 'nope' })).rejects.toThrow(/outside the indexed project/)
  })

  it('never edits credential files', async () => {
    write('.env', 'API_KEY=super-secret\n')
    await expect(patches.propose({ path: '.env', content: 'API_KEY=other\n' })).rejects.toThrow(/credentials/)
  })

  it('rejects an edit that changes nothing', async () => {
    await expect(patches.propose({ path: 'src/app.ts', content: 'export const answer = 1\n' })).rejects.toThrow(
      /identical/
    )
  })

  it('discards a pending proposal and refuses to discard an applied one', async () => {
    const pending = await patches.propose({ path: 'src/app.ts', content: 'export const answer = 3\n' })
    expect(patches.discard(pending.id).some((patch) => patch.id === pending.id)).toBe(false)

    const applied = await patches.propose({ path: 'src/app.ts', content: 'export const answer = 4\n' })
    await patches.apply(applied.id)
    expect(() => patches.discard(applied.id)).toThrow(/Revert this patch/)
  })
})
