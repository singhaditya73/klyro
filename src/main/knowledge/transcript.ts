/**
 * Pure helpers for assembling a live meeting transcript from independently
 * transcribed audio chunks.
 *
 * Chunks are cut on a timer, so speech lands on the boundary: the same phrase can
 * appear at the end of one chunk and the start of the next, and silence makes
 * speech-to-text emit filler like "[BLANK_AUDIO]". These helpers keep the stored
 * transcript clean and free of duplication, and are unit-testable on their own.
 */

/** Artefacts speech-to-text models emit for silence or noise. */
const NOISE_PATTERNS: RegExp[] = [
  /^[[(](?:blank_?audio|silence|inaudible|no speech|music|applause|laughter|sound|noise)[^\])]*[\])][.!]?$/i,
  // A lone "you"/"You." is a well-known artifact on near-silent audio.
  /^you[.!]?$/i
]

export function normalizeSegment(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .trim()
}

export function isNoise(text: string): boolean {
  const clean = normalizeSegment(text)
  if (!clean) return true
  return NOISE_PATTERNS.some((pattern) => pattern.test(clean))
}

function normalizedWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
}

/**
 * Number of leading words of `next` that repeat the tail of `previous`.
 * Returns 0 unless at least three words overlap, so ordinary repetition
 * ("yes, yes") is not mistaken for a duplicated chunk.
 */
export function overlapWordCount(previous: string, next: string): number {
  const before = previous.split(/\s+/).filter(Boolean)
  const after = next.split(/\s+/).filter(Boolean)
  const max = Math.min(before.length, after.length, 60)

  for (let size = max; size >= 3; size -= 1) {
    let matches = true
    for (let index = 0; index < size; index += 1) {
      const left = normalizedWord(before[before.length - size + index])
      const right = normalizedWord(after[index])
      if (!left || !right || left !== right) {
        matches = false
        break
      }
    }
    if (matches) return size
  }
  return 0
}

/** Drop the part of `next` that repeats the end of `previous`. */
export function stripOverlap(previous: string, next: string): string {
  const overlap = overlapWordCount(previous, next)
  if (overlap === 0) return normalizeSegment(next)
  return next.split(/\s+/).filter(Boolean).slice(overlap).join(' ')
}

export interface AppendResult {
  segments: string[]
  added: boolean
  reason?: 'empty' | 'duplicate'
}

/**
 * Append one transcribed chunk to a transcript, ignoring silence artefacts and
 * removing text that repeats the end of the previous chunk.
 */
export function appendSegment(segments: string[], raw: string): AppendResult {
  if (isNoise(raw)) return { segments, added: false, reason: 'empty' }

  const key = normalizeSegment(raw).toLowerCase()
  // A retried chunk can come back as a whole earlier segment; drop exactly those.
  if (segments.some((segment) => normalizeSegment(segment).toLowerCase() === key)) {
    return { segments, added: false, reason: 'duplicate' }
  }

  const last = segments[segments.length - 1] ?? ''
  const candidate = stripOverlap(last, raw)
  const clean = normalizeSegment(candidate)
  if (!clean) return { segments, added: false, reason: 'duplicate' }

  // A chunk that is entirely contained in what we already have is a repeat.
  if (last && normalizeSegment(last).toLowerCase().includes(clean.toLowerCase())) {
    return { segments, added: false, reason: 'duplicate' }
  }

  return { segments: [...segments, clean], added: true }
}

/** Join transcript segments into one block of text. */
export function joinSegments(segments: string[]): string {
  return segments.join(' ').replace(/\s+/g, ' ').trim()
}
