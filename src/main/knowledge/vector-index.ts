/**
 * Local lexical vector search.
 *
 * This is a real TF-IDF vector-space model, not a neural embedding. Terms are
 * weighted by how often they occur in a chunk and how rare they are across the
 * corpus; character trigrams are included so morphology ("transcribed" /
 * "transcription") still matches. It is deliberately labelled *lexical*: a
 * paraphrase with no shared vocabulary will not match, and the retrieval
 * evaluation documents that limit instead of hiding it behind a semantic claim.
 *
 * The model is dependency-free and runs in well under a millisecond for the
 * small personal corpora Klyro retrieves from.
 */

import { Doc, ScoredDoc, tokenize } from './retrieval'

interface SparseVector {
  values: Map<string, number>
  norm: number
}

function features(text: string): string[] {
  const tokens = tokenize(text)
  const result: string[] = []
  for (const token of tokens) {
    result.push(`w:${token}`)
    // Character trigrams smooth over inflection and small typos. Short tokens
    // do not carry enough context to make trigrams useful.
    if (token.length >= 5) {
      const padded = `#${token}#`
      for (let index = 0; index + 3 <= padded.length; index += 1) {
        result.push(`c:${padded.slice(index, index + 3)}`)
      }
    }
  }
  return result
}

function termFrequencies(text: string): Map<string, number> {
  const frequencies = new Map<string, number>()
  for (const feature of features(text)) {
    frequencies.set(feature, (frequencies.get(feature) ?? 0) + 1)
  }
  return frequencies
}

/**
 * Builds the corpus statistics once per query. The corpora Klyro searches are
 * small (personal notes and document chunks), so rebuilding is cheaper than
 * keeping a mutable index in sync with every edit.
 */
function inverseDocumentFrequency(documents: Map<string, number>[], total: number): Map<string, number> {
  const documentFrequency = new Map<string, number>()
  for (const document of documents) {
    for (const feature of document.keys()) {
      documentFrequency.set(feature, (documentFrequency.get(feature) ?? 0) + 1)
    }
  }

  const idf = new Map<string, number>()
  for (const [feature, frequency] of documentFrequency) {
    // Smoothed IDF, the same form BM25 uses, so the two rankings agree on what
    // "rare" means.
    idf.set(feature, Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5)))
  }
  return idf
}

function toVector(frequencies: Map<string, number>, idf: Map<string, number>): SparseVector {
  const values = new Map<string, number>()
  let sumOfSquares = 0
  for (const [feature, count] of frequencies) {
    // Sublinear term frequency: the tenth mention of a word is not ten times
    // as informative as the first.
    const weight = (1 + Math.log(count)) * (idf.get(feature) ?? 0)
    if (weight <= 0) continue
    values.set(feature, weight)
    sumOfSquares += weight * weight
  }
  return { values, norm: Math.sqrt(sumOfSquares) }
}

function cosine(a: SparseVector, b: SparseVector): number {
  if (a.norm === 0 || b.norm === 0) return 0
  // Walk the smaller vector; most terms are absent from both sides.
  const [small, large] = a.values.size <= b.values.size ? [a, b] : [b, a]
  let dot = 0
  for (const [feature, weight] of small.values) {
    const other = large.values.get(feature)
    if (other !== undefined) dot += weight * other
  }
  return Math.max(0, dot / (a.norm * b.norm))
}

/**
 * Rank documents by TF-IDF cosine similarity. Scores below `minScore` are
 * dropped so a near-empty result set is not padded with unrelated chunks.
 */
export function vectorSearch(query: string, docs: Doc[], limit = 5, minScore = 0.05): ScoredDoc[] {
  if (docs.length === 0 || limit <= 0) return []
  const queryFrequencies = termFrequencies(query)
  if (queryFrequencies.size === 0) return []

  const documentFrequencies = docs.map((doc) => termFrequencies(doc.text))
  const idf = inverseDocumentFrequency(documentFrequencies, docs.length)
  const queryVector = toVector(queryFrequencies, idf)
  if (queryVector.norm === 0) return []

  const scored: ScoredDoc[] = []
  for (let index = 0; index < docs.length; index += 1) {
    const score = cosine(queryVector, toVector(documentFrequencies[index], idf))
    if (score > minScore) scored.push({ id: docs[index].id, score })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Exposed for tests and diagnostics: the number of features in a text. */
export function vectorFeatureCount(text: string): number {
  return termFrequencies(text).size
}
