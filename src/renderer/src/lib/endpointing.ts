/**
 * Smart Conversational Endpointing & Turn Detection.
 *
 * Implements multi-layer turn detection inspired by modern voice architectures
 * (LiveKit, Deepgram Smart Endpointing, OpenAI Voice):
 * 1. Semantic Turn Analysis: Grammatical, connector, and thinking-marker heuristics.
 * 2. Acoustic Prosody & Pitch (F0) Tracking: Intonation slope (floor-holding vs terminal fall).
 * 3. High-Precision Voice Activity Detection: Bandpass energy & zero-crossing rate.
 * 4. Cadence Profiles: Snappy, Balanced, and Patient.
 */

export type CadencePreset = 'snappy' | 'balanced' | 'patient'

export const CADENCE_BASE_MS: Record<CadencePreset, number> = {
  snappy: 800,
  balanced: 1600,
  patient: 2400
}

export type SemanticStatus = 'complete' | 'incomplete' | 'thinking'

export interface SemanticAnalysis {
  status: SemanticStatus
  reason: string
  /** Dynamic silence threshold recommended based on the text. */
  silenceMs: number
  /** Trailing words detected. */
  trailingWords: string
}

// ---------------------------------------------------------------------------
// 1. Semantic Heuristics: Patterns of speech
// ---------------------------------------------------------------------------

/** Hesitation markers, thinking words, and floor-holding filler phrases. */
const THINKING_FILLERS = new Set([
  'um',
  'umm',
  'uh',
  'uhh',
  'er',
  'erm',
  'ah',
  'ahh',
  'hmm',
  'like',
  'well',
  'basically',
  'actually'
])

