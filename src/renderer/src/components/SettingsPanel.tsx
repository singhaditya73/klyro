import { useEffect, useState } from 'react'
import type {
  AppSettings,
  AutomationCapabilities,
  DataScope,
  DataSummary,
  PermissionState,
  ProviderId,
  ProviderStatus,
  SecurityStatus
} from '@shared/types'
import { useModal } from '../hooks/useModal'
import { Loader2, CheckCircle, CheckCircle2, AlertCircle, Shield, ShieldCheck, ShieldQuestion, HardDrive, Trash2, Download, Broom, Database, Key, Zap, X, ExternalLink } from 'lucide-react'
import KlyroMark from '../assets/logo/klyro-mark.svg'

interface Props {
  onClose: () => void
}

function formatBytesLocal(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Local per-provider request ledger: BYOK users deserve an honest counter. */
function UsageSection() {
  const [rows, setRows] = useState<Array<{ provider: string; requests: number; toolCalls: number; failures: number }>>([])

  useEffect(() => {
    void window.klyro.usageRows().then(setRows)
  }, [])

  const providerLabel = (id: string): string => id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-subtle)' }}>
      <h4>
        <Zap className="icon icon--sm" aria-hidden="true" />
        <span style={{ marginLeft: '8px' }}>Provider usage</span>
      </h4>
      <div className="muted" style={{ marginTop: '8px', fontSize: '12px' }}>
        How many model requests Klyro made on each provider's key. Counted locally, reset when you clear it. Transcription chunks are skipped for silence in listen mode, so quiet minutes cost nothing.
      </div>
      {rows.length > 0 ? (
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {rows.map((row) => (
            <div key={row.provider} className="data-row" style={{ padding: '6px 8px', fontSize: '12px', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{providerLabel(row.provider)}</span>
              <span className="pill">{row.requests} request{row.requests === 1 ? '' : 's'}</span>
              {row.toolCalls > 0 && <span className="pill">{row.toolCalls} tool call{row.toolCalls === 1 ? '' : 's'}</span>}
              {row.failures > 0 && <span className="pill">{row.failures} failed</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="muted" style={{ marginTop: '12px', fontSize: '12px' }}>No provider requests counted yet.</div>
      )}
      {rows.length > 0 && (
        <div className="data-row" style={{ marginTop: 12 }}>
          <span />
          <button className="btn btn--ghost btn--sm" onClick={() => void window.klyro.usageClear().then(() => setRows([]))}>
            <Trash2 className="icon icon--xs" aria-hidden="true" />
            <span>Reset counters</span>
          </button>
        </div>
      )}
    </div>
  )
}

/** The local "what did Klyro do" log — agent actions, MCP tool calls, meeting outputs. */
function AuditLogSection() {
  const [entries, setEntries] = useState<Array<{ at: number; kind: string; detail: string; url?: string }>>([])
  const [limit, setLimit] = useState(25)

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      void window.klyro.auditList(200).then((all) => {
        if (!cancelled) setEntries(all.slice(0, limit))
      })
    }
    load()
    const timer = window.setInterval(load, 10000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [limit])

  return (
    <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-subtle)' }}>
      <h4>
        <Shield className="icon icon--sm" aria-hidden="true" />
        <span style={{ marginLeft: '8px' }}>Audit log</span>
      </h4>
      <div className="muted" style={{ marginTop: '8px', fontSize: '12px' }}>
        Everything consequential Klyro did — agent actions, MCP tool calls, issues filed from meetings. Local only, never sent anywhere, cleared with the button below.
      </div>
      {entries.length > 0 && (
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {entries.map((entry, index) => (
            <div key={index} className="data-row" style={{ padding: '6px 8px', fontSize: '12px', gap: 8 }}>
              <span className="muted" style={{ flexShrink: 0 }}>{new Date(entry.at).toLocaleString()}</span>
              <span className="pill">{entry.kind}</span>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{entry.detail}</span>
            </div>
          ))}
        </div>
      )}
      <div className="data-row" style={{ marginTop: 12 }}>
        <span>
          {entries.length > 0
            ? `Showing last ${entries.length} event${entries.length === 1 ? '' : 's'}`
            : 'No events recorded yet.'}
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          {entries.length < limit && limit < 200 && (
            <button className="btn btn--ghost btn--sm" onClick={() => setLimit((previous) => Math.min(200, previous + 50))}>
              <span>Show more</span>
            </button>
          )}
          <button
            className="btn btn--ghost btn--sm"
            disabled={entries.length === 0}
            onClick={() =>
              void window.klyro.auditList(2000).then((all) => {
                const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const anchor = document.createElement('a')
                anchor.href = url
                anchor.download = `klyro-audit-${new Date().toISOString().slice(0, 10)}.json`
                anchor.click()
                URL.revokeObjectURL(url)
              })
            }
          >
            <Download className="icon icon--xs" aria-hidden="true" />
            <span>Export JSON</span>
          </button>
          <button
            className="btn btn--ghost btn--sm"
            disabled={entries.length === 0}
            onClick={() => {
              void window.klyro.auditClear().then(() => setEntries([]))
            }}
          >
            <Trash2 className="icon icon--xs" aria-hidden="true" />
            <span>Clear log</span>
          </button>
        </span>
      </div>
    </div>
  )
}

/** Privacy check: measures whether the overlay is excluded from captures. */
function PrivacyCheckSection() {
  const [result, setResult] = useState<{
    excluded: boolean
    changedRatio: number
    platform: string
    supported: boolean
  } | null>(null)
  const [running, setRunning] = useState(false)

  async function run(): Promise<void> {
    setRunning(true)
    try {
      setResult(await window.klyro.privacyProbeOverlay())
    } catch (error) {
      setResult({ excluded: false, changedRatio: 1, platform: 'unknown', supported: false })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ marginTop: '16px', padding: '14px 16px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-base)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Privacy check</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Captures the screen twice — once with the overlay up, once without — and compares the pixels.
          </div>
        </div>
        <button className="btn btn--sm" onClick={() => void run()} disabled={running}>
          {running ? <Loader2 className="icon icon--xs spin" aria-hidden="true" /> : <ShieldCheck className="icon icon--xs" aria-hidden="true" />}
          <span>{running ? 'Checking…' : 'Check now'}</span>
        </button>
      </div>
      {result && (
        <div
          className={`notice ${result.excluded ? 'notice--success' : 'notice--warning'}`}
          style={{ marginTop: 12 }}
        >
          {result.excluded ? (
            <CheckCircle2 className="icon icon--sm notice__icon" aria-hidden="true" />
          ) : (
            <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
          )}
          <div className="notice__body">
            {result.excluded ? (
              <>
                <strong>Verified: the overlay is excluded from screen captures on this machine.</strong>
                <div style={{ fontSize: 12, marginTop: 2 }}>
                  Only {Math.round(result.changedRatio * 100)}% of the overlay&rsquo;s area changed between the two captures — that is
                  screen noise, not the overlay. A full-screen share will not show it.
                </div>
              </>
            ) : result.supported ? (
              <>
                <strong>Not excluded on this platform.</strong>
                <div style={{ fontSize: 12, marginTop: 2 }}>
                  {Math.round(result.changedRatio * 100)}% of the overlay&rsquo;s area is present in the capture, so a full-screen share
                  would show it. Windows and macOS can exclude a window from captures; Linux/X11 has no such API.
                </div>
              </>
            ) : (
              <>
                <strong>Could not run the check.</strong>
                <div style={{ fontSize: 12, marginTop: 2 }}>
                  The overlay window was not available yet. Open the quick-ask overlay once, then run the check again.
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function SettingsPanel({ onClose }: Props) {
  const panelRef = useModal(onClose)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [permissions, setPermissions] = useState<PermissionState | null>(null)
  const [automation, setAutomation] = useState<AutomationCapabilities | null>(null)
  const [security, setSecurity] = useState<SecurityStatus | null>(null)
  const [data, setData] = useState<DataSummary | null>(null)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [reportCount, setReportCount] = useState(0)
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [justSaved, setJustSaved] = useState<string | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [displays, setDisplays] = useState<Array<{ index: number; label: string; primary: boolean; bounds: { width: number; height: number } }>>([])

  useEffect(() => {
    void (async () => {
      try {
        setVersion((await window.klyro.getAppInfo()).version)
        setSettings(await window.klyro.getSettings())
        setProviders(await window.klyro.listProviders())
        setPermissions(await window.klyro.checkPermissions())
        setAutomation(await window.klyro.getAutomationCapabilities())
        setSecurity(await window.klyro.securityStatus())
        setData(await window.klyro.dataSummary())
        setReportCount((await window.klyro.diagnosticsList()).length)
      } catch (error) {
        setLoadError((error as Error).message)
      }
    })()
  }, [])

  useEffect(() => {
    void window.klyro.screenListDisplays().then(setDisplays).catch(() => setDisplays([]))
  }, [])

  async function patch(next: Partial<AppSettings>): Promise<void> {
    const updated = await window.klyro.updateSettings(next)
    setSettings(updated)
    // The theme is applied to <html>; apply it the moment it changes so the
    // switch feels instant instead of waiting for a restart.
    if (next.theme) {
      const resolved =
        next.theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
          : next.theme
      document.documentElement.dataset.theme = resolved
    }
  }

  async function updateProviderField(id: ProviderId, field: 'baseUrl' | 'model' | 'fastModel', value: string): Promise<void> {
    if (!settings) return
    const current = settings.providers[id]
    await patch({ providers: { ...settings.providers, [id]: { ...current, [field]: value } } })
  }

  async function saveKey(id: ProviderId): Promise<void> {
    const draft = keyDrafts[id]
    if (draft === undefined) return
    setKeyError(null)
    try {
      setProviders(await window.klyro.setApiKey(id, draft))
      setKeyDrafts((prev) => ({ ...prev, [id]: '' }))
      // The draft is wiped and never re-rendered (the key is not read back from
      // the secret store), so confirm plainly that the save happened.
      setJustSaved(id)
      window.setTimeout(() => {
        setJustSaved((current) => (current === id ? null : current))
      }, 4000)
      setSecurity(await window.klyro.securityStatus())
    } catch (error) {
      setKeyError((error as Error).message)
    }
  }

  async function clearKey(id: ProviderId): Promise<void> {
    setProviders(await window.klyro.clearApiKey(id))
    setSecurity(await window.klyro.securityStatus())
  }

  async function clearScope(scope: DataScope): Promise<void> {
    setData(await window.klyro.dataClear(scope))
  }

  async function sweep(): Promise<void> {
    setData(await window.klyro.sweepStorage())
  }

  async function refreshReports(): Promise<void> {
    setReportCount((await window.klyro.diagnosticsList()).length)
  }

  async function clearReports(): Promise<void> {
    await window.klyro.diagnosticsClear()
    setReportCount(0)
  }

  async function test(id: ProviderId): Promise<void> {
    setTesting((prev) => ({ ...prev, [id]: true }))
    setTestResults((prev) => ({ ...prev, [id]: undefined as never }))
    try {
      const result = await window.klyro.testProvider(id)
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: result.ok, text: `Test connection: ${result.detail}${result.latencyMs ? ` (${result.latencyMs} ms)` : ''}` }
      }))
    } catch (error) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, text: `Test connection failed: ${(error as Error).message}` } }))
    } finally {
      // Always stop the spinner, whatever happened to the request.
      setTesting((prev) => ({ ...prev, [id]: false }))
    }
  }

  function renderSections(current: AppSettings): React.ReactNode {
    const settings = current
    return (
      <>
        <section>
          <h3 className="section-label">Providers</h3>
          <p className="muted" style={{ margin: '0 0 16px', fontSize: '13px' }}>
            Choose a provider, paste your API key, and set a model. Keys are stored encrypted on this device and never sent to the page.
          </p>
          {keyError && <div className="notice notice--error" style={{ marginBottom: '16px' }}><AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />{keyError}</div>}
          {providers.map((provider) => {
            const config = settings.providers[provider.id]
            return (
              <div key={provider.id} className={`provider-card${settings.activeProvider === provider.id ? ' provider-card--active' : ''}`}>
                <label className="provider-card__head" style={{ cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="active-provider"
                    checked={settings.activeProvider === provider.id}
                    onChange={() => void patch({ activeProvider: provider.id })}
                    style={{ accentColor: 'var(--action-primary-bg)' }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                    <strong>{provider.label}</strong>
                    {provider.hasKey ? (
                      <span className="pill pill--ok"><CheckCircle className="icon icon--xs" aria-hidden="true" />Key saved</span>
                    ) : provider.requiresKey ? (
                      <span className="pill"><AlertCircle className="icon icon--xs" aria-hidden="true" />No key</span>
                    ) : (
                      <span className="pill"><Shield className="icon icon--xs" aria-hidden="true" />No key needed</span>
                    )}
                  </div>
                </label>

                <div className="provider-card__grid">
                  <label className="field">
                    <span className="field__label">Model</span>
                    <input value={config.model} onChange={(event) => void updateProviderField(provider.id, 'model', event.target.value)} className="field" />
                  </label>
                  <label className="field">
                    <span className="field__label">Base URL</span>
                    <input value={config.baseUrl} onChange={(event) => void updateProviderField(provider.id, 'baseUrl', event.target.value)} className="field" />
                  </label>
                  <label className="field">
                    <span className="field__label">Fast model (overlay)</span>
                    <input
                      value={config.fastModel ?? ''}
                      placeholder="e.g. llama-3.3-70b-versatile"
                      onChange={(event) => void updateProviderField(provider.id, 'fastModel', event.target.value)}
                      className="field"
                    />
                    <span className="muted" style={{ fontSize: 11 }}>
                      The quick-ask overlay answers with this model, so the reply lands in under a second. Leave it
                      empty to use the main model.
                    </span>
                  </label>
                </div>

                {provider.requiresKey && (
                  <div className="provider-card__key" style={{ marginTop: '12px' }}>
                    <input
                      type="password"
                      placeholder="Paste API key&hellip;"
                      value={keyDrafts[provider.id] ?? ''}
                      onChange={(event) => setKeyDrafts((prev) => ({ ...prev, [provider.id]: event.target.value }))}
                      className="field"
                      aria-label={`${provider.keyLabel ?? provider.label} key`}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn--primary" onClick={() => void saveKey(provider.id)} disabled={(keyDrafts[provider.id] ?? '') === ''}>
                        <Key className="icon icon--sm" aria-hidden="true" />
                        <span>Save key</span>
                      </button>
                      <button className="btn btn--ghost" onClick={() => void clearKey(provider.id)}>
                        <Trash2 className="icon icon--sm" aria-hidden="true" />
                        <span>Clear</span>
                      </button>
                    </div>
                    {justSaved === provider.id && (
                      <div className="muted" style={{ marginTop: '8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle className="icon icon--xs" style={{ color: 'var(--success)' }} aria-hidden="true" />
                        Key saved in the encrypted secret store. It is never shown again — use Clear to remove it.
                      </div>
                    )}
                    {justSaved !== provider.id && !provider.hasKey && (keyDrafts[provider.id] ?? '') !== '' && (
                      <div className="muted" style={{ marginTop: '8px', fontSize: '12px' }}>Not saved yet — click “Save key”.</div>
                    )}
                  </div>
                )}

                <div className="provider-card__actions">
                  <button className="btn" onClick={() => void test(provider.id)} disabled={testing[provider.id] === true} aria-label={`Test ${provider.label} connection`}>
                    {testing[provider.id] ? (
                      <>
                        <Loader2 className="icon icon--sm" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
                        <span>Testing…</span>
                      </>
                    ) : (
                      <>
                        <Zap className="icon icon--sm" aria-hidden="true" />
                        <span>Test connection</span>
                      </>
                    )}
                  </button>
                </div>
                {testResults[provider.id] && (
                  <div className={`notice ${testResults[provider.id].ok ? 'notice--success' : 'notice--error'}`} style={{ marginTop: '8px', marginBottom: 0 }}>
                    {testResults[provider.id].ok ? (
                      <CheckCircle className="icon icon--sm notice__icon" aria-hidden="true" />
                    ) : (
                      <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
                    )}
                    <span className="notice__body">{testResults[provider.id].text}</span>
                  </div>
                )}

                {settings.activeProvider === provider.id && provider.vision === 'no' && (
                  <div className="provider-card__warning" style={{ marginTop: '12px' }}>
                    <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
                    "{config.model || 'This model'}" cannot read images, so the agent cannot run on it. Pick a vision-capable model above.
                  </div>
                )}
              </div>
            )
          })}
        </section>

        <section style={{ marginTop: '32px' }}>
          <h3 className="section-label">Assistant</h3>
          <label className="field" style={{ marginBottom: '16px' }}>
            <span className="field__label">System prompt</span>
            <textarea rows={3} value={settings.systemPrompt} onChange={(event) => void patch({ systemPrompt: event.target.value })} className="field" />
          </label>
          <div className="provider-card__grid" style={{ marginTop: '8px' }}>
            <label className="field">
              <span className="field__label">Response style</span>
              <select value={settings.responseStyle} onChange={(event) => void patch({ responseStyle: event.target.value as AppSettings['responseStyle'] })} className="field">
                <option value="concise">Concise</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Theme</span>
              <select value={settings.theme} onChange={(event) => void patch({ theme: event.target.value as AppSettings['theme'] })} className="field">
                <option value="system">System</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
          </div>
        </section>

        <section style={{ marginTop: '32px' }}>
          <h3 className="section-label">Desktop</h3>
          <label className="checkbox">
            <input type="checkbox" checked={settings.launchAtLogin} onChange={(event) => void patch({ launchAtLogin: event.target.checked })} />
            <span>Launch Klyro at login</span>
          </label>
          <label className="field" style={{ marginTop: '16px' }}>
            <span className="field__label">Quick-ask shortcut</span>
            <input value={settings.toggleShortcut} onChange={(event) => void patch({ toggleShortcut: event.target.value })} className="field" />
          </label>
          <label className="field" style={{ marginTop: '16px' }}>
            <span className="field__label">
              Overlay visibility {settings.overlayOpacity === 100 ? '— solid' : `— ${settings.overlayOpacity}% opacity`}
              {settings.overlayOpacity < 50 ? ' (very transparent: it may be hard to read while a share excludes it anyway)' : ''}
            </span>
            <input
              type="range"
              min={20}
              max={100}
              step={5}
              value={settings.overlayOpacity}
              onChange={(event) => void patch({ overlayOpacity: Number(event.target.value) })}
              className="field"
              aria-label="Overlay window opacity percentage"
            />
            <span className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              How see-through the quick-ask overlay is. Capture exclusion (Private mode) is unaffected — the overlay is hidden from shares and captures at any opacity. The top bar and the Klyro wordmark are drag handles.
            </span>
          </label>

          <h4 style={{ margin: '24px 0 12px', fontSize: '13px', fontWeight: 600 }}>Screen capture</h4>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.screenAutoCapture}
              onChange={(event) => void patch({ screenAutoCapture: event.target.checked })}
            />
            <span>
              Capture instantly — one click attaches what is on screen, with no picker
            </span>
          </label>
          <div className="muted" style={{ marginTop: '8px', fontSize: '12px', lineHeight: 1.6 }}>
            {settings.screenAutoCapture
              ? 'Klyro hides itself for the moment of the shot, captures the display below it, and attaches it to your next message. Turn this off to choose a specific screen or window instead.'
              : 'Klyro asks which screen or window to share each time. Turn this on to capture what is below the overlay in a single click.'}
            {' '}
            {permissions && (
              <span>
                System permission: <strong>{permissions.screen}</strong>
                {permissions.screen === 'denied'
                  ? ' — allow Screen Recording in your system settings, otherwise the capture comes back black or fails.'
                  : '.'}
              </span>
            )}
            {' '}On Windows and Linux the system never asks per capture. On macOS the operating system asks for Screen Recording once, and that prompt comes from the OS, not from Klyro — it cannot be skipped.
          </div>

          <label className="field" style={{ marginTop: '16px' }}>
            <span className="field__label">Overlay screen</span>
            <select
              value={String(settings.overlayDisplay)}
              onChange={(event) => {
                const raw = event.target.value
                void patch({ overlayDisplay: raw === 'primary' ? 'primary' : Number(raw) })
              }}
              className="field"
            >
              <option value="primary">Primary screen</option>
              {displays.map((display) => (
                <option key={display.index} value={String(display.index)}>
                  {display.label}
                  {display.primary ? ' (primary)' : ''} — {display.bounds.width}×{display.bounds.height}
                </option>
              ))}
            </select>
            <span className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              With two screens, put the overlay on the one you are <em>not</em> sharing: the meeting cannot show
              what is not in the shared framebuffer, and no capture trick is needed.
            </span>
          </label>

          <PrivacyCheckSection />

          <label className="checkbox" style={{ marginTop: '16px' }}>
            <input
              type="checkbox"
              checked={settings.overlayAnswerCache}
              onChange={(event) => void patch({ overlayAnswerCache: event.target.checked })}
            />
            <span>Instant replay — answer the same question about the same screen instantly</span>
          </label>
          <div className="muted" style={{ marginTop: '6px', fontSize: 12, lineHeight: 1.6 }}>
            When you ask the same thing twice about an unchanged screen, Klyro replays the answer instead of
            asking the model again. The cache expires after 15 minutes and is stored locally.
          </div>

          <label className="checkbox" style={{ marginTop: '16px' }}>
            <input
              type="checkbox"
              checked={settings.screenPreWarm}
              onChange={(event) => void patch({ screenPreWarm: event.target.checked })}
            />
            <span>Ask for screen permission at launch, not mid-meeting</span>
          </label>
          <div className="muted" style={{ marginTop: '6px', fontSize: 12, lineHeight: 1.6 }}>
            On macOS the system raises a one-time Screen Recording prompt the first time anything captures the
            screen. Klyro asks for it when it starts, so you answer it before a call instead of while everyone
            is watching. Windows never asks per capture, and on Linux this is left off (a portal dialog at
            launch would be worse than a dialog later).
          </div>

          {permissions && (
            <div className="permissions-section" style={{ marginTop: '16px' }}>
              <h4>Permissions</h4>
              <div className="permissions-section__row">
                <span>Microphone</span>
                <strong>{permissions.microphone}</strong>
              </div>
              <div className="permissions-section__row">
                <span>Screen</span>
                <strong>{permissions.screen}</strong>
              </div>
              <div className="permissions-section__row">
                <span>Accessibility</span>
                <strong>{permissions.accessibility}</strong>
              </div>
              {permissions.notes.map((note, index) => (
                <div key={index} className="muted" style={{ fontSize: '12px' }}>{note}</div>
              ))}
            </div>
          )}

          <h4 style={{ margin: '24px 0 12px', fontSize: '13px', fontWeight: 600 }}>Desktop agent</h4>
          <label className="checkbox">
            <input type="checkbox" checked={settings.agentConfirmConsequential} onChange={(event) => void patch({ agentConfirmConsequential: event.target.checked })} />
            <span>Ask before clicks, typing, and other state-changing actions</span>
          </label>
          <label className="field" style={{ marginTop: '12px' }}>
            <span className="field__label">Max steps per task</span>
            <input type="number" min={1} max={30} value={settings.agentMaxSteps} onChange={(event) => void patch({ agentMaxSteps: Number(event.target.value) || 1 })} className="field" />
          </label>

          <h4 style={{ margin: '24px 0 12px', fontSize: '13px', fontWeight: 600 }}>Tools in chat</h4>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.chatMcpTools}
              onChange={(event) => void patch({ chatMcpTools: event.target.checked })}
            />
            <span>Let chat call MCP server tools (each call asks Allow / Deny first)</span>
          </label>
          <div className="muted" style={{ marginTop: '8px', fontSize: '12px' }}>
            Configure servers under Integrations → MCP servers. Every approved call is audited locally; nothing runs without your explicit answer.
          </div>

          {automation && (
            <div className="permissions-section" style={{ marginTop: '16px' }}>
              <h4>Automation backend</h4>
              <div className="permissions-section__row">
                <span>Status</span>
                <strong>{automation.available ? `ready (${automation.backends.join(', ')})` : 'unavailable'}</strong>
              </div>
              {automation.missing.length && <div className="muted" style={{ fontSize: '12px' }}><strong>Missing:</strong> {automation.missing.join(', ')}</div>}
              {automation.installHint && (
                <div className="muted" style={{ fontSize: '12px' }}>
                  Install: <code className="agent-panel__code">{automation.installHint}</code>
                </div>
              )}
              {automation.limitations.map((note, index) => (
                <div key={index} className="muted" style={{ fontSize: '12px' }}>{note}</div>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: '32px' }}>
          <h3 className="section-label">Memory & knowledge</h3>
          <p className="muted" style={{ margin: '0 0 16px', fontSize: '13px', lineHeight: 1.5 }}>
            Everything here is stored locally on this device. Memories and document excerpts relevant to your question are added to the prompt automatically.
          </p>
          <label className="checkbox">
            <input type="checkbox" checked={settings.memoryEnabled} onChange={(event) => void patch({ memoryEnabled: event.target.checked })} />
            <span>Use remembered facts to ground answers</span>
          </label>
          <label className="checkbox" style={{ marginTop: '12px' }}>
            <input type="checkbox" checked={settings.memoryAutoExtract} onChange={(event) => void patch({ memoryAutoExtract: event.target.checked })} />
            <span>Learn durable facts from conversations automatically</span>
          </label>
          <div className="provider-card__grid" style={{ marginTop: '16px' }}>
            <label className="field">
              <span className="field__label">Memories per answer</span>
              <input type="number" min={1} max={20} value={settings.memoryRecallCount} onChange={(event) => void patch({ memoryRecallCount: Number(event.target.value) || 1 })} className="field" />
            </label>
            <label className="field">
              <span className="field__label">Document excerpts per answer</span>
              <input type="number" min={1} max={10} value={settings.documentRecallCount} onChange={(event) => void patch({ documentRecallCount: Number(event.target.value) || 1 })} className="field" />
            </label>
          </div>
          <label className="checkbox" style={{ marginTop: '16px' }}>
            <input type="checkbox" checked={settings.knowledgeEnabled} onChange={(event) => void patch({ knowledgeEnabled: event.target.checked })} />
            <span>Use local documents to ground answers</span>
          </label>
        </section>

        <section style={{ marginTop: '32px' }}>
          <h3 className="section-label">Security & data</h3>
          {security && (
            <div className="permissions-section" style={{ marginBottom: '24px' }}>
              <h4>
                <Shield className="icon icon--sm" aria-hidden="true" />
                <span style={{ marginLeft: '8px' }}>Credential storage</span>
              </h4>
              <div className="permissions-section__row">
                <span>OS keychain</span>
                <strong>{security.encryptionAvailable ? 'available (keys encrypted)' : 'unavailable'}</strong>
              </div>
              {security.hasPlaintextSecrets && (
                <div className="muted" style={{ fontSize: '12px', marginTop: '8px' }}>
                  Some saved keys are stored unencrypted on disk. Install a keyring (gnome-keyring / kwallet) to protect them, then re-save the key.
                </div>
              )}
              {!security.encryptionAvailable && (
                <label className="checkbox" style={{ marginTop: '12px' }}>
                  <input type="checkbox" checked={settings.allowUnencryptedSecrets} onChange={(event) => void patch({ allowUnencryptedSecrets: event.target.checked })} />
                  <span>Allow storing API keys unencrypted on this device (not recommended)</span>
                </label>
              )}
            </div>
          )}

          {data && (
            <div className="permissions-section" style={{ marginBottom: '24px' }}>
              <h4>
                <Database className="icon icon--sm" aria-hidden="true" />
                <span style={{ marginLeft: '8px' }}>What is stored</span>
              </h4>
              <p className="muted" style={{ margin: '8px 0 16px', fontSize: '12px', lineHeight: 1.5 }}>
                {data.activeProviderIsLocal
                  ? `Your active provider (${data.activeProvider}) runs on this device. Prompts are not sent to a third party.`
                  : `Your active provider (${data.activeProvider}) is a remote service: questions, attachments, and any retrieved excerpts relevant to them are sent to it.`}
              </p>
              <div className="data-row">
                <span>Conversations: {data.conversations}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => void clearScope('conversations')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="data-row">
                <span>Memories: {data.memories}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => void clearScope('memory')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="data-row">
                <span>Documents: {data.documents}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => void clearScope('documents')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="data-row">
                <span>Meetings: {data.meetings}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => void clearScope('meetings')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="data-row">
                <span>Agent task history: {data.agentTasks}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => void clearScope('agentTasks')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="muted" style={{ marginTop: '12px', fontSize: '12px' }}>
                Saved credentials: {data.credentials}. Credentials are removed from Providers above. Screenshots are captured on demand and never written to disk.
              </div>

              <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-subtle)' }}>
                <h4>
                  <HardDrive className="icon icon--sm" aria-hidden="true" />
                  <span style={{ marginLeft: '8px' }}>Storage on this device</span>
                </h4>
                <div className="data-row">
                  <span>
                    Klyro data: {formatBytesLocal(data.storage.dataBytes)} ({data.storage.dataFiles} files)
                    {data.storage.backupFiles > 0 ? ` &middot; edit backups: ${formatBytesLocal(data.storage.backupBytes)}` : ''}
                  </span>
                  <button className="btn btn--ghost btn--sm" onClick={() => void sweep()}>
                    <Broom className="icon icon--xs" aria-hidden="true" />
                    <span>Clean up</span>
                  </button>
                </div>
                {data.storage.lastSweep && (
                  <div className="muted" style={{ marginTop: '12px', fontSize: '12px' }}>
                    Removed {data.storage.lastSweep.removedTempFiles} unfinished write(s) and {data.storage.lastSweep.removedBackups} stale backup(s), freeing {formatBytesLocal(data.storage.lastSweep.freedBytes)}.
                  </div>
                )}
                {data.storage.quarantined.length > 0 && (
                  <div className="notice notice--warning" style={{ marginTop: '12px' }}>
                    <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
                    {data.storage.quarantined.length} unreadable data file{data.storage.quarantined.length === 1 ? '' : 's'} kept beside your data (name contains &ldquo;.corrupt-&rdquo;). Klyro started fresh rather than overwriting them.
                  </div>
                )}
              </div>

              <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-subtle)' }}>
                <h4>
                  <ShieldQuestion className="icon icon--sm" aria-hidden="true" />
                  <span style={{ marginLeft: '8px' }}>Crash reports</span>
                </h4>
                <label className="field" style={{ marginTop: '12px', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={settings.diagnosticsOptIn}
                    onChange={(event) => {
                      void patch({ diagnosticsOptIn: event.target.checked }).then(() => void refreshReports())
                    }}
                  />
                  <span>Save crash reports on this device</span>
                </label>
                <div className="muted" style={{ marginTop: '8px', fontSize: '12px' }}>
                  {settings.diagnosticsOptIn
                    ? 'Reports are written locally to the Klyro data folder and are only sent anywhere if an endpoint is explicitly configured. They contain a redacted error and app version — never your API keys.'
                    : 'Off (default). Crashes are logged but nothing is stored or sent.'}
                </div>
                {reportCount > 0 && (
                  <div className="data-row">
                    <span>Saved crash reports: {reportCount}</span>
                    <button className="btn btn--ghost btn--sm" onClick={() => void clearReports()}>
                      <Trash2 className="icon icon--xs" aria-hidden="true" />
                      <span>Clear</span>
                    </button>
                  </div>
                )}
              </div>

              <UsageSection />
              <AuditLogSection />
            </div>
          )}
        </section>

        <section style={{ marginTop: '32px' }}>
          <h3 className="section-label">About</h3>
          <div className="card">
            <div className="card__row">
              <img src={KlyroMark} alt="" style={{ width: 40, height: 40 }} aria-hidden="true" />
              <div>
                <div style={{ fontWeight: 600, fontSize: '15px' }}>Klyro</div>
                <div className="muted" style={{ fontSize: '12px', marginTop: '2px' }}>Your AI. Your entire computer.</div>
                <div className="muted" style={{ fontSize: '11px', marginTop: '4px' }}>{version ? `Version ${version}` : 'Version…'}</div>
              </div>
            </div>
            <div className="card__text muted" style={{ marginTop: '12px', fontSize: '12px', lineHeight: 1.6 }}>
              Klyro is a local-first AI desktop assistant. Your data stays on your device unless you choose to send it to a remote provider.
              <br /><br />
              <ExternalLink className="icon icon--xs" aria-hidden="true" />
              <a href="https://github.com/singhaditya73/klyro" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)' }}>View on GitHub</a>
            </div>
          </div>
        </section>
      </>
    )
  }

  return (
    <div className="modal">
      <div className="modal__panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}>
        <div className="modal__head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src={KlyroMark} alt="" style={{ width: 24, height: 24 }} aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>Settings</h2>
          </div>
          <button className="btn btn--icon btn--icon-sm btn--ghost" aria-label="Close settings" onClick={onClose}>
            <X className="icon icon--sm" aria-hidden="true" />
          </button>
        </div>

        <div className="modal__body">
          {loadError ? (
            <div className="notice notice--error"><AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />{loadError}</div>
          ) : settings ? (
            renderSections(settings)
          ) : (
            <div className="muted" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <Loader2 className="icon icon--lg" style={{ animation: 'spin 1s linear infinite', marginBottom: '12px' }} aria-hidden="true" />
              <div>Loading settings&hellip;</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}