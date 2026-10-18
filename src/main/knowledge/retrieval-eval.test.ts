import { describe, expect, it } from 'vitest'
import { evaluateRetrieval, type EvalCase } from './eval'
import { chunkDocument, reciprocalRank, type Doc } from './retrieval'

/**
 * Retrieval evaluation fixtures.
 *
 * The corpus is deliberately small and deterministic. Two families of queries
 * are measured: keyword-style queries (which lexical BM25 should handle) and
 * paraphrases (which it provably does not). Keeping the paraphrase family in the
 * suite is what lets us say "we evaluated embeddings" instead of guessing.
 */
const corpus: Doc[] = [
  { id: 'keys', text: 'API keys are encrypted at rest using the operating system keychain or DPAPI.' },
  { id: 'agent', text: 'The desktop agent moves the mouse, clicks buttons, and types text one step at a time.' },
  { id: 'memory', text: 'Personal facts are kept in a local notebook on this device.' },
  { id: 'workflow', text: 'A workflow chains steps such as fetching GitHub issues and drafting a standup summary.' },
  { id: 'meetings', text: 'Recorded meetings are transcribed in fifteen second chunks and summarised into action items.' },
  { id: 'providers', text: 'OpenAI, Anthropic, Gemini, and Ollama providers stream responses token by token.' },
  { id: 'knowledge', text: 'Imported PDF, Word, and Markdown documents are split into overlapping chunks for search.' },
  { id: 'privacy', text: 'Screenshots are captured on demand and are never written to disk.' },
  { id: 'shortcuts', text: 'Press Ctrl+Shift+Space to toggle the quick ask overlay above other windows.' },
  { id: 'updates', text: 'Release builds are published as AppImage, deb, and Windows installer artifacts.' }
]

const lexicalCases: EvalCase[] = [
  { id: 'q-keys', query: 'how are api keys encrypted keychain', relevant: ['keys'] },
  { id: 'q-agent', query: 'desktop agent mouse click type', relevant: ['agent'] },
  { id: 'q-workflow', query: 'workflow github issues standup summary', relevant: ['workflow'] },
  { id: 'q-meetings', query: 'transcribe recorded meetings action items chunks', relevant: ['meetings'] },
  { id: 'q-providers', query: 'gemini ollama anthropic provider streaming', relevant: ['providers'] },
  { id: 'q-documents', query: 'import pdf markdown documents chunks search', relevant: ['knowledge'] },
  { id: 'q-screenshots', query: 'screenshots written to disk privacy', relevant: ['privacy'] },
  { id: 'q-shortcut', query: 'quick ask overlay keyboard shortcut overlay', relevant: ['shortcuts'] }
]

const paraphraseCases: EvalCase[] = [
  // No meaningful token overlap with the target document.
  { id: 'p-memory', query: 'how does the assistant recall my preferences', relevant: ['memory'] },
  { id: 'p-agent', query: 'make the computer do repetitive things for me', relevant: ['agent'] }
]

describe('retrieval evaluation', () => {
  it('finds the right document for keyword queries', () => {
    const report = evaluateRetrieval(corpus, lexicalCases, 5)
    expect(report.cases).toBe(lexicalCases.length)
    expect(report.recallAtK).toBeGreaterThanOrEqual(0.9)
    expect(report.mrr).toBeGreaterThanOrEqual(0.7)
    // Context injected per answer stays small enough to be cheap.
    expect(report.avgContextChars).toBeLessThan(400)
  })

  it('is fast enough to run on every message', () => {
    const report = evaluateRetrieval(corpus, lexicalCases, 5)
    expect(report.latencyMsPerQuery).toBeLessThan(25)
  })

  it('documents the known paraphrase gap (lexical retrieval fails these)', () => {
    const report = evaluateRetrieval(corpus, paraphraseCases, 5)
    // This is the measured reason hybrid/embedding search was not justified yet:
    // it would fix exactly these cases, but nothing else in the suite is failing.
    expect(report.recallAtK).toBe(0)
  })
})

describe('chunkDocument citations', () => {
  it('reports offsets and line numbers that point at the real text', () => {
    const text = ['line one', 'line two', 'line three'].join('\n')
    const chunks = chunkDocument(text, 20, 0)
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(text.slice(chunk.start, chunk.end)).toBe(chunk.text)
      expect(chunk.line).toBeGreaterThanOrEqual(1)
    }
    // The chunk containing "line two" sits on line 2 of the source.
    const second = chunks.find((chunk) => chunk.text.includes('line two'))
    if (second) expect(second.line).toBe(2)
  })

  it('derives line numbers from multi-paragraph documents', () => {
    const paragraph = 'alpha beta gamma delta epsilon zeta eta theta iota kappa'
    const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`
    const chunks = chunkDocument(text, 70, 0)
    expect(chunks.length).toBe(3)
    expect(chunks.map((chunk) => chunk.line)).toEqual([1, 3, 5])
    expect(text.slice(chunks[1].start, chunks[1].end)).toBe(chunks[1].text)
  })
})

describe('reciprocalRank', () => {
  it('scores the first position highest', () => {
    expect(reciprocalRank(['a', 'b', 'c'], ['a'])).toBe(1)
    expect(reciprocalRank(['a', 'b', 'c'], ['c'])).toBeCloseTo(1 / 3)
    expect(reciprocalRank(['a', 'b'], ['z'])).toBe(0)
  })
})