const THINKING_PHRASES = [
  /\b(?:let me think|let me see|let's see|how do i say|how to put this|what else|give me a second|give me a sec|hold on|wait a second|wait a minute)\s*$/i,
  /\b(?:i mean|you know|sort of|kind of)\s*$/i
]

/** Trailing conjunctions and connectors that indicate the thought is continuing. */
const TRAILING_CONNECTORS = new Set([
  'and',
  'but',
  'or',
  'nor',
  'for',
  'yet',
  'so',
  'plus',
  'because',
  'cause',
  'since',
  'although',
  'though',
  'while',
  'whereas',
  'as',
  'if',
  'unless',
  'until',
  'whether',
  'which',
  'that',
  'who',
  'whom',
  'whose',
  'wherever',
  'whenever'
])

const COMPOUND_CONNECTORS = [
  /\b(?:and then|and also|as well as|such as|in order to|even if|even though|so that|not only)\s*$/i
]

/** Trailing prepositions where the object of the preposition is missing. */
const TRAILING_PREPOSITIONS = new Set([
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'up',
  'about',
  'into',
  'over',
  'after',
  'under',
  'above',
  'through',
  'between',
  'before',
  'against',
  'during',
  'without',
  'towards',
  'upon',
  'behind',
  'within',
  'along'
])

/** Trailing auxiliary verbs and incomplete verb phrases. */
const TRAILING_AUXILIARIES = new Set([
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'being',
  'been',
  'have',
  'has',
  'had',
  'having',
  'do',
  'does',
  'did',
  'can',
  'could',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'ought'
])

const TRAILING_CONTRACTIONS = new Set([
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "haven't",
  "hasn't",
  "hadn't",
  "don't",
  "doesn't",
  "didn't",
  "won't",
  "wouldn't",
  "can't",
  'cannot',
  "couldn't",
  "shouldn't",
  "mightn't",
  "mustn't"
])

/** Trailing subject pronouns where the main verb/action is missing. */
const TRAILING_PRONOUNS = new Set([
  'i',
  'you',
  'he',
  'she',
  'we',
  'they'
])

/** Trailing inverted auxiliary + pronoun questions (e.g. "should I", "can we", "do you"). */
const TRAILING_AUX_PRONOUN = /\b(?:can|could|will|would|shall|should|may|might|must|do|does|did|is|are|am|was|were|have|has|had)\s+(?:i|you|he|she|it|we|they)\s*$/i

/** Trailing articles, determiners, and possessives that require a noun. */
const TRAILING_DETERMINERS = new Set([
  'a',
  'an',
  'the',
  'this',
  'that',
  'these',
  'those',
  'my',
  'your',
  'his',
  'her',
  'our',
  'their',
  'its',
  'some',
  'any',
  'every',
  'each',
  'either',
  'neither',
  'another'
])

/** Trailing infinitive markers and semi-auxiliaries (e.g. "trying to", "want to"). */
const TRAILING_INFINITIVES = /\b(?:want|wanted|trying|tried|going|need|needed|supposed|used|have|has|had|able|plan|planning|like|liked|hope|hoping)\s+to\s*$/i

/** Short incomplete question openers (< 4 words) where the speaker paused to think of the subject. */
const INCOMPLETE_QUESTION_OPENERS = /^(?:what is|what are|how do|how does|how can|why is|why does|why do|where is|where can|who is|can you|could you|would you|should i|is it|are there)\s*$/i

/** Patterns that indicate a completed question or command. */
const COMPLETE_IMPERATIVES = /^(?:explain|summarize|describe|compare|analyze|calculate|debug|fix|write|create|find|list|show)\b/i
const CONVERSATIONAL_CLOSERS = /^(?:thank you|thanks|that's all|that is all|that's it|got it|all done|bye)\.?$/i

/**
 * Analyzes partial or full transcribed text to determine if the speaker has
 * finished their sentence, is hesitating/thinking, or left an open clause.
 */
export function analyzeSemanticCompleteness(
  text: string,
  baseCadenceMs = CADENCE_BASE_MS.balanced
): SemanticAnalysis {
  const trimmed = text.trim()
  if (!trimmed) {
    return {
      status: 'incomplete',
      reason: 'Empty utterance',
      silenceMs: baseCadenceMs,
      trailingWords: ''
    }
  }

  // Explicit question mark or conversational closure
  if (trimmed.endsWith('?') || CONVERSATIONAL_CLOSERS.test(trimmed)) {
    return {
      status: 'complete',
      reason: 'Explicit question closure or sign-off',
      silenceMs: Math.max(650, Math.round(baseCadenceMs * 0.5)),
      trailingWords: ''
    }
  }

  const cleanText = trimmed.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
  const words = cleanText.split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return {
      status: 'incomplete',
      reason: 'No words found',
      silenceMs: baseCadenceMs,
      trailingWords: ''
    }
  }

  const lastWord = words[words.length - 1].toLowerCase()
  const lastTwoWords = words.slice(-2).join(' ').toLowerCase()
  const wordCount = words.length

  // 1. Thinking / Hesitation words or phrases
  if (THINKING_FILLERS.has(lastWord) || Array.from(THINKING_PHRASES).some((regex) => regex.test(trimmed))) {
    return {
      status: 'thinking',
      reason: `Speaker hesitated or used filler (${lastWord})`,
      silenceMs: Math.round(baseCadenceMs * 1.5) + 300,
      trailingWords: lastWord
    }
  }

  // 2. Compound connectors (e.g. "and then", "as well as")
  if (COMPOUND_CONNECTORS.some((regex) => regex.test(trimmed))) {
    return {
      status: 'incomplete',
      reason: `Trailing compound connector (${lastTwoWords})`,
      silenceMs: Math.round(baseCadenceMs * 1.4) + 200,
      trailingWords: lastTwoWords
    }
  }

  // 3. Trailing conjunctions / connectors
  if (TRAILING_CONNECTORS.has(lastWord)) {
    return {
      status: 'incomplete',
      reason: `Trailing connector (${lastWord})`,
      silenceMs: Math.round(baseCadenceMs * 1.4) + 200,
      trailingWords: lastWord
    }
  }

  // 4. Trailing prepositions
  if (TRAILING_PREPOSITIONS.has(lastWord)) {
    return {
      status: 'incomplete',
      reason: `Trailing preposition (${lastWord}) requires object`,
      silenceMs: Math.round(baseCadenceMs * 1.4) + 200,
      trailingWords: lastWord
    }
  }

  // 5. Trailing auxiliaries or contractions
  if (TRAILING_AUXILIARIES.has(lastWord) || TRAILING_CONTRACTIONS.has(lastWord)) {
    return {
      status: 'incomplete',
      reason: `Trailing auxiliary or modal (${lastWord}) requires predicate`,
      silenceMs: Math.round(baseCadenceMs * 1.35) + 200,
      trailingWords: lastWord
    }
  }

  // 6. Trailing auxiliary + subject pronoun (e.g. "should I", "can we", "could you")
  if (TRAILING_AUX_PRONOUN.test(trimmed)) {
    return {
      status: 'incomplete',
      reason: `Trailing auxiliary + pronoun (${lastTwoWords}) requires main verb`,
      silenceMs: Math.round(baseCadenceMs * 1.4) + 200,
      trailingWords: lastTwoWords
    }
  }

  // 7. Trailing subject pronoun with short utterance or connector
  if (TRAILING_PRONOUNS.has(lastWord) && (wordCount <= 4 || TRAILING_CONNECTORS.has(words[words.length - 2]?.toLowerCase()))) {
    return {
      status: 'incomplete',
      reason: `Trailing pronoun (${lastWord}) without predicate`,
      silenceMs: Math.round(baseCadenceMs * 1.35) + 200,
      trailingWords: lastWord
    }
  }

  // 8. Trailing infinitives (e.g. "want to", "trying to")
  if (TRAILING_INFINITIVES.test(trimmed)) {
    return {
      status: 'incomplete',
      reason: `Trailing infinitive (${lastTwoWords})`,
      silenceMs: Math.round(baseCadenceMs * 1.35) + 200,
      trailingWords: lastTwoWords
    }
  }

  // 7. Trailing determiners / articles
  if (TRAILING_DETERMINERS.has(lastWord)) {
    return {
      status: 'incomplete',
      reason: `Trailing determiner (${lastWord}) requires noun`,
      silenceMs: Math.round(baseCadenceMs * 1.4) + 200,
      trailingWords: lastWord
    }
  }

  // 8. Incomplete question openers without subject/predicate
  if (wordCount < 4 && INCOMPLETE_QUESTION_OPENERS.test(trimmed)) {
    return {
      status: 'incomplete',
      reason: `Incomplete question opener (${trimmed})`,
      silenceMs: Math.round(baseCadenceMs * 1.3) + 200,
      trailingWords: trimmed
    }
  }

  // 9. Complete closed commands or wh-questions with adequate length
  if (
    COMPLETE_IMPERATIVES.test(trimmed) ||
    (wordCount >= 4 && /^(?:what|how|why|where|who|which|can|could|is|are|does|do)\b/i.test(trimmed))
  ) {
    return {
      status: 'complete',
      reason: 'Complete command or question structure',
      silenceMs: Math.max(700, Math.round(baseCadenceMs * 0.65)),
      trailingWords: ''
    }
  }

  // Default: balanced baseline
  return {
    status: 'complete',
    reason: 'Standard sentence closure',
    silenceMs: baseCadenceMs,
    trailingWords: ''
  }
}

