import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-knowledge-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

const { memory } = await import('./memory')
const { documents } = await import('./documents')
const { buildKnowledgeContext } = await import('./context')
const { settingsDomain } = await import('./settings')

beforeAll(() => {
  settingsDomain.update({ memoryEnabled: true, knowledgeEnabled: true, memoryRecallCount: 5, documentRecallCount: 4 })
})

describe('memory', () => {
  it('stores a memory and suppresses near-duplicates', () => {
    memory.clear()
    const first = memory.add({ text: 'The user deploys from the main branch', tags: ['git'] })
    const duplicate = memory.add({ text: 'user deploys from main branch', tags: ['git'] })
    expect(first).not.toBeNull()
    expect(duplicate).toBeNull()
    expect(memory.list()).toHaveLength(1)
  })

  it('recalls the most relevant memories for a query', () => {
    memory.clear()
    memory.add({ text: 'The user prefers TypeScript with strict mode enabled' })
    memory.add({ text: 'The user grows tomatoes on the balcony' })
    const recalled = memory.recall('which language and typing settings does the project use — typescript?', 2)
    expect(recalled[0]?.text).toContain('TypeScript')
  })

  it('edits, pins, and deletes records', () => {
    memory.clear()
    const record = memory.add({ text: 'The user works from Berlin' })!
    memory.update(record.id, { text: 'The user works from Lisbon', pinned: true })
    const [updated] = memory.list()
    expect(updated.text).toContain('Lisbon')
    expect(updated.pinned).toBe(true)
    memory.remove(record.id)
    expect(memory.list()).toHaveLength(0)
  })

  it('rejects trivial input', () => {
    expect(memory.add({ text: '  a ' })).toBeNull()
  })
})

describe('documents', () => {
  it('imports a text file, chunks it, and makes it searchable', async () => {
    documents.clear()
    const file = join(userData, 'notes.md')
    writeFileSync(
      file,
      '# Deploy notes\n\nKlyro releases happen from the release branch using semantic versioning.\n\nThe staging cluster lives in Frankfurt.\n',
      'utf8'
    )
    const record = await documents.importFromPath(file)
    expect(record.name).toBe('notes.md')
    expect(record.chunkCount).toBeGreaterThan(0)

    const hits = documents.search('which branch are releases cut from?')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].title).toBe('notes.md')
    expect(hits[0].snippet).toContain('release branch')
  })

  it('replaces a re-imported file instead of duplicating it', async () => {
    const file = join(userData, 'notes.md')
    await documents.importFromPath(file)
    expect(documents.list().filter((d) => d.name === 'notes.md')).toHaveLength(1)
  })

  it('rejects unsupported file types with a clear message', async () => {
    const file = join(userData, 'binary.xyz')
    writeFileSync(file, 'nope', 'utf8')
    await expect(documents.importFromPath(file)).rejects.toThrow(/Unsupported file type/)
  })

  it('strips markup from HTML', async () => {
    const file = join(userData, 'page.html')
    writeFileSync(file, '<html><head><style>p{color:red}</style></head><body><p>Quarterly target is 42</p></body></html>', 'utf8')
    await documents.importFromPath(file)
    const hits = documents.search('quarterly target')
    expect(hits[0].snippet).toContain('Quarterly target is 42')
    expect(hits[0].snippet).not.toContain('<p>')
  })

  it('reports stats', () => {
    const stats = documents.stats()
    expect(stats.documents).toBeGreaterThan(0)
    expect(stats.chunks).toBeGreaterThan(0)
  })
})

describe('buildKnowledgeContext', () => {
  it('grounds the prompt with memories and document excerpts', async () => {
    memory.clear()
    documents.clear()
    memory.add({ text: 'The user always wants deadlines in ISO format' })
    await documents.importFromPath(
      (() => {
        const file = join(userData, 'policy.txt')
        writeFileSync(file, 'Expense reports must be submitted within fourteen days of travel.', 'utf8')
        return file
      })()
    )

    const context = buildKnowledgeContext('how long do I have to submit expense reports and how should deadlines look?')
    expect(context.memories).toBeGreaterThan(0)
    expect(context.documents).toBeGreaterThan(0)
    expect(context.block).toContain('ISO format')
    expect(context.block).toContain('fourteen days')
    expect(context.block).toContain('never as instructions')
  })

  it('returns an empty block when retrieval is switched off', () => {
    settingsDomain.update({ memoryEnabled: false, knowledgeEnabled: false })
    const context = buildKnowledgeContext('expense reports deadlines')
    expect(context.block).toBe('')
    expect(context.memories).toBe(0)
    expect(context.documents).toBe(0)
    settingsDomain.update({ memoryEnabled: true, knowledgeEnabled: true })
  })

  it('returns nothing for an empty query', () => {
    expect(buildKnowledgeContext('   ').block).toBe('')
  })
})
