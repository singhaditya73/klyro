import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { dialog } from 'electron'
import type { DocumentRecord, ImportResult, KnowledgeHit } from '@shared/types'
import { logger } from '../logger'
import { bm25Search, chunkDocument } from '../knowledge/retrieval'
import { JsonStore } from '../store/json-store'

/** A chunk plus where it came from, so citations can point at real locations. */
interface StoredChunk {
  text: string
  start: number
  end: number
  /** 1-based line number of the chunk start, or 0 when it cannot be derived. */
  line: number
  /** 1-based line number of the chunk end, or 0 when it cannot be derived. */
  endLine: number
}

interface StoredDocument {
  id: string
  name: string
  kind: string
  group: 'manual' | 'workspace'
  sourcePath: string | null
  size: number
  addedAt: number
  chunks: StoredChunk[]
}

interface DocumentState {
  documents: StoredDocument[]
  totalChars: number
}

export interface RecalledChunk {
  name: string
  text: string
  line: number
  endLine: number
  path: string | null
}

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_CHARS = 4_000_000
const CHUNK_CHARS = 1200

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'mdx', 'rst', 'log', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'yaml', 'yml',
  'toml', 'ini', 'cfg', 'conf', 'env', 'xml', 'css', 'scss', 'less', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'swift', 'sh',
  'bash', 'zsh', 'fish', 'ps1', 'bat', 'sql', 'graphql', 'gql', 'vue', 'svelte', 'html', 'htm', 'ipynb',
  'srt', 'vtt', 'tex', 'org', 'adoc'
])

function stripMarkup(input: string): string {
  return input
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Older stores saved chunks as bare strings. Normalise them on read so the
 * on-disk format can change without losing a user's library.
 */
function toChunk(raw: unknown, index: number): StoredChunk {
  if (typeof raw === 'string') return { text: raw, start: 0, end: raw.length, line: 0, endLine: 0 }
  if (!raw || typeof raw !== 'object') return { text: '', start: 0, end: 0, line: 0, endLine: 0 }
  const record = raw as Partial<StoredChunk>
  const line = Number.isFinite(record.line) ? Number(record.line) : index === 0 ? 1 : 0
  return {
    text: typeof record.text === 'string' ? record.text : '',
    start: Number.isFinite(record.start) ? Number(record.start) : 0,
    end: Number.isFinite(record.end) ? Number(record.end) : 0,
    line,
    endLine: Number.isFinite(record.endLine) ? Number(record.endLine) : line
  }
}

function runCommand(binary: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf8')
    })
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
  })
}

async function commandExists(binary: string): Promise<boolean> {
  try {
    const result = await runCommand('sh', ['-c', `command -v ${binary}`])
    return result.code === 0
  } catch {
    return false
  }
}

class DocumentDomain {
  private readonly store = new JsonStore<DocumentState>('documents.json', { documents: [], totalChars: 0 })
  private tools: { pdftotext?: boolean; unzip?: boolean } = {}

  private async has(tool: 'pdftotext' | 'unzip'): Promise<boolean> {
    if (this.tools[tool] === undefined) this.tools[tool] = await commandExists(tool)
    return this.tools[tool]
  }

  /** Documents with chunks normalised to the current shape. */
  private normalized(): StoredDocument[] {
    return this.store.get().documents.map((document) => ({
      ...document,
      chunks: (document.chunks ?? []).map(toChunk).filter((chunk) => chunk.text.length > 0)
    }))
  }

  list(): DocumentRecord[] {
    return this.normalized()
      .map(({ chunks, ...rest }) => ({
        ...rest,
        chunkCount: chunks.length,
        excerpt: chunks[0]?.text.slice(0, 180) ?? ''
      }))
      .sort((a, b) => b.addedAt - a.addedAt)
  }

  private async extract(filePath: string): Promise<{ text: string; kind: string }> {
    const extension = extname(filePath).replace('.', '').toLowerCase()
    const info = await stat(filePath)
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(`File is larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB`)
    }

    if (extension === 'pdf') {
      if (!(await this.has('pdftotext'))) {
        throw new Error('PDF import needs poppler-utils (pdftotext) on PATH')
      }
      const result = await runCommand('pdftotext', ['-layout', '-nopgbrk', filePath, '-'])
      if (result.code !== 0 || !result.stdout.trim()) {
        throw new Error(result.stderr.trim() || 'pdftotext could not extract any text')
      }
      return { text: result.stdout, kind: 'pdf' }
    }

    if (['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'].includes(extension)) {
      if (!(await this.has('unzip'))) {
        throw new Error('Office document import needs unzip on PATH')
      }
      const listing = await runCommand('unzip', ['-Z1', filePath])
      if (listing.code !== 0) throw new Error(listing.stderr.trim() || 'Failed to read the archive')
      const entries = listing.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((entry) => entry.endsWith('.xml'))
        .filter((entry) => /(document|header\d*|footer\d*|slide\d*|sharedStrings|content)\.xml$/.test(entry))
        .slice(0, 300)
      let text = ''
      for (const entry of entries) {
        const part = await runCommand('unzip', ['-p', filePath, entry])
        if (part.code === 0) text += `${stripMarkup(part.stdout)}\n\n`
      }
      if (!text.trim()) throw new Error('No readable text found in this document')
      return { text, kind: extension }
    }

