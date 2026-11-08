/**
 * Local, dependency-free retrieval primitives: tokenisation, paragraph-aware
 * chunking, BM25 ranking, and Jaccard similarity for de-duplication.
 * Pure functions — no Electron/Node imports — so they are unit-testable.
 */

import { vectorSearch } from './vector-index'

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'doing',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'as', 'into', 'from', 'up', 'down',
  'it', 'its', 'i', 'you', 'he', 'she', 'we', 'they', 'them', 'his', 'her', 'our', 'their',
  'my', 'your', 'me', 'us', 'not', 'no', 'so', 'can', 'could', 'should', 'would', 'will',
  'just', 'also', 'there', 'here', 'what', 'which', 'who', 'when', 'where', 'how', 'why',
  'user', 'users', 'please', 'want', 'wants', 'need', 'needs', 'like', 'likes'
])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
}

function unique(tokens: string[]): string[] {
  return [...new Set(tokens)]
}

export interface Doc {
  id: string
  text: string
}

export interface ScoredDoc {
  id: string
  score: number
}

/**
 * Okapi BM25 ranking over an in-memory corpus. The corpus is small (personal
 * notes, document chunks) so re-indexing per query is cheap and keeps the
 * implementation stateless.
 */
export function bm25Search(query: string, docs: Doc[], limit = 5): ScoredDoc[] {
  const queryTerms = unique(tokenize(query))
  if (queryTerms.length === 0 || docs.length === 0 || limit <= 0) return []

  const docTokens = docs.map((doc) => tokenize(doc.text))
  const docLengths = docTokens.map((tokens) => tokens.length)
  const averageLength = docLengths.reduce((sum, length) => sum + length, 0) / docLengths.length || 1

  const documentFrequency = new Map<string, number>()
  const postingList = new Map<string, number[]>()

  for (let index = 0; index < docTokens.length; index++) {
    const tokens = docTokens[index]
    for (const term of unique(tokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
      let postings = postingList.get(term)
      if (!postings) {
        postings = []
        postingList.set(term, postings)
      }
      postings.push(index)
    }
  }

  // Pre-filter candidate documents that contain at least one query term
  const candidateIndices = new Set<number>()
  for (const term of queryTerms) {
    const postings = postingList.get(term)
    if (postings) {
      for (const idx of postings) candidateIndices.add(idx)
    }
  }

  if (candidateIndices.size === 0) return []

  const k1 = 1.5
  const b = 0.75
  const total = docs.length
  const scored: ScoredDoc[] = []

  for (const index of candidateIndices) {
    const tokens = docTokens[index]
    const termFrequency = new Map<string, number>()
    for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1)

    let score = 0
    for (const term of queryTerms) {
      const frequency = termFrequency.get(term)
      if (!frequency) continue
      const df = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5))
      const denominator = frequency + k1 * (1 - b + (b * docLengths[index]) / averageLength)
      score += idf * ((frequency * (k1 + 1)) / denominator)
    }
    if (score > 0) scored.push({ id: docs[index].id, score })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Split text on paragraph/sentence boundaries into overlapping chunks. */
export function chunkText(text: string, maxChars = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!clean) return []
  if (clean.length <= maxChars) return [clean]

  const chunks: string[] = []
  let current = ''

  for (const paragraph of clean.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length <= maxChars) {
      current = candidate
      continue
    }
    if (current) {
      chunks.push(current.trim())
      current = ''
    }
    if (paragraph.length <= maxChars) {
      current = paragraph
      continue
    }

    let rest = paragraph
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf('. ', maxChars)
      if (cut < maxChars * 0.5) cut = rest.lastIndexOf(' ', maxChars)
      if (cut <= 0) cut = maxChars
      chunks.push(rest.slice(0, cut + 1).trim())
      rest = rest.slice(Math.max(0, cut + 1 - overlap))
    }
    current = rest
  }

  if (current.trim()) chunks.push(current.trim())
  return chunks.filter((chunk) => chunk.length > 0)
}

/** Token-set similarity in [0, 1]; used to avoid storing near-duplicate memories. */
export function jaccard(a: string, b: string): number {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const token of setA) if (setB.has(token)) intersection += 1
  return intersection / (setA.size + setB.size - intersection)
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n')
}

