/**
 * Live Buyer Hesitation & Intent Heatmap (Acoustic Psychology Engine)
 *
 * Grounded in peer-reviewed psycholinguistic and acoustic biomarker research:
 * - Inter-speaker response latency (Levelt, 1989; Clark & Fox Tree, 2002)
 * - Intra-phrase micro-pauses & working memory strain (Sweller, Cognitive Load Theory)
 * - Syllabic speech rate deceleration under cognitive conflict (NIH / Frontiers)
 * - Disfluency & filler word burst clustering (Stanford Computational Linguistics)
 * - Topic-conditioned sensitivity matrix (commercial pricing, authority, timeline)
 */

export type HesitationLevel = 'decisive' | 'neutral' | 'guarded' | 'hesitant'
export type TopicDomain = 'pricing' | 'timeline' | 'authority' | 'security' | 'general'

export interface HesitationIndicator {
  id: string
  type: 'latency' | 'pause' | 'speech_rate' | 'fillers' | 'pitch_jitter' | 'trailing_energy'
  severity: 'low' | 'medium' | 'high'
  label: string
  detail: string
}

export interface HesitationAnalysis {
  level: HesitationLevel
  score: number // 0 to 100
  confidence: number // 0 to 100
  topicCategory: TopicDomain
  latencyMs?: number
  speechRateWpm?: number
  fillerCount: number
  tacticalCue: string
  indicators: HesitationIndicator[]
  timestamp: number
}

export interface AcousticSpeechSample {
  text: string
  latencyMs?: number
  durationMs: number
  pauseCount?: number
  maxPauseMs?: number
  pitchVariance?: number // 0..1 scale
  energyDecay?: boolean // trailing volume slope
}

/** Common hesitation and disfluency filler tokens */
const FILLER_PATTERNS = [
  /\buh\b/gi,
  /\bum\b/gi,
  /\berr?\b/gi,
  /\bahh?\b/gi,
  /\bsort of\b/gi,
  /\bkind of\b/gi,
  /\bi mean\b/gi,
  /\byou know\b/gi,
  /\bwell\.\.\.\b/gi,
  /\bto be honest\b/gi,
  /\bfrankly\b/gi
]

/** Keywords mapping to high-stakes commercial topics */
const TOPIC_KEYWORD_MAP: Record<TopicDomain, RegExp> = {
  pricing: /\b(price|pricing|cost|costs|expensive|budget|quote|fee|fees|rate|discount|annual|arr|mrr|dollars?|license)\b/i,
  timeline: /\b(timeline|deadline|schedule|q1|q2|q3|q4|month|weeks?|go-live|rollout|delay|rush|asap)\b/i,
  authority: /\b(board|cfo|cto|vp|boss|procurement|legal|committee|sign-?off|approve|approval|stakeholder)\b/i,
  security: /\b(security|soc2|hipaa|gdpr|compliance|audit|iso|data|pii|encryption|residency|penetration)\b/i,
  general: /.*/
}

/** Topic sensitivity multipliers */
const TOPIC_WEIGHTS: Record<TopicDomain, number> = {
  pricing: 1.45,
  authority: 1.35,
  timeline: 1.25,
  security: 1.2,
  general: 1.0
}

/** Detect which commercial topic category a statement belongs to */
export function detectTopicDomain(text: string): TopicDomain {
  if (TOPIC_KEYWORD_MAP.pricing.test(text)) return 'pricing'
  if (TOPIC_KEYWORD_MAP.authority.test(text)) return 'authority'
  if (TOPIC_KEYWORD_MAP.timeline.test(text)) return 'timeline'
  if (TOPIC_KEYWORD_MAP.security.test(text)) return 'security'
  return 'general'
}

/** Count filler disfluencies in transcribed text */
export function countFillers(text: string): number {
  let count = 0
  for (const pattern of FILLER_PATTERNS) {
    const matches = text.match(pattern)
    if (matches) count += matches.length
  }
  return count
}

/** Calculate approximate speech rate in words per minute (WPM) */
export function calculateWpm(wordCount: number, durationMs: number): number {
  if (durationMs <= 0 || wordCount <= 0) return 140
  const minutes = durationMs / 60000
  return Math.round(wordCount / minutes)
}

/**
 * Evaluates buyer hesitation and cognitive friction from speech acoustics and text.
 */
