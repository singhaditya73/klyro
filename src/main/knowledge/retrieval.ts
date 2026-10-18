/**
 * Local, dependency-free retrieval primitives: tokenisation, paragraph-aware
 * chunking, BM25 ranking, and Jaccard similarity for de-duplication.
 * Pure functions — no Electron/Node imports — so they are unit-testable.
 */

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
  for (const tokens of docTokens) {
    for (const term of unique(tokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
    }
  }

  const k1 = 1.5
  const b = 0.75
  const total = docs.length
  const scored: ScoredDoc[] = []

  docTokens.forEach((tokens, index) => {
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
  })

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
