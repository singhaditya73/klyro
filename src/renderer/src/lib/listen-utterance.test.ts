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

/**
 * A clock the test drives, and a level watcher it controls.
 *
 * The watcher behaves exactly like the real one: a voiced sample after a
 * pause starts a new run of speech, and the run keeps its start until the
 * next one begins.
 */
function rig(): {
  clock: { now: number }
  level: LevelWatcher & { speak(): void; quiet(ms: number): void }
  advance: (ms: number) => void
} {
  const clock = { now: 0 }
  let speechStartedAt = 0
  let lastVoicedAt = 0
  const level: LevelWatcher & { speak(): void; quiet(ms: number): void } = {
    msSinceVoice: () => clock.now - lastVoicedAt,
    speechStartedAt: () => speechStartedAt,
    speak: () => {
      if (clock.now - lastVoicedAt > NEW_RUN_GAP_MS || speechStartedAt === 0) speechStartedAt = clock.now
      lastVoicedAt = clock.now
    },
    quiet: (ms: number) => {
      lastVoicedAt = clock.now - ms
    },
    dispose: () => undefined
  }
  return {
    clock,
    level,
    advance: (ms: number) => {
      clock.now += ms
    }
  }
}

function slice(marker: string): Blob {
  return new Blob([marker], { type: 'audio/webm' })
}

describe('UtteranceAssembler', () => {
  it('hands over the question as soon as the room goes quiet', () => {
    const { clock, level, advance } = rig()
    const assembler = new UtteranceAssembler(() => clock.now)

    // Somebody starts talking.
    advance(1000)
    level.speak()
    assembler.push(slice('a'))

    // They keep talking for a few seconds.
    for (let step = 1; step <= 10; step += 1) {
      advance(200)
      level.speak()
      assembler.push(slice(`w${step}`))
      expect(assembler.takeEndedUtterance(level)).toBeNull()
    }

    // Then they stop: the pause ends the question.
    advance(200)
    level.quiet(MEETING_QUESTION_SILENCE_MS)
    const utterance = assembler.takeEndedUtterance(level)
    expect(utterance).not.toBeNull()
    // The whole question is in it: 'a' plus w1..w10.
    expect(utterance?.size).toBe(22)
  })

  it('does not wait for a recording chunk to end', () => {
    // The old behaviour transcribed a 20-second chunk, so a question that
    // ended after two seconds was not heard until twenty. The new behaviour
    // hears it at the pause.
    const { clock, level, advance } = rig()
    const assembler = new UtteranceAssembler(() => clock.now)

    advance(200)
    level.speak()
    assembler.push(slice('hello'))

    advance(1200)
    level.quiet(MEETING_QUESTION_SILENCE_MS)
    const utterance = assembler.takeEndedUtterance(level)
    expect(utterance).not.toBeNull()
    // Two seconds in, not twenty.
    expect(clock.now).toBeLessThan(2000)
  })

  it('ignores a cough or a click', () => {
    const { clock, level, advance } = rig()
    const assembler = new UtteranceAssembler(() => clock.now)

    advance(100)
    level.speak()
    assembler.push(slice('tock'))

    advance(200)
    level.quiet(MEETING_QUESTION_SILENCE_MS)
    expect(assembler.takeEndedUtterance(level)).toBeNull()
  })

  it('keeps the audio just before the first word, so it is not clipped', () => {
    const { clock, level, advance } = rig()
    const assembler = new UtteranceAssembler(() => clock.now)

    // The room before the question: some noise, 300 ms earlier.
    advance(100)
    assembler.push(slice('noise'))

    // The question starts a moment later.
    advance(200)
    level.speak()
    assembler.push(slice('what'))

    advance(600)
    level.quiet(MEETING_QUESTION_SILENCE_MS)
    const utterance = assembler.takeEndedUtterance(level)
    expect(utterance).not.toBeNull()
    // The noise just before the question is kept, so the first word is whole.
    expect(utterance?.size).toBe(9)
  })

  it('lets the next question follow the first one', () => {
    const { clock, level, advance } = rig()
    const assembler = new UtteranceAssembler(() => clock.now)

    advance(100)
    level.speak()
    assembler.push(slice('first'))

    advance(700)
    level.quiet(MEETING_QUESTION_SILENCE_MS)
    const first = assembler.takeEndedUtterance(level)
    expect(first).not.toBeNull()
    expect(first?.size).toBe(5)

    advance(400)
    level.speak()
    assembler.push(slice('second'))

    advance(700)
    level.quiet(MEETING_QUESTION_SILENCE_MS)
    const second = assembler.takeEndedUtterance(level)
    expect(second).not.toBeNull()
    expect(second?.size).toBe(6)
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