export function analyzeBuyerHesitation(sample: AcousticSpeechSample): HesitationAnalysis {
  const text = sample.text.trim()
  const words = text.split(/\s+/).filter(Boolean)
  const wordCount = words.length
  const topic = detectTopicDomain(text)
  const topicWeight = TOPIC_WEIGHTS[topic]

  const indicators: HesitationIndicator[] = []
  let rawScore = 15 // baseline neutral/calm score

  // 1. Response Latency Evaluation (Normal: <400ms, Hesitant: >650ms, Severe: >1100ms)
  const latency = sample.latencyMs ?? 250
  if (latency > 1100) {
    rawScore += 35
    indicators.push({
      id: 'lat-high',
      type: 'latency',
      severity: 'high',
      label: 'Prolonged Latency',
      detail: `${latency}ms delay before responding (deliberation / guarded response)`
    })
  } else if (latency > 650) {
    rawScore += 20
    indicators.push({
      id: 'lat-med',
      type: 'latency',
      severity: 'medium',
      label: 'Elevated Latency',
      detail: `${latency}ms pause before starting speech`
    })
  } else if (latency < 350 && wordCount > 3) {
    rawScore -= 10 // Immediate reply indicates fluency and conviction
  }

  // 2. Speech Rate Deceleration (Normal: 130-170 WPM, Deceleration: <105 WPM)
  const wpm = calculateWpm(wordCount, sample.durationMs)
  if (wpm < 95 && wordCount >= 4) {
    rawScore += 25
    indicators.push({
      id: 'rate-slow',
      type: 'speech_rate',
      severity: 'high',
      label: 'Speech Deceleration',
      detail: `${wpm} WPM (~35% below natural conversational cadence)`
    })
  } else if (wpm < 115 && wordCount >= 4) {
    rawScore += 15
    indicators.push({
      id: 'rate-sub',
      type: 'speech_rate',
      severity: 'medium',
      label: 'Hesitant Cadence',
      detail: `${wpm} WPM (measured speech pace)`
    })
  } else if (wpm > 140 && wpm < 190) {
    rawScore -= 10 // Natural fluid pace
  }

  // 3. Filler Disfluency Density
  const fillers = countFillers(text)
  const fillerRatio = wordCount > 0 ? fillers / wordCount : 0
  if (fillers >= 3 || fillerRatio > 0.18) {
    rawScore += 30
    indicators.push({
      id: 'fill-burst',
      type: 'fillers',
      severity: 'high',
      label: 'Disfluency Burst',
      detail: `${fillers} filler tokens detected in ${wordCount} words`
    })
  } else if (fillers >= 1) {
    rawScore += 10 * fillers
    indicators.push({
      id: 'fill-mod',
      type: 'fillers',
      severity: 'medium',
      label: 'Verbal Disfluency',
      detail: `${fillers} filler phrase(s) ("um", "uh", "sort of")`
    })
  }

  // 4. Intra-phrase Micro-Pauses
  const pauses = sample.pauseCount ?? 0
  const maxPause = sample.maxPauseMs ?? 0
  if (maxPause > 700 || pauses >= 3) {
    rawScore += 20
    indicators.push({
      id: 'pause-long',
      type: 'pause',
      severity: 'high',
      label: 'Mid-Sentence Hesitation',
      detail: `${maxPause}ms internal pause during utterance`
    })
  }

  // 5. Acoustic Trailing Decay & Pitch Jitter
  if (sample.energyDecay) {
    rawScore += 15
    indicators.push({
      id: 'energy-decay',
      type: 'trailing_energy',
      severity: 'medium',
      label: 'Fading Trailing Energy',
      detail: 'Downward volume fadeout indicating loss of conviction'
    })
  }

  // Apply topic-conditioned sensitivity
  const finalScore = Math.min(100, Math.max(0, Math.round(rawScore * topicWeight)))

  // Classify level
  let level: HesitationLevel = 'neutral'
  if (finalScore >= 68) {
    level = 'hesitant'
  } else if (finalScore >= 45) {
    level = 'guarded'
  } else if (finalScore <= 22) {
    level = 'decisive'
  }

  // Generate tactical cue based on topic and level
  const tacticalCue = generateTacticalCue(level, topic, indicators)

  // Confidence is proportional to word count and presence of audio indicators
  const confidence = Math.min(
    95,
    Math.max(40, Math.round(30 + wordCount * 5 + (sample.latencyMs ? 20 : 0)))
  )

  return {
    level,
    score: finalScore,
    confidence,
    topicCategory: topic,
    latencyMs: sample.latencyMs,
    speechRateWpm: wpm,
    fillerCount: fillers,
    tacticalCue,
    indicators,
    timestamp: Date.now()
  }
}

/** Contextual real-time tactical guidance for sales/interviews */
function generateTacticalCue(
  level: HesitationLevel,
  topic: TopicDomain,
  indicators: HesitationIndicator[]
): string {
  if (level === 'decisive') {
    return 'Buyer speaks with high conviction. Advance toward mutual commitment or next milestone.'
  }

  if (level === 'neutral') {
    return 'Conversational cadence is balanced. Maintain discovery flow.'
  }

  const primary = indicators[0]?.type

  if (topic === 'pricing') {
    return level === 'hesitant'
      ? 'Strong friction on pricing (hesitation + latency). Probe budget authority and TCO over 24 months.'
      : 'Pricing hesitation detected. Frame value ROI before confirming contract terms.'
  }

  if (topic === 'authority') {
    return 'Hesitation on decision-making authority. Ask: "Who else will join for final sign-off?"'
  }

  if (topic === 'timeline') {
    return 'Hesitant on delivery timeline. Probe potential internal resource bottlenecks.'
  }

  if (topic === 'security') {
    return 'Guarded response on security. Offer to send SOC2 audit summary proactively.'
  }

  if (primary === 'latency') {
    return 'Noticeable response delay. Pause and ask an open-ended question to draw out concerns.'
  }

  if (primary === 'fillers') {
    return 'Disfluency burst indicates internal uncertainty. Validate their thoughts before moving on.'
  }

  return 'Buyer is guarded. Ask: "How does this compare with what you were expecting?"'
}