export interface Chunk {
  text: string
  /** Character offset of the chunk's start within the normalised source text. */
  start: number
  end: number
  /** 1-based line number of the chunk start (0 when unknown). */
  line: number
  /** 1-based line number of the chunk end (0 when unknown). */
  endLine: number
}

/**
 * Chunk a document and report where each chunk came from. Offsets and line
 * numbers are derived from the source text, so citations point at real
 * locations rather than being invented.
 */
export function chunkDocument(text: string, maxChars = 1200, overlap = 150): Chunk[] {
  const clean = normalizeText(text).trim()
  if (!clean) return []
  const pieces = chunkText(clean, maxChars, overlap)

  const chunks: Chunk[] = []
  let cursor = 0
  let scanned = 0
  let lineCount = 1

  for (const piece of pieces) {
    let start = clean.indexOf(piece, cursor)
    if (start < 0) start = clean.indexOf(piece)
    if (start < 0) start = cursor
    // Count newlines between the previous scan position and this chunk start.
    for (let index = scanned; index < start; index++) {
      if (clean.charCodeAt(index) === 10) lineCount += 1
    }
    scanned = Math.max(scanned, start)
    const end = start + piece.length
    let endLine = lineCount
    for (let index = start; index < end; index++) {
      if (clean.charCodeAt(index) === 10) endLine += 1
    }
    chunks.push({ text: piece, start, end, line: lineCount, endLine })
    cursor = Math.max(cursor, end)
  }
  return chunks
}

/** Reciprocal rank of the first relevant document, or 0 when none is found. */
export function reciprocalRank(rankedIds: string[], relevant: string[]): number {
  const wanted = new Set(relevant)
  const index = rankedIds.findIndex((id) => wanted.has(id))
  return index < 0 ? 0 : 1 / (index + 1)
}

/**
 * Hybrid Reciprocal Rank Fusion (RRF) combining lexical BM25 and TF-IDF vector
 * search, followed by a cross-matching reranker.
 */
export function hybridSearch(query: string, docs: Doc[], limit = 5, bm25Weight = 0.5): ScoredDoc[] {
  if (!query.trim() || docs.length === 0 || limit <= 0) return []

  const bm25Hits = bm25Search(query, docs, docs.length)
  const vectorHits = vectorSearch(query, docs, docs.length)

  const docMap = new Map<string, Doc>(docs.map((d) => [d.id, d]))
  const scores = new Map<string, number>()

  const RRF_K = 60
  // Reciprocal Rank Fusion
  bm25Hits.forEach((hit, rank) => {
    const contribution = bm25Weight / (RRF_K + rank + 1)
    scores.set(hit.id, (scores.get(hit.id) ?? 0) + contribution)
  })

  const vectorWeight = 1 - bm25Weight
  vectorHits.forEach((hit, rank) => {
    const contribution = vectorWeight / (RRF_K + rank + 1)
    scores.set(hit.id, (scores.get(hit.id) ?? 0) + contribution)
  })

  // Cross-attentive Reranker: boosts exact bi-grams and phrase containment
  const queryTokens = tokenize(query)
  const queryBigrams: string[] = []
  for (let i = 0; i < queryTokens.length - 1; i++) {
    queryBigrams.push(`${queryTokens[i]} ${queryTokens[i + 1]}`)
  }

  const reranked: ScoredDoc[] = []
  for (const [id, rrfScore] of scores.entries()) {
    const doc = docMap.get(id)
    if (!doc) continue

    let rerankScore = rrfScore
    const docLower = doc.text.toLowerCase()

    // Bigram phrase matching boost
    for (const bigram of queryBigrams) {
      if (docLower.includes(bigram)) {
        rerankScore += 0.008
      }
    }

    // Exact query string containment boost
    if (query.length > 5 && docLower.includes(query.toLowerCase())) {
      rerankScore += 0.015
    }

    reranked.push({ id, score: rerankScore })
  }

  return reranked.sort((a, b) => b.score - a.score).slice(0, limit)
}


