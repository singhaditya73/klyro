import { bm25Search, reciprocalRank, type Doc } from './retrieval'

/**
 * A small retrieval evaluation harness.
 *
 * The goal is to make retrieval quality measurable rather than a matter of
 * opinion: a fixture corpus plus labelled queries yields recall@k, MRR, average
 * injected context size, and latency. The numbers are asserted in tests so a
 * change that hurts retrieval fails CI instead of shipping quietly.
 */

export interface EvalCase {
  id: string
  query: string
  /** Document ids that a correct retrieval should surface. */
  relevant: string[]
}

export interface EvalReport {
  cases: number
  k: number
  /** Fraction of queries with at least one relevant document in the top k. */
  recallAtK: number
  /** Mean reciprocal rank of the first relevant document. */
  mrr: number
  /** Average number of characters of context injected per query. */
  avgContextChars: number
  /** Average time to rank the whole corpus for one query. */
  latencyMsPerQuery: number
}

export function evaluateRetrieval(corpus: Doc[], cases: EvalCase[], k = 5): EvalReport {
  if (cases.length === 0) {
    return { cases: 0, k, recallAtK: 0, mrr: 0, avgContextChars: 0, latencyMsPerQuery: 0 }
  }
  const textById = new Map(corpus.map((doc) => [doc.id, doc.text]))
  let hits = 0
  let reciprocalSum = 0
  let contextChars = 0

  const started = performance.now()
  for (const testCase of cases) {
    const ranked = bm25Search(testCase.query, corpus, k)
    const ids = ranked.map((hit) => hit.id)
    if (ids.some((id) => testCase.relevant.includes(id))) hits += 1
    reciprocalSum += reciprocalRank(ids, testCase.relevant)
    contextChars += ids.reduce((sum, id) => sum + (textById.get(id)?.length ?? 0), 0)
  }
  const elapsed = performance.now() - started

  return {
    cases: cases.length,
    k,
    recallAtK: hits / cases.length,
    mrr: reciprocalSum / cases.length,
    avgContextChars: contextChars / cases.length,
    latencyMsPerQuery: elapsed / cases.length
  }
}