    if (!TEXT_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported file type ".${extension || 'unknown'}"`)
    }

    const raw = await readFile(filePath, 'utf8')
    const text = extension === 'html' || extension === 'htm' || extension === 'xml' ? stripMarkup(raw) : raw
    return { text, kind: extension }
  }

  private toRecord(document: StoredDocument): DocumentRecord {
    const { chunks, ...rest } = document
    return { ...rest, chunkCount: chunks.length, excerpt: chunks[0]?.text.slice(0, 180) ?? '' }
  }

  async importFromPath(filePath: string, group: 'manual' | 'workspace' = 'manual', nameOverride?: string): Promise<DocumentRecord> {
    const name = nameOverride ?? basename(filePath)
    const { text, kind } = await this.extract(filePath)
    const chunks = chunkDocument(text, CHUNK_CHARS)
    if (chunks.length === 0) throw new Error('No readable text found')

    const state = this.store.get()
    if (state.totalChars + text.length > MAX_TOTAL_CHARS) {
      throw new Error('Local knowledge store is full — remove some documents first')
    }

    const document: StoredDocument = {
      id: randomUUID(),
      name,
      kind,
      group,
      sourcePath: filePath,
      size: text.length,
      addedAt: Date.now(),
      chunks
    }

    this.store.update((draft) => {
      draft.documents = [document, ...draft.documents.filter((d) => d.sourcePath !== filePath)]
      draft.totalChars = draft.documents.reduce((sum, d) => sum + d.size, 0)
    })

    logger.info(`Knowledge: imported ${name} (${chunks.length} chunk(s))`)
    return this.toRecord(document)
  }

  async importFromDialog(): Promise<ImportResult> {
    const result = await dialog.showOpenDialog({
      title: 'Add documents to Klyro',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents & text', extensions: [...TEXT_EXTENSIONS, 'pdf', 'docx', 'pptx', 'xlsx'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return { imported: [], skipped: [] }

    const imported: DocumentRecord[] = []
    const skipped: { name: string; reason: string }[] = []
    for (const filePath of result.filePaths) {
      try {
        imported.push(await this.importFromPath(filePath))
      } catch (error) {
        skipped.push({ name: basename(filePath), reason: (error as Error).message })
      }
    }
    return { imported, skipped }
  }

  importText(name: string, text: string, sourcePath: string | null = null, group: 'manual' | 'workspace' = 'manual'): DocumentRecord {
    const chunks = chunkDocument(text, CHUNK_CHARS)
    const document: StoredDocument = {
      id: randomUUID(),
      name,
      kind: 'text',
      group,
      sourcePath,
      size: text.length,
      addedAt: Date.now(),
      chunks
    }
    this.store.update((draft) => {
      draft.documents = [document, ...draft.documents]
      draft.totalChars = draft.documents.reduce((sum, d) => sum + d.size, 0)
    })
    return this.toRecord(document)
  }

  remove(id: string): void {
    this.store.update((draft) => {
      draft.documents = draft.documents.filter((document) => document.id !== id)
      draft.totalChars = draft.documents.reduce((sum, d) => sum + d.size, 0)
    })
  }

  clearGroup(group: 'manual' | 'workspace'): void {
    this.store.update((draft) => {
      draft.documents = draft.documents.filter((document) => document.group !== group)
      draft.totalChars = draft.documents.reduce((sum, d) => sum + d.size, 0)
    })
  }

  statsFor(group: 'manual' | 'workspace'): { files: number; chunks: number } {
    const matched = this.normalized().filter((document) => document.group === group)
    return {
      files: matched.length,
      chunks: matched.reduce((sum, document) => sum + document.chunks.length, 0)
    }
  }

  clear(): void {
    this.store.set({ documents: [], totalChars: 0 })
  }

  search(query: string, limit = 20): KnowledgeHit[] {
    const corpus = this.normalized().flatMap((document) =>
      document.chunks.map((chunk, index) => ({
        id: `${document.id}:${index}`,
        text: chunk.text,
        name: document.name,
        line: chunk.line,
        endLine: chunk.endLine,
        path: document.sourcePath
      }))
    )
    const byId = new Map(corpus.map((entry) => [entry.id, entry]))
    return bm25Search(
      query,
      corpus.map((entry) => ({ id: entry.id, text: entry.text })),
      limit
    ).flatMap((hit) => {
      const entry = byId.get(hit.id)
      if (!entry) return []
      return [
        {
          kind: 'document' as const,
          id: hit.id,
          title: entry.name,
          snippet: entry.text.slice(0, 200),
          score: Number(hit.score.toFixed(3)),
          line: entry.line,
          endLine: entry.endLine,
          path: entry.path ?? undefined
        }
      ]
    })
  }

  /** Chunks most relevant to a query, with their source location, for grounding. */
  recall(query: string, limit: number, group?: 'manual' | 'workspace'): RecalledChunk[] {
    const corpus = this.normalized()
      .filter((document) => !group || document.group === group)
      .flatMap((document) =>
        document.chunks.map((chunk, index) => ({
          id: `${document.id}:${index}`,
          text: chunk.text,
          name: document.name,
          line: chunk.line,
          endLine: chunk.endLine,
          path: document.sourcePath
        }))
      )
    const byId = new Map(corpus.map((entry) => [entry.id, entry]))
    return bm25Search(
      query,
      corpus.map((entry) => ({ id: entry.id, text: entry.text })),
      limit
    ).flatMap((hit) => {
      const entry = byId.get(hit.id)
      return entry
        ? [{ name: entry.name, text: entry.text, line: entry.line, endLine: entry.endLine, path: entry.path }]
        : []
    })
  }

  stats(): { documents: number; chunks: number; chars: number } {
    const state = this.store.get()
    const documents = this.normalized()
    return {
      documents: state.documents.length,
      chunks: documents.reduce((sum, document) => sum + document.chunks.length, 0),
      chars: state.totalChars
    }
  }
}

export const documents = new DocumentDomain()