// ---------------------------------------------------------------------------
// 2. Acoustic Prosody & Pitch (F0) Tracking
// ---------------------------------------------------------------------------

/**
 * Fundamental frequency (F0) estimation using normalized autocorrelation.
 * Optimized for human vocal pitch range (80 Hz to 400 Hz).
 */
export function estimatePitch(pcm: Float32Array, sampleRate: number): { pitchHz: number; confidence: number } {
  const minLag = Math.floor(sampleRate / 400) // ~400 Hz
  const maxLag = Math.floor(sampleRate / 80) // ~80 Hz

  if (pcm.length < maxLag * 2) {
    return { pitchHz: 0, confidence: 0 }
  }

  let bestLag = 0
  let maxCorrelation = 0

  // Calculate energy of the base window
  let baseEnergy = 0
  for (let i = 0; i < maxLag; i++) {
    baseEnergy += pcm[i] * pcm[i]
  }

  if (baseEnergy < 0.0001) {
    return { pitchHz: 0, confidence: 0 }
  }

  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0
    let lagEnergy = 0
    for (let i = 0; i < maxLag; i++) {
      const sampleA = pcm[i]
      const sampleB = pcm[i + lag]
      correlation += sampleA * sampleB
      lagEnergy += sampleB * sampleB
    }

    const norm = Math.sqrt(baseEnergy * lagEnergy)
    if (norm > 0) {
      const normalizedCorr = correlation / norm
      if (normalizedCorr > maxCorrelation) {
        maxCorrelation = normalizedCorr
        bestLag = lag
      }
    }
  }

  if (maxCorrelation > 0.45 && bestLag > 0) {
    return {
      pitchHz: sampleRate / bestLag,
      confidence: maxCorrelation
    }
  }

  return { pitchHz: 0, confidence: 0 }
}

