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
