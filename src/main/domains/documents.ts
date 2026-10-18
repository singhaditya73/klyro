import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { dialog } from 'electron'
import type { DocumentRecord, ImportResult, KnowledgeHit } from '@shared/types'
import { logger } from '../logger'
import { bm25Search, chunkText } from '../knowledge/retrieval'
import { JsonStore } from '../store/json-store'

interface StoredDocument {
  id: string
  name: string
  kind: string
  sourcePath: string | null
  size: number
  addedAt: number
  chunks: string[]
}

interface DocumentState {
  documents: StoredDocument[]
  totalChars: number
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

  list(): DocumentRecord[] {
    return this.store
      .get()
      .documents.map(({ chunks, ...rest }) => ({
        ...rest,
        chunkCount: chunks.length,
        excerpt: chunks[0]?.slice(0, 180) ?? ''
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

  async importFromPath(filePath: string): Promise<DocumentRecord> {
    const name = basename(filePath)
    const { text, kind } = await this.extract(filePath)
    const chunks = chunkText(text, CHUNK_CHARS)
    if (chunks.length === 0) throw new Error('No readable text found')

    const state = this.store.get()
    if (state.totalChars + text.length > MAX_TOTAL_CHARS) {
      throw new Error('Local knowledge store is full — remove some documents first')
    }

    const document: StoredDocument = {
      id: randomUUID(),
      name,
      kind,
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
    return { ...document, chunkCount: chunks.length, excerpt: chunks[0]?.slice(0, 180) ?? '' }
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

  importText(name: string, text: string, sourcePath: string | null = null): DocumentRecord {
    const chunks = chunkText(text, CHUNK_CHARS)
    const document: StoredDocument = {
      id: randomUUID(),
      name,
      kind: 'text',
      sourcePath,
      size: text.length,
      addedAt: Date.now(),
      chunks
    }
    this.store.update((draft) => {
      draft.documents = [document, ...draft.documents]
      draft.totalChars = draft.documents.reduce((sum, d) => sum + d.size, 0)
    })
    return { ...document, chunkCount: chunks.length, excerpt: chunks[0]?.slice(0, 180) ?? '' }
  }

  remove(id: string): void {
    this.store.update((draft) => {
      draft.documents = draft.documents.filter((document) => document.id !== id)
      draft.totalChars = draft.documents.reduce((sum, d) => sum + d.size, 0)
    })
  }

  clear(): void {
    this.store.set({ documents: [], totalChars: 0 })
  }

  search(query: string, limit = 20): KnowledgeHit[] {
    const corpus = this.store.get().documents.flatMap((document) =>
      document.chunks.map((text, index) => ({ id: `${document.id}:${index}`, text, name: document.name }))
    )
    const names = new Map(corpus.map((entry) => [entry.id, entry.name]))
    return bm25Search(query, corpus, limit).map((hit) => ({
      kind: 'document' as const,
      id: hit.id,
      title: names.get(hit.id) ?? 'Document',
      snippet: corpus.find((entry) => entry.id === hit.id)?.text.slice(0, 200) ?? '',
      score: Number(hit.score.toFixed(3))
    }))
  }

  /** Chunks most relevant to a query, for grounding a chat turn. */
  recall(query: string, limit: number): { name: string; text: string }[] {
    const corpus = this.store.get().documents.flatMap((document) =>
      document.chunks.map((text, index) => ({ id: `${document.id}:${index}`, text, name: document.name }))
    )
    const byId = new Map(corpus.map((entry) => [entry.id, entry]))
    return bm25Search(query, corpus, limit).flatMap((hit) => {
      const entry = byId.get(hit.id)
      return entry ? [{ name: entry.name, text: entry.text }] : []
    })
  }

  stats(): { documents: number; chunks: number; chars: number } {
    const state = this.store.get()
    return {
      documents: state.documents.length,
      chunks: state.documents.reduce((sum, d) => sum + d.chunks.length, 0),
      chars: state.totalChars
    }
  }
}

export const documents = new DocumentDomain()
