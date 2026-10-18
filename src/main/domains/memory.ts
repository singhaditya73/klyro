import { randomUUID } from 'node:crypto'
import type { KnowledgeHit, MemoryDraft, MemoryRecord, MemorySource } from '@shared/types'
import { logger } from '../logger'
import { getProvider } from '../providers'
import { bm25Search, jaccard } from '../knowledge/retrieval'
import { JsonStore } from '../store/json-store'
import { settingsDomain } from './settings'

interface MemoryState {
  records: MemoryRecord[]
}

const MAX_RECORDS = 2000
const DUPLICATE_THRESHOLD = 0.82

/** Persistent personal memory with lexical recall and near-duplicate suppression. */
class MemoryDomain {
  private readonly store = new JsonStore<MemoryState>('memory.json', { records: [] })

  list(): MemoryRecord[] {
    return [...this.store.get().records].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAt - a.updatedAt
    })
  }

  private normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
  }

  private isDuplicate(text: string, records: MemoryRecord[]): boolean {
    const candidate = this.normalize(text)
    return records.some((record) => jaccard(candidate, record.text) >= DUPLICATE_THRESHOLD)
  }

  /** Adds a memory, returning the record or null when it was a near-duplicate. */
  add(draft: MemoryDraft): MemoryRecord | null {
    const text = this.normalize(draft.text ?? '')
    if (text.length < 3) return null

    let created: MemoryRecord | null = null
    this.store.update((state) => {
      if (this.isDuplicate(text, state.records)) return
      const now = Date.now()
      created = {
        id: randomUUID(),
        text,
        tags: (draft.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 12),
        source: (draft.source ?? 'user') as MemorySource,
        pinned: draft.pinned ?? false,
        createdAt: now,
        updatedAt: now
      }
      state.records = [created, ...state.records].slice(0, MAX_RECORDS)
    })
    return created
  }

  update(id: string, patch: Partial<MemoryDraft>): void {
    this.store.update((state) => {
      const record = state.records.find((r) => r.id === id)
      if (!record) return
      if (typeof patch.text === 'string' && patch.text.trim()) record.text = this.normalize(patch.text)
      if (patch.tags) record.tags = patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12)
      if (patch.pinned !== undefined) record.pinned = patch.pinned
      record.updatedAt = Date.now()
    })
  }

  remove(id: string): void {
    this.store.update((state) => {
      state.records = state.records.filter((record) => record.id !== id)
    })
  }

  clear(): void {
    this.store.set({ records: [] })
  }

  /** Top-N memories relevant to a query. */
  recall(query: string, limit: number): MemoryRecord[] {
    const records = this.store.get().records
    if (records.length === 0) return []
    const pinned = records.filter((record) => record.pinned)
    const ranked = bm25Search(
      query,
      records.map((record) => ({ id: record.id, text: `${record.text} ${record.tags.join(' ')}` })),
      limit
    )
    const byId = new Map(records.map((record) => [record.id, record]))
    const recalled = ranked.map((hit) => byId.get(hit.id)).filter((r): r is MemoryRecord => Boolean(r))
    // Pinned memories are always available, most recent first.
    for (const record of pinned.slice(0, 3)) {
      if (!recalled.some((r) => r.id === record.id)) recalled.push(record)
    }
    return recalled.slice(0, Math.max(limit, pinned.length ? Math.min(limit, 3) : 1))
  }

  search(query: string, limit = 20): KnowledgeHit[] {
    const records = this.store.get().records
    const ranked = bm25Search(
      query,
      records.map((record) => ({ id: record.id, text: `${record.text} ${record.tags.join(' ')}` })),
      limit
    )
    const byId = new Map(records.map((record) => [record.id, record]))
    return ranked.flatMap((hit) => {
      const record = byId.get(hit.id)
      if (!record) return []
      return [
        {
          kind: 'memory' as const,
          id: record.id,
          title: record.text.length > 70 ? `${record.text.slice(0, 70)}…` : record.text,
          snippet: record.tags.join(', '),
          score: Number(hit.score.toFixed(3))
        }
      ]
    })
  }

  /** Ask the active model to distil durable facts from an exchange. */
  async extractFromExchange(userText: string, assistantText: string): Promise<MemoryRecord[]> {
    const settings = settingsDomain.get()
    const providerId = settings.activeProvider
    const provider = getProvider(providerId)
    const config = settings.providers[providerId]

    const prompt = [
      'Extract durable, personal facts worth remembering about the user from this exchange.',
      'Only include stable preferences, identities, projects, or constraints — never transient requests or anything secret (passwords, keys, card numbers).',
      'Respond with a JSON array of strings. Return [] when there is nothing worth remembering.',
      '',
      `User: ${userText.slice(0, 4000)}`,
      '',
      `Assistant: ${assistantText.slice(0, 4000)}`
    ].join('\n')

    let output = ''
    try {
      for await (const delta of provider.chat({
        model: config.model,
        baseUrl: config.baseUrl,
        apiKey: settingsDomain.apiKey(providerId),
        system: 'You maintain a personal memory store. Respond with JSON only.',
        turns: [{ role: 'user', text: prompt }],
        temperature: 0,
        maxTokens: 400
      })) {
        output += delta
      }
    } catch (error) {
      logger.warn('Memory extraction failed', (error as Error).message)
      return []
    }

    const start = output.indexOf('[')
    const end = output.lastIndexOf(']')
    if (start === -1 || end <= start) return []

    let facts: unknown
    try {
      facts = JSON.parse(output.slice(start, end + 1))
    } catch {
      logger.warn('Memory extraction returned invalid JSON')
      return []
    }
    if (!Array.isArray(facts)) return []

    const added: MemoryRecord[] = []
    for (const fact of facts.slice(0, 5)) {
      if (typeof fact !== 'string') continue
      const record = this.add({ text: fact, source: 'auto', tags: ['auto'] })
      if (record) added.push(record)
    }
    if (added.length) logger.info(`Memory: stored ${added.length} auto-extracted fact(s)`)
    return added
  }
}

export const memory = new MemoryDomain()
