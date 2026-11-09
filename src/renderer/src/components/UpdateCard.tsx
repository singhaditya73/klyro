import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, RotateCw } from 'lucide-react'
import type { UpdateStatus } from '@shared/types'
import { Hint } from './ui'

/**
 * Updates, as three visible steps: *check*, *download*, *restart*.
 *
 * Nothing happens without a click. The card also explains the cases where an
 * update cannot happen at all — a development build, a .deb (the package
 * manager owns the files), or a machine with Airgap Shield on — instead of
 * showing a reassuring "up to date" that would be a lie.
 */
export function UpdateCard(): React.ReactNode {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void window.klyro
      .updateStatus?.()
      .then((next) => {
        if (live) setStatus(next)
      })
      .catch(() => undefined)
    const off = window.klyro.onUpdateStatus?.((next) => setStatus(next))
    return () => {
      live = false
      off?.()
    }
  }, [])

  async function act(step: 'check' | 'download'): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const next = step === 'check' ? await window.klyro.updateCheck() : await window.klyro.updateDownload()
      setStatus(next)
    } catch (error) {
      setStatus({
        phase: 'error',
        currentVersion: status?.currentVersion ?? '',
        message: (error as Error).message
      })
    } finally {
      setBusy(false)
    }
  }

  const phase = status?.phase ?? 'idle'
  const version = status?.version

  return (
    <div className="update-card">
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        {phase === 'checking' || phase === 'downloading' ? (
          <Loader2 className="icon icon--sm spin" aria-hidden="true" />
        ) : phase === 'ready' || phase === 'up-to-date' ? (
          <CheckCircle2 className="icon icon--sm" aria-hidden="true" />
        ) : phase === 'error' ? (
          <AlertCircle className="icon icon--sm" aria-hidden="true" />
        ) : (
          <Download className="icon icon--sm" aria-hidden="true" />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>
            {phase === 'idle' && 'Updates'}
            {phase === 'checking' && 'Checking for updates…'}
            {phase === 'available' && `Version ${version ?? 'newer'} is available`}
            {phase === 'downloading' && `Downloading… ${status?.percent ?? 0}%`}
            {phase === 'ready' && `Version ${version ?? 'newer'} is ready`}
            {phase === 'up-to-date' && 'Klyro is up to date'}
            {phase === 'error' && 'The update check failed'}
            {phase === 'unsupported' && 'This install updates by hand'}
          </div>
          <Hint>
            {phase === 'available' && 'Download it now; it installs only when you restart.'}
            {phase === 'downloading' && 'The download runs in the background. You can keep working.'}
            {phase === 'ready' && 'Restart to finish installing. Your settings and data are kept.'}
            {phase === 'up-to-date' && `Version ${status?.currentVersion ?? ''} is the newest release.`}
            {phase === 'idle' && `Version ${status?.currentVersion ?? '…'}. Klyro checks once per launch, only when you allow it.`}
            {(phase === 'error' || phase === 'unsupported') && (status?.message ?? '')}
          </Hint>
        </div>
        {phase === 'available' && (
          <button className="btn btn--primary btn--sm" onClick={() => void act('download')} disabled={busy}>
            <Download className="icon icon--xs" aria-hidden="true" />
            <span>Download</span>
          </button>
        )}
        {phase === 'ready' && (
          <button className="btn btn--primary btn--sm" onClick={() => void window.klyro.updateInstall()}>
            <RotateCw className="icon icon--xs" aria-hidden="true" />
            <span>Restart now</span>
          </button>
        )}
        {(phase === 'idle' || phase === 'up-to-date' || phase === 'error') && (
          <button className="btn btn--quiet btn--sm" onClick={() => void act('check')} disabled={busy}>
            <RefreshCw className="icon icon--xs" aria-hidden="true" />
            <span>Check now</span>
          </button>
        )}
      </div>
      {phase === 'downloading' && (
        <div
          className="update-card__bar"
          role="progressbar"
          aria-valuenow={status?.percent ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="update-card__fill" style={{ width: `${status?.percent ?? 0}%` }} />
        </div>
      )}
    </div>
  )
}
