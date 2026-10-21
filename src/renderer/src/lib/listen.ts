/**
 * Meeting-assist plumbing for the quick-ask overlay: shared recorder mime-type
 * selection, the prompt framing for snippet questions, and a cheap heuristic
 * that says whether a live-transcribed chunk likely contains a question asked
 * of the user (so answering costs LLM calls only when one probably landed).
 */

const RECORD_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus'
]

/** Same preference order the meetings recorder uses; '' lets the browser pick. */
export function pickRecordMimeType(): string {
  for (const candidate of RECORD_MIME_CANDIDATES) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return ''
}

/** Interrogative cue near the chunk tail (whisper usually drops the "?" mark). */
const QUESTION_CUE = /\b(?:what|whats|what's|why|how|who|when|where|which|tell me|walk me|explain|can you|could you|do you|describe)\b/i

export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 8) return false
  if (trimmed.endsWith('?')) return true
  const tail = trimmed.slice(-160)
  return QUESTION_CUE.test(tail)
}

/** Frames a snippet transcription so the assistant answers, not chit-chats. */
export function snippetPrompt(transcript: string): string {
  return `This is a question a meeting participant just asked, transcribed from audio:\n\n"${transcript.trim()}"\n\nAnswer it directly and concisely (2–5 sentences), then stop.`
}

/** Live-transcript tail plus framing; distinguishes the answer from chit-chat. */
export function listenPrompt(tail: string[]): string {
  return `Live meeting transcript (most recent lines last):\n\n${tail.map((line) => `• ${line}`).join('\n')}\n\nIf the participants have just asked the user a question, answer it directly and concisely (2–5 sentences). If they have not, reply with exactly the single character "—" and nothing else.`
}

/** Sentinel the model returns when there is nothing to answer yet. */
export const LISTEN_NO_ANSWER = '—'

export function isNoAnswer(text: string): boolean {
  return text.replace(/\s+/g, ' ').trim() === LISTEN_NO_ANSWER
}

/* -----------------------------------------------------------------------
 * Meeting listen mode: hearing a question and answering it fast.
 *
 * The old way was to record in fixed 20-second chunks, transcribe each one
 * and then decide whether it held a question. A question that ended three
 * seconds into a chunk was not transcribed until twenty seconds in — the
 * opposite of fast.
 *
 * The way that answers in a second or two: record in short slices, watch the
 * level, and treat *an utterance* as the unit. When the room goes quiet for
 * a moment, the question has ended: transcribe just that utterance, and
 * answer it.
 * ---------------------------------------------------------------------- */

/** The quiet after the last word that ends a question. */
export const MEETING_QUESTION_SILENCE_MS = 700
/** Audio kept before the first word, so the question is not clipped. */
export const MEETING_PREROLL_MS = 400
/** A question shorter than this is a cough or a "yeah". */
export const MEETING_MIN_QUESTION_MS = 500

/** The level of the room, sampled a few times a second. */
export interface LevelWatcher {
  /** Milliseconds since the last sample that carried speech. */
  msSinceVoice(): number
  /**
   * When the current run of speech began, or 0 if nobody has spoken yet.
   *
   * The run is what a question is: it starts with the first word and ends
   * when the room goes quiet. Knowing when it started is what lets the
   * recorder keep the audio from just before it.
   */
  speechStartedAt(): number
  dispose(): void
}

/** A gap that is long enough to be a new run of speech. */
export const NEW_RUN_GAP_MS = 200

/** Watch the level of a stream. Null when Web Audio is unavailable. */
export function createLevelWatcher(stream: MediaStream): LevelWatcher | null {
  try {
    const AudioCtor = window.AudioContext
    if (!AudioCtor) return null
    const context = new AudioCtor()
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    // Analysis only — never connected to the destination, so no echo, no loopback.
    context.createMediaStreamSource(stream).connect(analyser)
    const buffer = new Uint8Array(analyser.fftSize)
    let lastVoicedAt = Date.now()
    let speechStartedAt = 0
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(buffer)
      if (rmsFromTimeDomain(buffer) < SILENCE_RMS_THRESHOLD) return
      const now = Date.now()
      // A voiced sample after a pause starts a new run of speech — and so
      // does the very first one, or the first question would never be heard.
      if (now - lastVoicedAt > NEW_RUN_GAP_MS || speechStartedAt === 0) speechStartedAt = now
      lastVoicedAt = now
    }, 100)
    return {
      msSinceVoice: () => Date.now() - lastVoicedAt,
      speechStartedAt: () => speechStartedAt,
      dispose: () => {
        window.clearInterval(timer)
        void context.close().catch(() => undefined)
      }
    }
  } catch {
    return null
  }
}

/**
 * Collects recorded slices into utterances.
 *
 * The audio arrives in small slices; the level says when somebody is talking.
 * An utterance is the audio from just before the first word to the moment the
 * room goes quiet — which is exactly one question.
 */
export class UtteranceAssembler {
  private slices: Blob[] = []
  private sliceAt: number[] = []
  private utteranceStart = 0

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Add a recorded slice. */
  push(slice: Blob): void {
    this.slices.push(slice)
    this.sliceAt.push(this.now())
  }

