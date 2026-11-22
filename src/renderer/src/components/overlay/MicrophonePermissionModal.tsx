import { useState } from 'react'
import { AlertCircle, ExternalLink, Mic, X } from 'lucide-react'

export function MicrophonePermissionModal({
  onClose,
  onRetry
}: {
  onClose: () => void
  onRetry?: () => void
}): React.ReactNode {
  const [opening, setOpening] = useState(false)
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

  const handleOpenSettings = async (): Promise<void> => {
    setOpening(true)
    try {
      await window.klyro.openMicrophoneSettings?.()
    } finally {
      setTimeout(() => setOpening(false), 1000)
    }
  }

  return (
    <div className="overlay__mic-modal" role="dialog" aria-modal="true" aria-labelledby="mic-modal-title">
      <div className="overlay__mic-modal-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="overlay__mic-modal-badge">
            <Mic className="icon icon--sm" style={{ color: 'var(--accent)' }} aria-hidden="true" />
          </div>
          <div>
            <h3 id="mic-modal-title" className="overlay__mic-modal-title">
              Microphone Permission Required
            </h3>
            <span className="overlay__mic-modal-sub">OS privacy controls blocked audio recording</span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--icon btn--icon-xs btn--ghost"
          onClick={onClose}
          aria-label="Close modal"
        >
          <X className="icon icon--xs" aria-hidden="true" />
        </button>
      </div>

      <div className="overlay__mic-modal-body">
        <p className="overlay__mic-modal-p">
          To record audio snippets or listen to live meetings, Klyro needs permission to access your microphone.
        </p>

        <div className="overlay__mic-modal-box">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <AlertCircle className="icon icon--xs" style={{ color: '#fb923c', marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
            <div style={{ fontSize: 12, lineHeight: 1.5, color: '#e2e8f0' }}>
              <strong>{isMac ? 'How to enable on macOS:' : 'How to enable on Windows:'}</strong>
              <ol style={{ margin: '6px 0 0 16px', padding: 0 }}>
                {isMac ? (
                  <>
                    <li>Click <strong>Open System Settings</strong> below.</li>
                    <li>Find <strong>Klyro</strong> under Privacy &amp; Security → Microphone.</li>
                    <li>Toggle the switch to <strong>On</strong>.</li>
                  </>
                ) : (
                  <>
                    <li>Click <strong>Open Settings</strong> below.</li>
                    <li>Turn <strong>Microphone access</strong> to <strong>On</strong>.</li>
                    <li>Scroll down and turn <strong>Let desktop apps access your microphone</strong> to <strong>On</strong>.</li>
                  </>
                )}
              </ol>
            </div>
          </div>
        </div>
      </div>

      <div className="overlay__mic-modal-footer">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => void handleOpenSettings()}
          disabled={opening}
        >
          <ExternalLink className="icon icon--xs" aria-hidden="true" />
          <span>{opening ? 'Opening Settings…' : isMac ? 'Open System Settings' : 'Open Windows Settings'}</span>
        </button>
        {onRetry && (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => {
              onClose()
              onRetry()
            }}
          >
            Try Again
          </button>
        )}
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={onClose}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