/**
 * Tracks recent pitch values to detect intonation contours:
 * - Rising / Floor-holding intonation (holding the floor mid-thought)
 * - Falling terminal intonation (turn complete)
 */
export class ProsodyTracker {
  private history: { pitch: number; time: number }[] = []
  private readonly maxWindowMs = 600

  push(pitchHz: number, confidence: number, timestamp = Date.now()): void {
    if (confidence >= 0.5 && pitchHz >= 80 && pitchHz <= 400) {
      this.history.push({ pitch: pitchHz, time: timestamp })
    }
    const cutoff = timestamp - this.maxWindowMs
    this.history = this.history.filter((entry) => entry.time >= cutoff)
  }

  /**
   * Returns true if recent pitch shows floor-holding intonation (rising or high sustained pitch).
   */
  isHoldingFloor(): boolean {
    if (this.history.length < 3) return false
    const firstHalf = this.history.slice(0, Math.floor(this.history.length / 2))
    const secondHalf = this.history.slice(Math.floor(this.history.length / 2))

    const mean1 = firstHalf.reduce((acc, curr) => acc + curr.pitch, 0) / firstHalf.length
    const mean2 = secondHalf.reduce((acc, curr) => acc + curr.pitch, 0) / secondHalf.length

    // Rising or sustained pitch above baseline (+4% slope) indicates continuation
    return mean2 > mean1 * 1.04
  }

  reset(): void {
    this.history = []
  }
}

// ---------------------------------------------------------------------------
// 3. Acoustic Voice Activity & Noise Filtering
// ---------------------------------------------------------------------------

/**
 * Zero-crossing rate calculation on PCM:
 * Speech vowels/consonants have moderate ZCR (0.02 to 0.30).
 * Clicks, pops, and electrostatic spikes have high chaotic ZCR (> 0.48).
 */
export function computeZeroCrossingRate(pcm: Float32Array): number {
  if (pcm.length < 2) return 0
  let crossings = 0
  for (let i = 1; i < pcm.length; i++) {
    if ((pcm[i] >= 0 && pcm[i - 1] < 0) || (pcm[i] < 0 && pcm[i - 1] >= 0)) {
      crossings++
    }
  }
  return crossings / (pcm.length - 1)
}

/**
 * High-precision dual-stage VAD filter.
 * Combines RMS loudness, zero-crossing rate, and pitch certainty.
 */
export function isAcousticVoice(
  rms: number,
  zcr: number,
  pitchConfidence: number,
  threshold = 0.014
): boolean {
  if (rms < threshold) return false
  // Discard high-frequency noise spikes / clicks
  if (zcr > 0.48 && pitchConfidence < 0.3) return false
  // High confidence pitch in human vocal range is definitely voice
  if (pitchConfidence > 0.5) return true
  // Moderate loudness with standard speech zero-crossing rate
  return rms >= threshold && zcr <= 0.45
}

// ---------------------------------------------------------------------------
// 4. Dynamic Threshold Resolver
// ---------------------------------------------------------------------------

export interface DynamicSilenceParams {
  baseCadenceMs: number
  partialTranscript?: string
  isHoldingFloor?: boolean
  pushToTalkActive?: boolean
}

/**
 * Calculates the dynamic silence duration required before ending a turn,
 * fusing cadence preset, semantic analysis, and acoustic prosody.
 */
export function calculateDynamicSilence(params: DynamicSilenceParams): number {
  if (params.pushToTalkActive) {
    return Number.POSITIVE_INFINITY
  }

  let silenceMs = params.baseCadenceMs

  if (params.partialTranscript) {
    const analysis = analyzeSemanticCompleteness(params.partialTranscript, params.baseCadenceMs)
    silenceMs = analysis.silenceMs
  }

  // If acoustic pitch indicates the speaker is holding the floor, grant an extra 350ms
  if (params.isHoldingFloor) {
    silenceMs += 350
  }

  return silenceMs
}
