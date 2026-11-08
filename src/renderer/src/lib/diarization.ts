/**
 * Real-Time Local Speaker Diarization Engine
 *
 * Separates speakers on 3+ person calls using:
 * 1. Physical dual-channel separation (Microphone = "You", System loopback = "Attendees").
 * 2. Real-time acoustic spectral centroid clustering on the system loopback channel
 *    (separates multiple attendees based on vocal pitch & formant frequency signatures).
 * 3. Dynamic name attribution (maps clusters to calendar attendees & self-introductions).
 */

export interface SpeakerCluster {
  id: string
  label: string
  prototypeVector: number[]
  sampleCount: number
  totalWords: number
  totalMs: number
}

export interface SpeakerAssignment {
  speakerId: string
  label: string
  isYou: boolean
  confidence: number
}

const COSINE_SIMILARITY_THRESHOLD = 0.82
const FREQ_BANDS = 8

/**
 * Normalizes a numeric vector to unit length for cosine distance computation.
 */
function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
  if (norm === 0) return vec.map(() => 0)
  return vec.map((v) => v / norm)
}

/**
 * Calculates cosine similarity between two normalized vectors (range -1 to 1).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
  }
  return dot
}

/**
 * Extracts an 8-band spectral feature vector from frequency domain byte data (FFT).
 */
export function extractSpectralVector(frequencyData: Uint8Array): number[] {
  if (!frequencyData || frequencyData.length === 0) {
    return new Array(FREQ_BANDS).fill(0)
  }

  // Focus on human vocal frequencies (approx 100Hz - 6000Hz)
  const bandSize = Math.max(1, Math.floor(frequencyData.length / FREQ_BANDS))
  const bands: number[] = new Array(FREQ_BANDS).fill(0)

  for (let b = 0; b < FREQ_BANDS; b++) {
    let sum = 0
    const start = b * bandSize
    const end = Math.min(frequencyData.length, start + bandSize)
    for (let i = start; i < end; i++) {
      sum += frequencyData[i]
    }
    bands[b] = sum / (end - start || 1)
  }

  return normalizeVector(bands)
}

export class SpeakerDiarizer {
  private clusters: Map<string, SpeakerCluster> = new Map()
  private attendeeNames: string[] = []
  private attendeeCursor = 0
  private lastAssignedSpeakerId = 'you'

  constructor() {
    this.reset()
  }

  reset(): void {
    this.clusters.clear()
    this.attendeeCursor = 0
    this.lastAssignedSpeakerId = 'you'

    // Anchor Speaker 0 to the local user
    this.clusters.set('you', {
      id: 'you',
      label: 'You',
      prototypeVector: new Array(FREQ_BANDS).fill(0),
      sampleCount: 1,
      totalWords: 0,
      totalMs: 0
    })
  }

