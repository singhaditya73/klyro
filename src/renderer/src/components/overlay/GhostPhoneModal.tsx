import { Check, Copy, Smartphone, X } from 'lucide-react'

/**
 * The Ghost Phone link, and the two things that matter about it: whether the
 * address is reachable from the phone, and how to hide the laptop behind it.
 */
export function GhostPhoneModal({
  url,
  copied,
  onClose,
  onCopy,
  onHide
}: {
  url: string
  copied: boolean
  onClose: () => void
  onCopy: () => void
  onHide: () => void
}): React.ReactNode {
  return (
    <div className="overlay__hud-modal">
      <div className="overlay__hud-modal-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Smartphone className="icon icon--xs" style={{ color: 'var(--accent)' }} />
          <strong>Ghost Phone Remote Mirror</strong>
        </div>
        <button type="button" className="btn btn--icon btn--icon-xs btn--ghost" onClick={onClose}>
          <X className="icon icon--xs" />
        </button>
      </div>
      <p className="overlay__hud-modal-desc">
        Open this on your phone or tablet propped below your screen for <strong>zero laptop windows</strong>:
      </p>
      <div className="overlay__hud-modal-link">
        <code>{url}</code>
        <button type="button" className="btn btn--quiet btn--xs" onClick={onCopy}>
          {copied ? (
            <>
              <Check className="icon icon--xs" aria-hidden="true" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="icon icon--xs" aria-hidden="true" />
              <span>Copy Link</span>
            </>
          )}
        </button>
      </div>
      {url.includes('127.0.0.1') && (
        <p className="overlay__hud-modal-desc">
          This address only works on this computer. To open the HUD on your phone, turn on
          “Ghost Phone on local network” in Settings, then stop and restart Ghost Phone.
        </p>
      )}
      <div className="overlay__hud-modal-actions">
        <button
          type="button"
          className="btn btn--primary btn--xs"
          onClick={onHide}
          title="Hide overlay now. Live answers continue streaming to your phone."
        >
          Hide Laptop Screen (Pure Phone Mode)
        </button>
      </div>
    </div>
  )
}
