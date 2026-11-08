import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, RotateCcw, FastForward, Rewind, X } from 'lucide-react'

interface RsvpReaderProps {
  text: string
  onClose: () => void
}

export function RsvpReader({ text, onClose }: RsvpReaderProps) {
  // Split into words, preserving minimal punctuation cadence.
  const words = useMemo(
    () =>
      text
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    [text]
  )

  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [wpm, setWpm] = useState(280)
  const timerRef = useRef<number | null>(null)

  const currentWord = words[index] || ''
  // Calculate Optimal Recognition Point (ORP) ~35% into the word
  const orpIndex = Math.max(0, Math.min(currentWord.length - 1, Math.floor(currentWord.length * 0.35)))
  const beforeOrp = currentWord.slice(0, orpIndex)
  const orpChar = currentWord[orpIndex] || ''
  const afterOrp = currentWord.slice(orpIndex + 1)

  useEffect(() => {
    if (!playing || words.length === 0) {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      return
    }

    if (index >= words.length) {
      setPlaying(false)
      return
    }

    // Dynamic delay: longer pause on punctuation (periods, commas, colons)
    const word = words[index]
    const baseDelay = (60 / wpm) * 1000
    let pauseFactor = 1.0
    if (/[.?!]$/.test(word)) pauseFactor = 2.0
    else if (/[,;:]$/.test(word)) pauseFactor = 1.5
    else if (word.length > 9) pauseFactor = 1.25

    timerRef.current = window.setTimeout(() => {
      setIndex((prev) => prev + 1)
    }, Math.round(baseDelay * pauseFactor))

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [playing, index, wpm, words])

  return (
    <div className="overlay__rsvp" role="region" aria-label="RSVP Speed Reader">
      <div className="overlay__rsvp-topbar">
        <span className="overlay__rsvp-badge">RSVP Eye-Gaze Anchor</span>
        <span className="overlay__rsvp-progress">
          {index + 1} / {words.length} words
        </span>
        <button
          type="button"
          className="btn btn--icon btn--icon-xs btn--ghost"
          onClick={onClose}
          aria-label="Close RSVP Reader"
        >
          <X className="icon icon--xs" />
        </button>
      </div>

      <div className="overlay__rsvp-viewport" onClick={() => setPlaying(!playing)}>
        <div className="overlay__rsvp-reticle">
          <span className="overlay__rsvp-before">{beforeOrp}</span>
          <span className="overlay__rsvp-orp">{orpChar}</span>
          <span className="overlay__rsvp-after">{afterOrp}</span>
        </div>
      </div>

      <div className="overlay__rsvp-controls">
        <button
          type="button"
          className="btn btn--icon btn--icon-xs btn--quiet"
          onClick={() => setIndex((i) => Math.max(0, i - 10))}
          title="Rewind 10 words"
        >
          <Rewind className="icon icon--xs" />
        </button>

        <button
          type="button"
          className="btn btn--primary btn--xs"
          onClick={() => setPlaying(!playing)}
          title="Play / Pause"
        >
          {playing ? <Pause className="icon icon--xs" /> : <Play className="icon icon--xs" />}
          <span>{playing ? 'Pause' : 'Play'}</span>
        </button>

        <button
          type="button"
          className="btn btn--icon btn--icon-xs btn--quiet"
          onClick={() => setIndex((i) => Math.min(words.length - 1, i + 10))}
          title="Forward 10 words"
        >
          <FastForward className="icon icon--xs" />
        </button>

        <button
          type="button"
          className="btn btn--icon btn--icon-xs btn--quiet"
          onClick={() => {
            setIndex(0)
            setPlaying(true)
          }}
          title="Restart from beginning"
        >
          <RotateCcw className="icon icon--xs" />
        </button>

        <div className="overlay__rsvp-speed">
          <input
            type="range"
            min={150}
            max={550}
            step={25}
            value={wpm}
            onChange={(e) => setWpm(Number(e.target.value))}
            aria-label="Speed (WPM)"
          />
          <span>{wpm} WPM</span>
        </div>
      </div>
    </div>
  )
}
