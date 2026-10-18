import { describe, expect, it } from 'vitest'
import { buildHunks, formatUnified, splitLines, summarize } from './diff'

describe('splitLines', () => {
  it('handles empty input and normalises CRLF', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines('a\r\nb')).toEqual(['a', 'b'])
  })
})

describe('buildHunks', () => {
  it('returns nothing for identical text', () => {
    expect(buildHunks('same\ntext\n', 'same\ntext\n')).toEqual([])
  })

  it('reports an added line with the right line numbers', () => {
    const hunks = buildHunks('one\ntwo\n', 'one\ntwo\nthree\n')
    expect(hunks).toHaveLength(1)
    const added = hunks[0].lines.filter((line) => line.type === 'add')
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ text: 'three', oldLine: null, newLine: 3 })
    expect(summarize(hunks)).toEqual({ added: 1, removed: 0, hunks: 1 })
  })

  it('reports a removed line', () => {
    const hunks = buildHunks('one\ntwo\nthree\n', 'one\nthree\n')
    const removed = hunks[0].lines.filter((line) => line.type === 'remove')
    expect(removed).toHaveLength(1)
    expect(removed[0]).toMatchObject({ text: 'two', oldLine: 2, newLine: null })
    expect(summarize(hunks)).toEqual({ added: 0, removed: 1, hunks: 1 })
  })

  it('keeps unchanged context and separates distant changes into hunks', () => {
    const before = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n')
    const after = before.replace('line 2', 'LINE TWO').replace('line 28', 'LINE 28')
    const hunks = buildHunks(before, after, 3)

    expect(hunks).toHaveLength(2)
    // Leading context is included, so a reader can see where the change lands.
    expect(hunks[0].lines[0].type).toBe('context')
    expect(formatUnified(hunks, 'a/file.txt', 'b/file.txt')).toContain('@@')
  })

  it('handles a whole new file', () => {
    const hunks = buildHunks('', 'alpha\nbeta')
    expect(summarize(hunks)).toEqual({ added: 2, removed: 0, hunks: 1 })
  })

  it('treats a trailing newline as a real change', () => {
    // The diff drives both the review and the "has anything changed?" guard,
    // so adding or removing only the final newline must not look like a no-op.
    expect(buildHunks('alpha', 'alpha\n')).toHaveLength(1)
    expect(buildHunks('alpha\n', 'alpha\n')).toHaveLength(0)
  })

  it('renders readable unified diff text', () => {
    const text = formatUnified(buildHunks('a\nb\n', 'a\nB\n'), 'a/notes.md', 'b/notes.md')
    expect(text).toContain('--- a/notes.md')
    expect(text).toContain('+++ b/notes.md')
    expect(text).toContain('-b')
    expect(text).toContain('+B')
  })

  it('falls back to a coarse diff for very large files instead of blowing up', () => {
    const before = Array.from({ length: 2500 }, (_, index) => `old ${index}`).join('\n')
    const after = Array.from({ length: 2500 }, (_, index) => `new ${index}`).join('\n')
    const hunks = buildHunks(before, after)
    expect(summarize(hunks)).toMatchObject({ added: 2500, removed: 2500 })
  })
})
