import { describe, expect, it } from 'vitest'
import {
  MEETING_MIN_QUESTION_MS,
  MEETING_QUESTION_SILENCE_MS,
  NEW_RUN_GAP_MS,
  UtteranceAssembler,
  mergeBlobs,
  type LevelWatcher
} from './listen'

/**
 * The listen mode answers a question as soon as it is asked.
 *
 * These tests are about the timing: a question that ended at three seconds
 * must not wait for a twenty-second recording chunk to finish before it is
 * even transcribed.
 */

/** How often the overlay looks for a finished question, and records a slice. */
const POLL_MS = 100

/**
 * A clock the test drives, and a level watcher it controls.
 *
 * The watcher behaves exactly like the real one: a voiced sample after a
 * pause starts a new run of speech, and the run keeps its start until the
 * next one begins. The room's quiet is measured from the last voiced sample.
 */
function rig(): {
  clock: { now: number }
  level: LevelWatcher
  assembler: UtteranceAssembler
  advance: (ms: number) => void
  /** Somebody speaks for a while; the audio arrives in slices. */
  say: (text: string, ms: number) => void
  /** The room goes quiet. */
  pause: (ms: number) => void
} {
  const clock = { now: 0 }
  let speechStartedAt = 0
  let lastVoicedAt = 0
  const level: LevelWatcher = {
    msSinceVoice: () => clock.now - lastVoicedAt,
    speechStartedAt: () => speechStartedAt,
    dispose: () => undefined
  }
  const assembler = new UtteranceAssembler(() => clock.now)
  return {
    clock,
    level,
    assembler,
    advance: (ms: number) => {
      clock.now += ms
    },
    say: (text: string, ms: number) => {
      const steps = Math.max(1, Math.round(ms / POLL_MS))
      for (let step = 0; step < steps; step += 1) {
        clock.now += POLL_MS
        if (clock.now - lastVoicedAt > NEW_RUN_GAP_MS || speechStartedAt === 0) speechStartedAt = clock.now
        lastVoicedAt = clock.now
        assembler.push(new Blob([text], { type: 'audio/webm' }))
      }
    },
    pause: (ms: number) => {
      clock.now += ms
    }
  }
}

describe('UtteranceAssembler', () => {
  it('hands over the question as soon as the room goes quiet', () => {
    const { level, assembler, say, pause } = rig()

    // Somebody starts talking and keeps talking.
    say('w', 2000)
    expect(assembler.takeEndedUtterance(level)).toBeNull()

    // Then they stop: the pause ends the question.
    pause(MEETING_QUESTION_SILENCE_MS)
    const utterance = assembler.takeEndedUtterance(level)
    expect(utterance).not.toBeNull()
    // The whole question is in it.
    expect(utterance?.size).toBe(20)
  })

  it('does not wait for a recording chunk to end', () => {
    // The old behaviour transcribed a 20-second chunk, so a question that
    // ended after two seconds was not heard until twenty. The new behaviour
    // hears it at the pause.
    const { clock, level, assembler, say, pause } = rig()
    say('hello', 1200)
    const stoppedAt = clock.now
    pause(MEETING_QUESTION_SILENCE_MS)
    const utterance = assembler.takeEndedUtterance(level)
    expect(utterance).not.toBeNull()
    // Two seconds in, not twenty.
    expect(clock.now - stoppedAt).toBeLessThan(2000)
  })

  it('ignores a cough or a click', () => {
    const { level, assembler, say, pause } = rig()
    say('tock', 100)
    pause(MEETING_QUESTION_SILENCE_MS)
    expect(assembler.takeEndedUtterance(level)).toBeNull()
  })

  it('keeps the audio just before the first word, so it is not clipped', () => {
    const { clock, level, assembler, say, pause } = rig()

    // The room before the question: some noise.
    clock.now += 100
    assembler.push(new Blob(['noise'], { type: 'audio/webm' }))

    // The question starts a moment later.
    clock.now += 200
    say('what', 600)

    pause(MEETING_QUESTION_SILENCE_MS)
    const utterance = assembler.takeEndedUtterance(level)
    expect(utterance).not.toBeNull()
    // The noise just before the question is kept, so the first word is whole.
    expect(utterance?.size).toBe(5 + 4 * 6)
  })

  it('lets the next question follow the first one', () => {
    const { level, assembler, say, pause } = rig()
    say('first', 600)
    pause(MEETING_QUESTION_SILENCE_MS)
    const first = assembler.takeEndedUtterance(level)
    expect(first).not.toBeNull()
    expect(first?.size).toBe(5 * 6)

    say('second', 600)
    pause(MEETING_QUESTION_SILENCE_MS)
    const second = assembler.takeEndedUtterance(level)
    expect(second).not.toBeNull()
    expect(second?.size).toBe(6 * 6)
  })

  it('keeps a question that is worth asking', () => {
    expect(MEETING_MIN_QUESTION_MS).toBeLessThan(2000)
  })
})

describe('mergeBlobs', () => {
  it('joins the slices into one clip', () => {
    const merged = mergeBlobs([new Blob(['ab']), new Blob(['cd'])])
    expect(merged.size).toBe(4)
  })

  it('leaves a single slice alone', () => {
    const one = new Blob(['abc'])
    expect(mergeBlobs([one])).toBe(one)
  })
})
