import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound, RefreshCw, Smartphone, X } from 'lucide-react'
import QRCode from 'qrcode'

/**
 * The Ghost Phone link, and the two things that matter about it: how the phone
 * gets in, and how to hide the laptop behind it.
 *
 * The QR and the code are the *only* way in — the address itself carries no
 * secret, so a link that leaks (history, a screenshot, a chat message) reveals
 * nothing. The code is one device, ten minutes; the QR holds it in the URL
 * fragment, which browsers never send to the server.
 */
export function GhostPhoneModal({
  url,
  pairingCode,
  expiresAt,
  copied,
  onClose,
  onCopy,
  onHide,
  onNewCode
}: {
  url: string
  pairingCode?: string | null
  expiresAt?: number | null
  copied: boolean
  onClose: () => void
  onCopy: () => void
  onHide: () => void
  onNewCode: () => void
}): React.ReactNode {
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    if (!pairingCode) {
      setQr(null)
      return
    }
    let live = true
    // The fragment is the secret: scanners get it, the network never does.
    void QRCode.toDataURL(`${url}#p=${pairingCode}`, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b0d10', light: '#ffffff' }
    })
      .then((data) => {
        if (live) setQr(data)
      })
      .catch(() => {
        if (live) setQr(null)
      })
    return () => {
      live = false
    }
  }, [url, pairingCode])

  const minutesLeft =
    expiresAt === null || expiresAt === undefined
      ? null
      : Math.max(0, Math.ceil((expiresAt - Date.now()) / 60_000))

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

      <div className="overlay__pairing">
        {pairingCode ? (
          <>
            {qr && <img className="overlay__pairing-qr" src={qr} alt="Pairing QR code" />}
            <div className="overlay__pairing-code">
              <KeyRound className="icon icon--xs" aria-hidden="true" />
              <span className="overlay__pairing-digits">{pairingCode}</span>
            </div>
            <p className="overlay__hud-modal-desc">
              Scan the code, or type the six digits on the phone. It works once
              {minutesLeft === null ? '' : ` and expires in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}`}.
              Only this device is paired; show a new code for another one.
            </p>
            <button type="button" className="btn btn--quiet btn--xs" onClick={onNewCode}>
              <RefreshCw className="icon icon--xs" aria-hidden="true" />
              <span>New code</span>
            </button>
          </>
        ) : (
          <p className="overlay__hud-modal-desc">
            A device is paired. Show a new code to pair another phone or tablet.
          </p>
        )}
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
