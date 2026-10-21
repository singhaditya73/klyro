import { describe, expect, it } from 'vitest'
import {
  MEETING_QUESTION_SILENCE_MS,
  MEETING_MIN_QUESTION_MS,
  UtteranceAssembler,
  type LevelWatcher
} from './listen'

/**
 * Latency regression tests.
 *
 * The overlay's promise is an answer while the meeting is still going. These
 * tests hold that promise to a number: how long after the speaker stops does
 * the question reach the model.
 *
 * The budgets are the *pipeline's* own, not the model's speed — the model is
 * the user's choice and is measured on its own (the overlay reports
 * time-to-first-token under every answer). What is measured here is what
 * Klyro adds: the wait for the question to end, and the transcription of it.
 */

/** The budgets, in milliseconds. */
export const LATENCY_BUDGETS = {
  /** From the last word to the question being ready for the model. */
  questionToModel: 1500,
  /** A long pause in the room must not be charged to the answer. */
  pauseOverhead: MEETING_QUESTION_SILENCE_MS + 200,
  /** A question that is interrupted is dropped without a transcription. */
  interruptionCost: 250
} as const

/** How often the overlay looks for a finished question. */
const POLL_MS = 100

/** A clock the test drives. */
function clock(): { now: number; advance: (ms: number) => void } {
  const state = {
    now: 0,
    advance: (ms: number): void => {
      state.now += ms
    }
  }
  return state
}

/** A level watcher the test drives. */
function level(clockState: { now: number }): LevelWatcher & { speak(): void; quiet(ms: number): void } {
  let speechStartedAt = 0
  let lastVoicedAt = 0
  return {
    msSinceVoice: () => clockState.now - lastVoicedAt,
    speechStartedAt: () => speechStartedAt,
    speak: () => {
      if (clockState.now - lastVoicedAt > 200 || speechStartedAt === 0) speechStartedAt = clockState.now
      lastVoicedAt = clockState.now
    },
    quiet: (ms: number) => {
      lastVoicedAt = clockState.now - ms
    },
    dispose: () => undefined
  }
}

/**
 * The overlay's listen loop, with the clock under the test's control: the
 * audio arrives in slices, the level is sampled, and every poll the assembler
 * is asked whether a question has ended.
 */
function listenLoop(): {
  time: { now: number; advance: (ms: number) => void }
  say: (text: string, ms: number) => void
  pause: (ms: number) => void
  poll: () => Blob | null
  slices: string[]
} {
  const time = clock()
  const watcher = level(time)
  const assembler = new UtteranceAssembler(() => time.now)
  const slices: string[] = []

  const poll = (): Blob | null => {
    // The poll happens every 100 ms; the test advances the clock in steps.
    const heard = assembler.takeEndedUtterance(watcher)
    return heard
  }

  return {
    time,
    slices,
    say: (text: string, ms: number) => {
      // The audio arrives in slices while the person is speaking, the way the
      // recorder delivers it.
      const steps = Math.max(1, Math.round(ms / POLL_MS))
      for (let step = 0; step < steps; step += 1) {
        time.advance(POLL_MS)
        watcher.speak()
        assembler.push(new Blob([text]))
        slices.push(text)
      }
    },
    pause: (ms: number) => {
      // The room goes quiet; the overlay keeps polling while it does.
      for (let elapsed = 0; elapsed < ms; elapsed += POLL_MS) {
        time.advance(POLL_MS)
      }
      watcher.quiet(ms)
    },
    poll
  }
}

describe('the answer arrives in time', () => {
  it('hears a short question within the budget', () => {
    const loop = listenLoop()
    // "what is your experience with Rust?"
    loop.say('what', 300)
    loop.say('is', 300)
    loop.say('your experience', 300)

    const stoppedAt = loop.time.now
    let heard: Blob | null = null
    // The overlay polls while the room is quiet.
    for (let elapsed = 0; elapsed < 1200 && !heard; elapsed += POLL_MS) {
      loop.time.advance(POLL_MS)
      heard = loop.poll()
    }
    expect(heard).not.toBeNull()
    // The question is ready for the model within the budget.
    expect(loop.time.now - stoppedAt).toBeLessThanOrEqual(LATENCY_BUDGETS.questionToModel)
  })

  it('does not charge a long pause to the answer', () => {
    const loop = listenLoop()
    loop.say('a question', 800)

    // Ten seconds of nothing. The question is heard at the pause, not after it.
    let heard: Blob | null = null
    for (let elapsed = 0; elapsed < 10_000 && !heard; elapsed += POLL_MS) {
      loop.time.advance(POLL_MS)
      heard = loop.poll()
    }
    expect(heard).not.toBeNull()
    // The wait is the pause threshold and nothing more.
    expect(loop.time.now).toBeLessThanOrEqual(800 + LATENCY_BUDGETS.pauseOverhead)
  })

  it('drops an interruption without paying for a transcription', () => {
    const loop = listenLoop()
    // A cough.
    loop.say('tock', 100)
    loop.pause(MEETING_QUESTION_SILENCE_MS)

    const started = Date.now()
    const heard = loop.poll()
    expect(heard).toBeNull()
    expect(Date.now() - started).toBeLessThan(LATENCY_BUDGETS.interruptionCost)
  })

  it('keeps a question that is over the minimum length', () => {
    const loop = listenLoop()
    loop.say('a real question about the project', MEETING_MIN_QUESTION_MS + 200)
    loop.pause(MEETING_QUESTION_SILENCE_MS)
    expect(loop.poll()).not.toBeNull()
  })

  it('hears two questions as two questions', () => {
    const loop = listenLoop()
    loop.say('first question', 800)
    loop.pause(MEETING_QUESTION_SILENCE_MS)
    const first = loop.poll()
    expect(first).not.toBeNull()

    loop.say('second question', 800)
    loop.pause(MEETING_QUESTION_SILENCE_MS)
    const second = loop.poll()
    expect(second).not.toBeNull()
  })
})
