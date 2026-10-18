/** Turning a retrieved chunk into a citation label people can act on. */

export interface LocatedChunk {
  name: string
  /** 1-based start line, or 0 when unknown. */
  line: number
  /** 1-based end line, when the source range is known. */
  endLine?: number
}

/**
 * `file.ts`, `file.ts:12` or `file.ts:12-40`. Never invents a location: a hit
 * with no known line is cited by name only.
 */
export function formatLocation(chunk: LocatedChunk): string {
  if (!chunk.line || chunk.line <= 0) return chunk.name
  if (chunk.endLine && chunk.endLine > chunk.line) return `${chunk.name}:${chunk.line}-${chunk.endLine}`
  return `${chunk.name}:${chunk.line}`
}
