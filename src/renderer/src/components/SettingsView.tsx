import { useCallback, useEffect, useState } from 'react'
import {
  Brain,
  Cpu,
  Database,
  Download,
  HardDrive,
  Keyboard,
  Monitor,
  Shield,
  Sparkles,
  Trash2,
  Zap,
  Loader2,
  AlertCircle,
  CheckCircle2
} from 'lucide-react'
import type { AppSettings, PermissionState, ProviderStatus } from '@shared/types'
import { Badge, Group, Hint, PageHeader, SettingRow, StatusDot } from './ui'
import { providerState } from '../lib/providers'
import type { Route } from '../hooks/useHashRoute'

/**
 * Settings.
 *
 * Grouped by what a setting changes, not by which part of the code owns it:
 * the assistant, the desktop, the screen and the microphone, what Klyro knows,
 * what it keeps, the providers, and the diagnostics. Each group says in one
 * line what the setting does, because most of them change what leaves the
 * machine.
 */

type Section = 'assistant' | 'desktop' | 'screen' | 'knowledge' | 'history' | 'providers' | 'usage'

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Sparkles }> = [
  { id: 'assistant', label: 'Assistant', icon: Sparkles },
  { id: 'desktop', label: 'Desktop', icon: Keyboard },
  { id: 'screen', label: 'Screen & Audio', icon: Monitor },
  { id: 'knowledge', label: 'Knowledge & Memory', icon: Brain },
  { id: 'history', label: 'History & Retention', icon: Database },
  { id: 'providers', label: 'Providers & Agents', icon: Cpu },
  { id: 'usage', label: 'Usage & Diagnostics', icon: Zap }
]

/** Local per-provider request ledger: BYOK users deserve an honest counter. */
function UsageSection(): React.ReactNode {
  const [rows, setRows] = useState<Array<{ provider: string; requests: number; toolCalls: number; failures: number }>>([])

  useEffect(() => {
    void window.klyro.usageRows().then(setRows)
  }, [])

  const providerLabel = (id: string): string => id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <Group
      title="Provider usage"
      description="How many model requests Klyro made on each provider's key. Counted locally, reset when you clear it. Transcription chunks are skipped for silence in listen mode, so quiet minutes cost nothing."
      icon={Zap}
    >
      {rows.length > 0 ? (
        <>
          <div className="list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {rows.map((row) => (
              <div key={row.provider} className="list__row">
                <div className="list__main">
                  <div className="list__title">{providerLabel(row.provider)}</div>
                </div>
                <div className="list__actions">
                  <Badge>{row.requests} request{row.requests === 1 ? '' : 's'}</Badge>
                  {row.toolCalls > 0 && <Badge>{row.toolCalls} tool call{row.toolCalls === 1 ? '' : 's'}</Badge>}
                  {row.failures > 0 && <Badge tone="warn">{row.failures} failed</Badge>}
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn--danger-quiet btn--sm" onClick={() => void window.klyro.usageClear().then(() => setRows([]))}>
              <Trash2 className="icon icon--xs" aria-hidden="true" />
              <span>Reset counters</span>
            </button>
          </div>
        </>
      ) : (
        <Hint>No provider requests counted yet.</Hint>
      )}
    </Group>
  )
}

