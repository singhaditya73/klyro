import { describe, expect, it } from 'vitest'
import { bm25Search, chunkText, jaccard, tokenize } from './retrieval'

describe('tokenize', () => {
  it('lowercases, splits on punctuation, and drops stopwords', () => {
    expect(tokenize('The QUICK, brown fox!')).toEqual(['quick', 'brown', 'fox'])
  })

  it('keeps unicode words and drops one-character tokens', () => {
    expect(tokenize('café Ño and a b')).toEqual(['café', 'ño'])
  })
})

describe('bm25Search', () => {
  const docs = [
    { id: 'a', text: 'Klyro stores API keys encrypted with the OS keychain' },
    { id: 'b', text: 'The desktop agent moves the mouse and types text' },
    { id: 'c', text: 'Voice transcription uses an OpenAI-compatible endpoint' }
  ]

  it('ranks the most relevant document first', () => {
    expect(bm25Search('how are api keys stored', docs)[0]?.id).toBe('a')
    expect(bm25Search('mouse input automation', docs)[0]?.id).toBe('b')
  })

  it('returns nothing when no term matches', () => {
    expect(bm25Search('zebra unicorn', docs)).toEqual([])
  })

  it('respects the limit', () => {
    expect(bm25Search('the and klyro agent voice', docs, 1)).toHaveLength(1)
  })

  it('ignores empty queries and empty corpora', () => {
    expect(bm25Search('', docs)).toEqual([])
    expect(bm25Search('klyro', [])).toEqual([])
  })
})

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    expect(chunkText('short note')).toEqual(['short note'])
  })

  it('splits long text into chunks that respect the limit', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'x'.repeat(80)}`).join('\n\n')
    const chunks = chunkText(text, 300, 50)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(300 + 50)
  })

  it('hard-splits a single oversized paragraph', () => {
    const chunks = chunkText('y'.repeat(1000), 200, 20)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].length).toBeLessThanOrEqual(201)
  })

  it('returns nothing for blank input', () => {
    expect(chunkText('   \n\n  ')).toEqual([])
  })
})

describe('jaccard', () => {
  it('is 1 for identical token sets and 0 for disjoint sets', () => {
    expect(jaccard('the user prefers dark mode', 'user prefers dark mode')).toBe(1)
    expect(jaccard('user prefers dark mode', 'bananas are yellow')).toBe(0)
  })

  it('is partial for overlapping sets', () => {
    const score = jaccard('user prefers dark mode always', 'user prefers light mode sometimes')
    expect(score).toBeGreaterThan(0.3)
    expect(score).toBeLessThan(1)
  })
})