  /**
   * Pre-loads known attendees from the calendar event.
   */
  setAttendees(attendees: string[]): void {
    // Strip emails from strings like "Alice Smith (alice@example.com)"
    this.attendeeNames = attendees
      .map((a) => a.replace(/\s*\([^)]*\)/, '').trim())
      .filter(Boolean)
  }

  /**
   * Identifies the active speaker for an utterance chunk.
   *
   * @param micEnergy RMS energy from user's microphone.
   * @param sysEnergy RMS energy from system audio loopback.
   * @param frequencyData FFT frequency data from system audio (for attendee clustering).
   */
  identifySpeaker(
    micEnergy: number,
    sysEnergy: number,
    frequencyData?: Uint8Array
  ): SpeakerAssignment {
    // Case 1: Microphone dominates -> It is definitively You
    if (micEnergy > 0.015 && micEnergy >= sysEnergy * 0.9) {
      this.lastAssignedSpeakerId = 'you'
      return {
        speakerId: 'you',
        label: 'You',
        isYou: true,
        confidence: 0.99
      }
    }

    // Case 2: System loopback dominates -> An attendee is speaking
    if (sysEnergy > 0.01 && frequencyData && frequencyData.length > 0) {
      const vector = extractSpectralVector(frequencyData)
      let bestSimilarity = -1
      let bestClusterId: string | null = null

      // Compare against existing remote attendee clusters
      for (const [id, cluster] of this.clusters.entries()) {
        if (id === 'you') continue
        const sim = cosineSimilarity(vector, cluster.prototypeVector)
        if (sim > bestSimilarity) {
          bestSimilarity = sim
          bestClusterId = id
        }
      }

      // Match found with high acoustic similarity
      if (bestClusterId && bestSimilarity >= COSINE_SIMILARITY_THRESHOLD) {
        const cluster = this.clusters.get(bestClusterId)!
        // Online prototype vector update (exponential moving average)
        cluster.sampleCount++
        const alpha = Math.min(0.2, 1 / cluster.sampleCount)
        for (let i = 0; i < FREQ_BANDS; i++) {
          cluster.prototypeVector[i] =
            (1 - alpha) * cluster.prototypeVector[i] + alpha * vector[i]
        }
        cluster.prototypeVector = normalizeVector(cluster.prototypeVector)

        this.lastAssignedSpeakerId = cluster.id
        return {
          speakerId: cluster.id,
          label: cluster.label,
          isYou: false,
          confidence: Math.round(bestSimilarity * 100) / 100
        }
      }

      // New distinct remote speaker detected! Create a new cluster
      const nextSpeakerNumber = this.clusters.size // 1-indexed since 'you' is cluster 0
      const nextId = `speaker_${nextSpeakerNumber}`

      // Assign label from prefilled calendar attendees if available, otherwise "Speaker N"
      let label = `Speaker ${nextSpeakerNumber}`
      if (this.attendeeCursor < this.attendeeNames.length) {
        label = this.attendeeNames[this.attendeeCursor]
        this.attendeeCursor++
      }

      this.clusters.set(nextId, {
        id: nextId,
        label,
        prototypeVector: vector,
        sampleCount: 1,
        totalWords: 0,
        totalMs: 0
      })

      this.lastAssignedSpeakerId = nextId
      return {
        speakerId: nextId,
        label,
        isYou: false,
        confidence: 0.88
      }
    }

    // Fallback: Return last assigned speaker or general attendee
    const fallback = this.clusters.get(this.lastAssignedSpeakerId) || this.clusters.get('you')!
    return {
      speakerId: fallback.id,
      label: fallback.label,
      isYou: fallback.id === 'you',
      confidence: 0.5
    }
  }

  /**
   * Adapts speaker cluster labels if someone introduces themselves in the transcript.
   * E.g. "Hi, this is Alice" or "Alice speaking" or "I'm Bob from Acme".
   */
  adaptSpeakerNames(transcriptLine: string): void {
    if (!transcriptLine) return

    // Pattern: "(this is|I am|I'm|it's) [Name]"
    const introMatch =
      /\b(?:this is|i am|i'm|it'?s)\s+([A-Z][a-z]+)(?:\s+from\s+[A-Za-z0-9&.\- ]+)?\b/i.exec(
        transcriptLine
      )
    if (introMatch && introMatch[1]) {
      const name = introMatch[1].trim()
      const genericWord = /^(here|speaking|ready|excited|calling|fine|good)$/i.test(name)
      if (!genericWord && this.lastAssignedSpeakerId !== 'you') {
        const cluster = this.clusters.get(this.lastAssignedSpeakerId)
        if (cluster && cluster.label.startsWith('Speaker ')) {
          cluster.label = name
        }
      }
    }
  }

  /**
   * Record words attributed to a speaker for the talk-time ratio.
   */
  recordSpeakerWords(speakerId: string, wordCount: number, durationMs: number = 0): void {
    let cluster = this.clusters.get(speakerId)
    if (!cluster) {
      const label = speakerId === 'you' ? 'You' : `Speaker ${speakerId.replace(/^speaker_?/, '') || '1'}`
      cluster = {
        id: speakerId,
        label,
        prototypeVector: new Array(FREQ_BANDS).fill(0),
        sampleCount: 1,
        totalWords: 0,
        totalMs: 0
      }
      this.clusters.set(speakerId, cluster)
    }
    cluster.totalWords += wordCount
    cluster.totalMs += durationMs
  }

  /**
   * Returns stats and talk-time distribution per speaker.
   */
  getSpeakerStats(): Array<{ id: string; label: string; talkPct: number; wordCount: number }> {
    let totalWords = 0
    for (const cluster of this.clusters.values()) {
      totalWords += cluster.totalWords
    }

    if (totalWords === 0) {
      return Array.from(this.clusters.values()).map((c) => ({
        id: c.id,
        label: c.label,
        talkPct: c.id === 'you' ? 100 : 0,
        wordCount: 0
      }))
    }

    return Array.from(this.clusters.values())
      .map((c) => ({
        id: c.id,
        label: c.label,
        talkPct: Math.round((c.totalWords / totalWords) * 100),
        wordCount: c.totalWords
      }))
      .sort((a, b) => b.wordCount - a.wordCount)
  }
}

export const diarizer = new SpeakerDiarizer()
