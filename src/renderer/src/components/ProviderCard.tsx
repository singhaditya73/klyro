import { useState } from 'react'
import { AlertCircle, CheckCircle, CheckCircle2, Key, Loader2, Trash2, Zap } from 'lucide-react'
import type { AppSettings, ProviderId, ProviderStatus } from '@shared/types'
import { ModelPicker } from './ModelPicker'
import { Badge, Hint } from './ui'
import { type CliInfo, type LocalAgentInfo, type ProviderHealth, providerState } from '../lib/providers'

/**
 * One provider, with everything needed to use it.
 *
 * The card is honest about state: a key that is saved, a service that
 * answered, a test that passed. Secrets are never read back — the field is
 * cleared after saving, and only the fact that a key exists is shown.
 *
 * The common case is one row: the provider, its state, the model it answers
 * with. The key and the endpoint are one click away, because a page of ten
 * expanded forms is a page nobody reads.
 */

interface Props {
  provider: ProviderStatus
  settings: AppSettings
  agents: LocalAgentInfo[]
  clis: CliInfo[]
  /** What a direct probe of the provider found. */
  health?: ProviderHealth
  onSettings: (next: Partial<AppSettings>) => Promise<void>
  onProviderField: (id: ProviderId, field: 'baseUrl' | 'model' | 'fastModel', value: string) => Promise<void>
  onSaved: () => void
}

export function ProviderCard({ provider, settings, agents, clis, health, onSettings, onProviderField, onSaved }: Props): React.ReactNode {
  const config = settings.providers[provider.id]
  const [draft, setDraft] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  const state = providerState(provider, agents, clis, health)
  const isActive = settings.activeProvider === provider.id
  const wantsKey = provider.requiresKey || provider.keyOptional

  async function saveKey(): Promise<void> {
    if (!draft.trim()) return
    setKeyError(null)
    try {
      await window.klyro.setApiKey(provider.id, draft.trim())
      setDraft('')
      setJustSaved(true)
      setShowKey(false)
      window.setTimeout(() => setJustSaved(false), 4000)
      onSaved()
    } catch (error) {
      setKeyError((error as Error).message)
    }
  }

  async function clearKey(): Promise<void> {
    await window.klyro.clearApiKey(provider.id)
    onSaved()
  }

  async function test(): Promise<void> {
    setTesting(true)
    setResult(null)
    try {
      const outcome = await window.klyro.testProvider(provider.id)
      setResult({
        ok: outcome.ok,
        text: `${outcome.detail}${outcome.latencyMs ? ` (${outcome.latencyMs} ms)` : ''}`
      })
    } catch (error) {
      setResult({ ok: false, text: (error as Error).message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={`provider-card${isActive ? ' provider-card--active' : ''}`}>
      <div className="provider-card__head">
        <label className="row" style={{ cursor: 'pointer', gap: 10, flex: 1, minWidth: 0 }}>
          <input
            type="radio"
            name="active-provider"
            checked={isActive}
            onChange={() => void onSettings({ activeProvider: provider.id })}
            aria-label={`Use ${provider.label}`}
          />
          <span className="list__title">
            {provider.label}
            {isActive && <Badge tone="accent">In use</Badge>}
          </span>
        </label>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          <Badge tone={state.tone === 'ok' ? 'ok' : state.tone === 'warn' ? 'warn' : 'idle'}>{state.label}</Badge>
          <button
            className="btn btn--sm"
            onClick={() => void test()}
            disabled={testing}
            aria-label={`Test the ${provider.label} connection`}
          >
            {testing ? (
              <Loader2 className="icon icon--xs spin" aria-hidden="true" />
            ) : (
              <Zap className="icon icon--xs" aria-hidden="true" />
            )}
            <span>{testing ? 'Testing…' : 'Test'}</span>
          </button>
          {wantsKey && (
            <button className="btn btn--ghost btn--sm" onClick={() => setShowKey((open) => !open)}>
              <Key className="icon icon--xs" aria-hidden="true" />
              <span>{provider.hasKey ? 'Change key' : 'Add key'}</span>
            </button>
          )}
          <button className="btn btn--quiet btn--sm" onClick={() => setAdvanced((open) => !open)}>
            {advanced ? 'Hide advanced' : 'Advanced'}
          </button>
        </div>
      </div>

      {result && (
        <div className={`notice ${result.ok ? 'notice--success' : 'notice--error'}`} style={{ marginTop: 10 }}>
          {result.ok ? (
            <CheckCircle2 className="icon icon--sm notice__icon" aria-hidden="true" />
          ) : (
            <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
          )}
          <span className="notice__body">{result.text}</span>
        </div>
      )}

      {justSaved && (
        <div className="row hint" style={{ gap: 6, marginTop: 8, color: 'var(--success)' }}>
          <CheckCircle className="icon icon--xs" aria-hidden="true" />
          Key saved in the encrypted store. It is never shown again.
        </div>
      )}

      <div className="provider-card__grid" style={{ marginTop: 12 }}>
        <label className="field">
          <span className="field__label">Model</span>
          <ModelPicker
            providerId={provider.id}
            value={config.model}
            providerLabel={provider.label}
            onChange={(model) => void onProviderField(provider.id, 'model', model)}
          />
        </label>
        <label className="field">
          <span className="field__label">Fast model — the overlay</span>
          <ModelPicker
            providerId={provider.id}
            value={config.fastModel ?? ''}
            providerLabel={provider.label}
            onChange={(model) => void onProviderField(provider.id, 'fastModel', model)}
          />
        </label>
      </div>

      {showKey && wantsKey && (
        <div className="provider-card__key" style={{ marginTop: 12 }}>
          <label className="field">
            <span className="field__label">{provider.keyLabel ?? `${provider.label} key`}</span>
            <input
              type="password"
              placeholder={provider.requiresKey ? 'Paste the key…' : 'Optional — only if the server asks for one'}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveKey()
              }}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--sm" onClick={() => void saveKey()} disabled={!draft.trim()}>
              <Key className="icon icon--xs" aria-hidden="true" />
              <span>Save</span>
            </button>
            <button className="btn btn--quiet btn--sm" onClick={() => setShowKey(false)}>
              <span>Cancel</span>
            </button>
            {provider.hasKey && (
              <button className="btn btn--danger-quiet btn--sm" onClick={() => void clearKey()}>
                <Trash2 className="icon icon--xs" aria-hidden="true" />
                <span>Remove saved key</span>
              </button>
            )}
          </div>
          {keyError && (
            <div className="notice notice--error" style={{ marginTop: 8 }}>
              <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
              {keyError}
            </div>
          )}
        </div>
      )}

      {advanced && (
        <label className="field" style={{ marginTop: 12 }}>
          <span className="field__label">Base URL</span>
          <input
            value={config.baseUrl}
            onChange={(event) => void onProviderField(provider.id, 'baseUrl', event.target.value)}
            spellCheck={false}
            className="provider__key"
          />
          <Hint>The endpoint Klyro talks to. Leave it alone unless you are pointing at your own server.</Hint>
        </label>
      )}

      {isActive && provider.vision === 'no' && (
        <div className="provider-card__warning">
          <AlertCircle className="icon icon--sm" aria-hidden="true" />
          “{config.model || 'This model'}” cannot read images, so a question about the screen cannot be answered by it.
        </div>
      )}
    </div>
  )
}
