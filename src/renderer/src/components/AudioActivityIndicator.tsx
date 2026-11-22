import React from 'react'

interface Props {
  active?: boolean
  micEnergy?: number
  sysEnergy?: number
  source?: string
  className?: string
}

/**
 * Live audio activity indicator with dynamic reactive waveform bars
 * and dual-channel (Mic vs System Loopback / Attendee) feedback.
 */
export function AudioActivityIndicator({
  active = false,
  micEnergy = 0,
  sysEnergy = 0,
  source,
  className = ''
}: Props): React.JSX.Element {
  // Clamp energies to 0..1 range
  const micLevel = Math.min(Math.max(micEnergy, 0), 1)
  const sysLevel = Math.min(Math.max(sysEnergy, 0), 1)
  const dominantEnergy = Math.max(micLevel, sysLevel)

  // Determine bar heights based on live energy
  // If active but low energy, maintain a gentle resting baseline
  const baseScale = active ? 0.25 : 0.1
  const b1 = Math.min(1, baseScale + dominantEnergy * 0.9)
  const b2 = Math.min(1, baseScale + dominantEnergy * 1.3)
  const b3 = Math.min(1, baseScale + dominantEnergy * 0.7)
  const b4 = Math.min(1, baseScale + dominantEnergy * 1.1)
  const b5 = Math.min(1, baseScale + dominantEnergy * 0.6)

  const isAttendeeSpeaking = sysLevel > micLevel && sysLevel > 0.03
  const isUserSpeaking = micLevel >= sysLevel && micLevel > 0.03

  return (
    <div
      className={`audio-activity-indicator ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 'var(--radius-pill)',
        background: active ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
        border: active ? '1px solid var(--border-default)' : '1px solid transparent',
        transition: 'all 150ms ease'
      }}
      title={
        isAttendeeSpeaking
          ? 'Attendee voice detected on system audio'
          : isUserSpeaking
            ? 'Microphone voice detected'
            : active
              ? 'Audio monitoring active'
              : 'Audio idle'
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2.5,
          height: 14,
          padding: '0 2px'
        }}
        aria-hidden="true"
      >
        {[b1, b2, b3, b4, b5].map((scale, i) => (
          <span
            key={i}
            style={{
              width: 3,
              height: 14,
              borderRadius: 2,
              background: isAttendeeSpeaking
                ? 'var(--info)'
                : isUserSpeaking
                  ? 'var(--accent)'
                  : active
                    ? 'var(--status-ok)'
                    : 'var(--text-disabled)',
              transform: `scaleY(${Math.max(0.2, scale)})`,
              transformOrigin: 'bottom',
              transition: 'transform 80ms cubic-bezier(0.16, 1, 0.3, 1), background-color 200ms ease',
              display: 'inline-block'
            }}
          />
        ))}
      </div>

      {active && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: isAttendeeSpeaking
              ? 'var(--info)'
              : isUserSpeaking
                ? 'var(--accent)'
                : 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {isAttendeeSpeaking ? 'Attendee' : isUserSpeaking ? 'You' : source || 'Live'}
        </span>
      )}
    </div>
  )
}
