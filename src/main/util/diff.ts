/**
 * Line-based diffing for reviewable file edits.
 *
 * Deliberately small and dependency-free: it only has to be good enough to show
 * a human what a proposed change does before they approve it, and to be
 * unit-testable. Very large inputs fall back to a single whole-file hunk so a
 * pathological file can never make the diff quadratic-doom the app.
 */

export type DiffLineType = 'context' | 'add' | 'remove'

export interface DiffLine {
  type: DiffLineType
  text: string
  /** 1-based line number in the original file, or null for added lines. */
  oldLine: number | null
  /** 1-based line number in the new file, or null for removed lines. */
  newLine: number | null
}

export interface DiffHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

export interface DiffStat {
  added: number
  removed: number
  hunks: number
}

/** Lines past this count make the LCS table too expensive; we then diff coarsely. */
const MAX_LCS_LINES = 2000

export function splitLines(text: string): string[] {
  if (text === '') return []
  return text.replace(/\r\n/g, '\n').split('\n')
}

function lcsMatrix(before: string[], after: string[]): number[][] {
  const table: number[][] = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  return table
}

/** A flat list of line operations, in file order. */
function lineOps(before: string[], after: string[]): DiffLine[] {
  if (before.length > MAX_LCS_LINES || after.length > MAX_LCS_LINES) {
    // Coarse fallback: everything removed, everything added. Still honest.
    return [
      ...before.map((text, index) => ({ type: 'remove' as const, text, oldLine: index + 1, newLine: null })),
      ...after.map((text, index) => ({ type: 'add' as const, text, oldLine: null, newLine: index + 1 }))
    ]
  }

  const table = lcsMatrix(before, after)
  const ops: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      ops.push({ type: 'context', text: before[i], oldLine: i + 1, newLine: j + 1 })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: 'remove', text: before[i], oldLine: i + 1, newLine: null })
      i += 1
    } else {
      ops.push({ type: 'add', text: after[j], oldLine: null, newLine: j + 1 })
      j += 1
    }
  }
  while (i < before.length) {
    ops.push({ type: 'remove', text: before[i], oldLine: i + 1, newLine: null })
    i += 1
  }
  while (j < after.length) {
    ops.push({ type: 'add', text: after[j], oldLine: null, newLine: j + 1 })
    j += 1
  }
  return ops
}

/** Group operations into hunks, keeping `context` unchanged lines around changes. */
export function buildHunks(before: string, after: string, context = 3): DiffHunk[] {
  const ops = lineOps(splitLines(before), splitLines(after))
  const changed = ops.map((op) => op.type !== 'context')
  if (!changed.some(Boolean)) return []

  const hunks: DiffHunk[] = []
  let index = 0
  while (index < ops.length) {
    if (!changed[index]) {
      index += 1
      continue
    }
    // Walk back for leading context, forward for the change plus trailing context.
    const start = Math.max(0, index - context)
    let end = index
    let sinceChange = 0
    while (end < ops.length) {
      if (changed[end]) {
        sinceChange = 0
      } else {
        sinceChange += 1
        if (sinceChange > context * 2) break
      }
      end += 1
    }
    const lines = ops.slice(start, Math.min(ops.length, end))
    const oldLines = lines.filter((line) => line.type !== 'add')
    const newLines = lines.filter((line) => line.type !== 'remove')
    hunks.push({
      oldStart: oldLines[0]?.oldLine ?? 0,
      oldCount: oldLines.length,
      newStart: newLines[0]?.newLine ?? 0,
      newCount: newLines.length,
      lines
    })
    index = end
  }
  return hunks
}

export function summarize(hunks: DiffHunk[]): DiffStat {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') added += 1
      else if (line.type === 'remove') removed += 1
    }
  }
  return { added, removed, hunks: hunks.length }
}

/** Standard unified-diff text, ready to show in a `<pre>` or save to a file. */
export function formatUnified(hunks: DiffHunk[], beforeLabel = 'before', afterLabel = 'after'): string {
  if (hunks.length === 0) return ''
  const header = [`--- ${beforeLabel}`, `+++ ${afterLabel}`]
  const body = hunks.map((hunk) => {
    const marker = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`
    const lines = hunk.lines.map((line) => {
      const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '
      return `${prefix}${line.text}`
    })
    return [marker, ...lines].join('\n')
  })
  return [...header, ...body].join('\n')
}