/** The local "what did Klyro do" log — agent actions, MCP tool calls, meeting outputs. */
function AuditLogSection(): React.ReactNode {
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
    <Group
      title="Audit log"
      description="Everything consequential Klyro did — agent actions, MCP tool calls, issues filed from meetings. Local only, never sent anywhere, cleared with the button below."
      icon={Shield}
    >
      {entries.length > 0 ? (
        <div className="list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden', maxHeight: 320, overflowY: 'auto' }}>
          {entries.map((entry, index) => (
            <div key={index} className="list__row">
              <span className="hint" style={{ flexShrink: 0 }}>{new Date(entry.at).toLocaleString()}</span>
              <Badge>{entry.kind}</Badge>
              <div className="list__main">
                <div className="card__text" style={{ overflowWrap: 'anywhere' }}>{entry.detail}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Hint>No events recorded yet.</Hint>
      )}
      <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
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
          className="btn btn--danger-quiet btn--sm"
          disabled={entries.length === 0}
          onClick={() => {
            void window.klyro.auditClear().then(() => setEntries([]))
          }}
        >
          <Trash2 className="icon icon--xs" aria-hidden="true" />
          <span>Clear log</span>
        </button>
      </div>
    </Group>
  )
}

export function SettingsView({ onNavigate }: { onNavigate: (route: Route) => void }): React.ReactNode {
  const [section, setSection] = useState<Section>('assistant')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [permissions, setPermissions] = useState<PermissionState | null>(null)
  const [displays, setDisplays] = useState<Array<{ index: number; label: string; primary: boolean; bounds: { width: number; height: number } }>>([])
  const [reportCount, setReportCount] = useState(0)
  const [version, setVersion] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setVersion((await window.klyro.getAppInfo()).version)
        setSettings(await window.klyro.getSettings())
        setProviders(await window.klyro.listProviders())
        setPermissions(await window.klyro.checkPermissions())
        setReportCount((await window.klyro.diagnosticsList()).length)
      } catch (error) {
        setLoadError((error as Error).message)
      }
    })()
    void window.klyro.screenListDisplays().then(setDisplays).catch(() => setDisplays([]))
  }, [])

  const patch = useCallback(async (next: Partial<AppSettings>): Promise<void> => {
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
  }, [])

  if (loadError) {
    return (
      <>
        <PageHeader title="Settings" icon={Sparkles} />
        <div className="notice notice--error">
          <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
          {loadError}
        </div>
      </>
    )
  }

  if (!settings) {
    return (
      <>
        <PageHeader title="Settings" icon={Sparkles} />
        <div className="loading-line" role="status">
          <Loader2 className="icon icon--sm spin" aria-hidden="true" />
          <span>Loading settings…</span>
        </div>
      </>
    )
  }

  const nav = SECTIONS.map((entry) => {
    const Icon = entry.icon
    const active = section === entry.id
    return (
      <button
        key={entry.id}
        className={`nav-item${active ? ' nav-item--active' : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => setSection(entry.id)}
      >
        <Icon className="icon icon--sm" aria-hidden="true" />
        <span>{entry.label}</span>
      </button>
    )
  })

  return (
    <>
      <PageHeader
        title="Settings"
        description="What Klyro does with your questions, what it keeps, and what it sends."
        icon={Sparkles}
      />

      <div className="split" style={{ gridTemplateColumns: 'minmax(200px, 240px) 1fr' }}>
        <div className="sidebar__group" style={{ marginTop: 0 }} role="navigation" aria-label="Setting groups">
          {nav}
        </div>

        <div>
          {section === 'assistant' && (
            <Group title="Assistant" description="How the answers are written, and how the app looks.">
              <label className="field" style={{ marginBottom: 12 }}>
                <span className="field__label">System prompt</span>
                <textarea rows={3} value={settings.systemPrompt} onChange={(event) => void patch({ systemPrompt: event.target.value })} />
                <Hint>Sent with every question. Say what the answers should be like.</Hint>
              </label>
              <SettingRow label="Response style" hint="How long and how detailed an answer should be.">
                <select
                  value={settings.responseStyle}
                  onChange={(event) => void patch({ responseStyle: event.target.value as AppSettings['responseStyle'] })}
                >
                  <option value="concise">Concise</option>
                  <option value="balanced">Balanced</option>
                  <option value="detailed">Detailed</option>
                </select>
              </SettingRow>
              <SettingRow label="Theme" hint="System follows the operating system.">
                <select value={settings.theme} onChange={(event) => void patch({ theme: event.target.value as AppSettings['theme'] })}>
                  <option value="system">System</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </SettingRow>
            </Group>
          )}

          {section === 'desktop' && (
            <Group title="Desktop" description="How Klyro starts, and how the overlay behaves.">
              <SettingRow label="Launch Klyro at login" hint="Starts the hotkey and the overlay when you sign in.">
                <input
                  type="checkbox"
                  checked={settings.launchAtLogin}
                  onChange={(event) => void patch({ launchAtLogin: event.target.checked })}
                />
              </SettingRow>
              <SettingRow label="Quick-ask shortcut" hint="Opens the overlay from anywhere." stacked>
                <input value={settings.toggleShortcut} onChange={(event) => void patch({ toggleShortcut: event.target.value })} />
              </SettingRow>
              <SettingRow
                label={`Overlay visibility — ${settings.overlayOpacity === 100 ? 'solid' : `${settings.overlayOpacity}% opacity`}`}
                hint="How see-through the overlay is. Capture exclusion (Private mode) is unaffected. The top bar and the wordmark are drag handles."
              >
                <input
                  type="range"
                  min={20}
                  max={100}
                  step={5}
                  value={settings.overlayOpacity}
                  onChange={(event) => void patch({ overlayOpacity: Number(event.target.value) })}
                  aria-label="Overlay window opacity percentage"
                />
              </SettingRow>
              <SettingRow
                label="Overlay screen"
                hint="With two screens, put the overlay on the one you are not sharing: the meeting cannot show what is not in the shared framebuffer."
              >
                <select
                  value={String(settings.overlayDisplay)}
                  onChange={(event) => {
                    const raw = event.target.value
                    void patch({ overlayDisplay: raw === 'primary' ? 'primary' : Number(raw) })
                  }}
                >
                  <option value="primary">Primary screen</option>
                  {displays.map((display) => (
                    <option key={display.index} value={String(display.index)}>
                      {display.label}
                      {display.primary ? ' (primary)' : ''} — {display.bounds.width}×{display.bounds.height}
                    </option>
                  ))}
                </select>
              </SettingRow>
              <SettingRow
                label="Instant replay"
                hint="The same question about an unchanged screen comes back instantly, labelled as a replay. The cache expires after 15 minutes and is stored locally."
              >
                <input
                  type="checkbox"
                  checked={settings.overlayAnswerCache}
                  onChange={(event) => void patch({ overlayAnswerCache: event.target.checked })}
                />
              </SettingRow>
              <SettingRow
                label="Ask for screen permission at launch"
                hint="On macOS the system raises a one-time prompt the first time anything captures the screen. Asking at launch means you answer it before a call. Windows never asks per capture; on Linux this is left off."
              >
                <input
                  type="checkbox"
                  checked={settings.screenPreWarm}
                  onChange={(event) => void patch({ screenPreWarm: event.target.checked })}
                />
              </SettingRow>
              <SettingRow label="Welcome tour" hint="Show the introduction again.">
                <button className="btn btn--ghost btn--sm" onClick={() => void patch({ onboardingComplete: false })}>
                  <Sparkles className="icon icon--xs" aria-hidden="true" />
                  <span>Show it again</span>
                </button>
              </SettingRow>
            </Group>
          )}

          {section === 'screen' && (
            <Group title="Screen & Audio" description="What the overlay can see and hear.">
              <SettingRow
                label="Capture instantly"
                hint={
                  settings.screenAutoCapture
                    ? 'One click attaches what is on screen. Klyro hides itself for the moment of the shot.'
                    : 'Klyro asks which screen or window to share each time.'
                }
              >
                <input
                  type="checkbox"
                  checked={settings.screenAutoCapture}
                  onChange={(event) => void patch({ screenAutoCapture: event.target.checked })}
                />
              </SettingRow>
              {permissions && (
                <div className="permissions-section" style={{ marginTop: 16 }}>
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
                    <div key={index} className="hint" style={{ marginTop: 6 }}>{note}</div>
                  ))}
                </div>
              )}
              <Hint>
                On Windows and Linux the system never asks per capture. On macOS the operating system asks for Screen
                Recording once, and that prompt comes from the OS, not from Klyro — it cannot be skipped.
              </Hint>
            </Group>
          )}

          {section === 'knowledge' && (
            <Group title="Knowledge & Memory" description="What Klyro may use to ground an answer. Everything stays on this device.">
              <SettingRow label="Use remembered facts" hint="Facts you saved are added to a prompt when they are relevant.">
                <input
                  type="checkbox"
                  checked={settings.memoryEnabled}
                  onChange={(event) => void patch({ memoryEnabled: event.target.checked })}
                />
              </SettingRow>
              <SettingRow label="Learn facts automatically" hint="Durable facts are extracted from conversations and added to your memories.">
                <input
                  type="checkbox"
                  checked={settings.memoryAutoExtract}
                  onChange={(event) => void patch({ memoryAutoExtract: event.target.checked })}
                />
              </SettingRow>
              <SettingRow label="Memories per answer" hint="How many remembered facts are considered for one question.">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.memoryRecallCount}
                  onChange={(event) => void patch({ memoryRecallCount: Number(event.target.value) || 1 })}
                />
              </SettingRow>
              <SettingRow label="Use local documents" hint="Excerpts of the documents you indexed are cited when they matter.">
                <input
                  type="checkbox"
                  checked={settings.knowledgeEnabled}
                  onChange={(event) => void patch({ knowledgeEnabled: event.target.checked })}
                />
              </SettingRow>
              <SettingRow label="Document excerpts per answer">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={settings.documentRecallCount}
                  onChange={(event) => void patch({ documentRecallCount: Number(event.target.value) || 1 })}
                />
              </SettingRow>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn btn--sm" onClick={() => onNavigate('knowledge')}>
                  <Brain className="icon icon--xs" aria-hidden="true" />
                  <span>Open knowledge</span>
                </button>
              </div>
            </Group>
          )}

          {section === 'history' && (
            <Group title="History & Retention" description="What a session heard, what Klyro answered, and the record of what it did — all of it on this machine.">
              <SettingRow
                label="Keep history for"
                hint="One window covers interview transcripts, the chat history and the audit log. The usage ledger counts requests only — no words, no timestamps — and is cleared on demand."
                stacked
              >
                <select value={settings.retentionDays} onChange={(event) => void patch({ retentionDays: Number(event.target.value) })}>
                  <option value={0}>Until I delete it</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={365}>1 year</option>
                </select>
              </SettingRow>
              <SettingRow
                label="Don't keep new interviews"
                hint="Nothing is written to disk: the questions, the answers, the transcript and the conversation behind them live in memory and are gone when Klyro quits. A session you decide was worth keeping can be written down with “Keep this one”."
              >
                <input
                  type="checkbox"
                  checked={settings.interviewEphemeralDefault}
                  onChange={(event) => void patch({ interviewEphemeralDefault: event.target.checked })}
                />
              </SettingRow>
            </Group>
          )}

          {section === 'providers' && (
            <Group
              title="Providers & Agents"
              description="Keys, models and agents live on the Models & Agents page, where each one can be connected and tested."
              icon={Cpu}
              actions={
                <button className="btn btn--sm" onClick={() => onNavigate('models')}>
                  <Cpu className="icon icon--xs" aria-hidden="true" />
                  <span>Open Models & Agents</span>
                </button>
              }
            >
              <div className="list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {providers.map((provider) => {
                  const state = providerState(provider, [], [])
                  const isActive = settings.activeProvider === provider.id
                  return (
                    <div key={provider.id} className="list__row">
                      <StatusDot state={state.tone === 'ok' ? 'ok' : state.tone === 'warn' ? 'warn' : 'idle'} title={state.label} />
                      <div className="list__main">
                        <div className="list__title">
                          {provider.label}
                          {isActive && <Badge tone="accent">In use</Badge>}
                        </div>
                        <div className="list__meta">
                          {provider.model || 'No model set'}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Group>
          )}

          {section === 'usage' && (
            <>
              <Group
                title="Crash reports"
                description="Off by default. Reports are written to the Klyro data folder and are only sent anywhere if an endpoint is explicitly configured. They contain a redacted error and the app version — never your API keys."
              >
                <SettingRow label="Save crash reports on this device">
                  <input
                    type="checkbox"
                    checked={settings.diagnosticsOptIn}
                    onChange={(event) => {
                      void patch({ diagnosticsOptIn: event.target.checked }).then(async () => {
                        setReportCount((await window.klyro.diagnosticsList()).length)
                      })
                    }}
                  />
                </SettingRow>
                {reportCount > 0 && (
                  <div className="row" style={{ marginTop: 12 }}>
                    <span className="hint" style={{ flex: 1 }}>Saved crash reports: {reportCount}</span>
                    <button
                      className="btn btn--danger-quiet btn--sm"
                      onClick={() => {
                        void window.klyro.diagnosticsClear().then(() => setReportCount(0))
                      }}
                    >
                      <Trash2 className="icon icon--xs" aria-hidden="true" />
                      <span>Clear</span>
                    </button>
                  </div>
                )}
              </Group>

              <UsageSection />
              <AuditLogSection />

              <Group title="About" icon={HardDrive}>
                <div className="row" style={{ gap: 12 }}>
                  <span className="icon-tile">
                    <CheckCircle2 className="icon icon--md" aria-hidden="true" />
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '15px' }}>Klyro</div>
                    <div className="hint">Your AI. Your entire computer.</div>
                    <div className="hint">{version ? `Version ${version}` : 'Version…'}</div>
                  </div>
                </div>
                <Hint>
                  Klyro is a local-first AI desktop assistant. Your data stays on your device unless you choose to send
                  it to a remote provider.
                </Hint>
              </Group>
            </>
          )}
        </div>
      </div>
    </>
  )
}
