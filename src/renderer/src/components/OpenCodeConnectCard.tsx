import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Server, Sparkles } from 'lucide-react'

/**
 * "Use what you already have."
 *
 * If OpenCode is installed on this machine, Klyro can start it, read the
 * password it printed, and use the user's own account — their free models,
 * their limits — with no key and no terminal. One click.
 */
export function OpenCodeConnectCard() {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ model: string; models: number; free: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.klyro
      .localAgentOpenCodeInstalled()
      .then((response) => setAvailable(response.installed))
      .catch(() => setAvailable(false))
  }, [])

  const connect = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await window.klyro.localAgentConnectOpenCode()
      if (!outcome.connected) {
        setError(outcome.error ?? 'Could not connect to OpenCode.')
        return
      }
      setResult({ model: outcome.model, models: outcome.models, free: outcome.free })
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  if (available !== true) return null

  if (result) {
    return (
      <div className="card opencode-card opencode-card--done">
        <div className="card__row">
          <span className="opencode-card__icon opencode-card__icon--done">
            <Check className="icon icon--sm" aria-hidden="true" />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="card__title">OpenCode is connected</div>
            <div className="card__subtitle">
              {result.models} models available ({result.free} free) · using {result.model}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card opencode-card">
      <div className="card__row" style={{ flexWrap: 'wrap' }}>
        <span className="opencode-card__icon">
          <Server className="icon icon--sm" aria-hidden="true" />
        </span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="card__title">
            Use OpenCode — no key needed
          </div>
          <div className="card__subtitle">
            OpenCode is installed here. Klyro will start it and use your own account: its free models, its
            limits, no key, no terminal.
          </div>
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => void connect()} disabled={busy}>
          {busy ? (
            <Loader2 className="icon icon--xs spin" aria-hidden="true" />
          ) : (
            <Sparkles className="icon icon--xs" aria-hidden="true" />
          )}
          <span>{busy ? 'Connecting…' : 'Connect'}</span>
        </button>
      </div>
      {error && (
        <div className="notice notice--warning" style={{ marginTop: 12 }}>
          <span className="notice__body">{error}</span>
        </div>
      )}
    </div>
  )
}