  /**
   * Has a question just ended? Returns the audio of it, or null.
   *
   * The level watcher says when the current run of speech began and how
   * quiet the room has been since. The question is over when the room has
   * been quiet for a moment — not when a recording chunk happens to end.
   */
  takeEndedUtterance(watcher: LevelWatcher | null): Blob | null {
    if (!watcher) return null
    const now = this.now()
    const speechStartedAt = watcher.speechStartedAt()
    if (speechStartedAt === 0) {
      this.utteranceStart = 0
      return null
    }

    if (this.utteranceStart === 0) {
      // The question starts a moment before the first word, so the first
      // syllable is not lost.
      this.utteranceStart = this.indexAtOrBefore(speechStartedAt - MEETING_PREROLL_MS)
    }

    // Still talking: the question has not ended yet.
    if (watcher.msSinceVoice() < MEETING_QUESTION_SILENCE_MS) return null

    const spoken = this.slices.slice(this.utteranceStart)
    const startedAt = this.sliceAt[this.utteranceStart] ?? now
    // Whatever came before the question is not part of it.
    this.slices = this.slices.slice(this.utteranceStart + spoken.length)
    this.sliceAt = this.sliceAt.slice(this.utteranceStart + spoken.length)
    this.utteranceStart = 0

    if (spoken.length === 0) return null
    if (now - startedAt < MEETING_MIN_QUESTION_MS) return null
    return mergeBlobs(spoken)
  }

  /** The index of the first slice that covers a moment in time. */
  private indexAtOrBefore(moment: number): number {
    for (let index = this.sliceAt.length - 1; index >= 0; index -= 1) {
      if (this.sliceAt[index] <= moment) return index
    }
    return 0
  }
}

/** Join recorded slices into one clip. */
export function mergeBlobs(blobs: Blob[]): Blob {
  if (blobs.length === 1) return blobs[0]
  return new Blob(blobs, { type: blobs[0]?.type || 'audio/webm' })
}

/* -----------------------------------------------------------------------
 * Silence gate: a live transcript should not burn transcription requests
 * on chunks where nobody was speaking. The overlay polls the stream's
 * level ~10×/s; a chunk is skipped when nothing crossed the speech floor
 * within its window (plus a grace margin so the tail of a sentence that
 * ends near the boundary is not clipped).
 * ---------------------------------------------------------------------- */

export const SILENCE_RMS_THRESHOLD = 0.012
export const SILENCE_GRACE_MS = 2500

/** RMS (0..1) of AnalyserNode time-domain bytes centred on 128. */
export function rmsFromTimeDomain(data: Uint8Array): number {
  if (data.length === 0) return 0
  let sum = 0
  for (let index = 0; index < data.length; index += 1) {
    const deviation = (data[index] - 128) / 128
    sum += deviation * deviation
  }
  return Math.sqrt(sum / data.length)
}

/** Would the chunk ending "now" contain the last voiced sample? */
export function chunkHasSpeech(lastVoicedAt: number, now: number, chunkMs: number, graceMs = SILENCE_GRACE_MS): boolean {
  if (lastVoicedAt <= 0) return false
  return now - lastVoicedAt <= chunkMs + graceMs
}

/* -----------------------------------------------------------------------
 * Conversation mode: voice activity detection.
 *
 * A duplex assistant should start talking when you start talking, and stop
 * when you stop. Without a streaming transcription provider there is no
 * partial text to show, so the detection is done on the audio level: the
 * analyser reports the loudness of the microphone, and an utterance begins
 * when the level crosses the speech floor and ends after a short silence.
 * -------------------------------------------------------------------- */

/** The level above which the microphone is treated as speech. */
export const VOICE_SPEECH_THRESHOLD = 0.014
/** Silence after the last voiced sample that ends an utterance. */
export const VOICE_SILENCE_MS = 750
/** An utterance shorter than this is a cough, a click or a keyboard. */
export const VOICE_MIN_UTTERANCE_MS = 450

/** Is this level speech rather than room noise? */
export function isSpeech(rms: number, threshold = VOICE_SPEECH_THRESHOLD): boolean {
  return rms >= threshold
}

/** Has the pause after the last voiced sample been long enough to end it? */
export function utteranceEnded(speaking: boolean, msSinceLastVoice: number, silenceMs = VOICE_SILENCE_MS): boolean {
  return speaking && msSinceLastVoice >= silenceMs
}

/** Was there enough speech in this utterance to be worth transcribing? */
export function utteranceWorthAsking(durationMs: number, minDurationMs = VOICE_MIN_UTTERANCE_MS): boolean {
  return durationMs >= minDurationMs
}

export interface SilenceWatcher {
  /** True when the chunk being assembled is silence-only and can be skipped. */
  isSilentChunk(chunkMs: number): boolean
  dispose(): void
}

/** Live analyser over a MediaStream; null when Web Audio is unavailable. */
export function createSilenceWatcher(stream: MediaStream): SilenceWatcher | null {
  try {
    const AudioCtor = window.AudioContext
    if (!AudioCtor) return null
    const context = new AudioCtor()
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    // Analysis only — never connected to the destination, so no echo/no loopback.
    context.createMediaStreamSource(stream).connect(analyser)
    const buffer = new Uint8Array(analyser.fftSize)
    // Assume speech initially: the first chunk is never skipped on a hunch.
    let lastVoicedAt = Date.now()
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(buffer)
      if (rmsFromTimeDomain(buffer) >= SILENCE_RMS_THRESHOLD) lastVoicedAt = Date.now()
    }, 100)
    return {
      isSilentChunk(chunkMs: number): boolean {
        return !chunkHasSpeech(lastVoicedAt, Date.now(), chunkMs)
      },
      dispose(): void {
        window.clearInterval(timer)
        void context.close().catch(() => undefined)
      }
    }
  } catch {
    return null
  }
}
