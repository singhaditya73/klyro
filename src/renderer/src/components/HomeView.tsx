import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Brain,
  CircleDollarSign,
  Clock,
  Coins,
  Cpu,
  FileText,
  Keyboard,
  MessageSquare,
  ShieldCheck,
  Zap
} from 'lucide-react'
import type { AppSettings, DataSummary, ProviderId, ProviderStatus, ProviderUsageRow } from '@shared/types'
import { Badge, EmptyState, Group, Loading, PageHeader, StatusDot } from './ui'
import { BrandIcon } from './BrandIcon'
import {
  type CliInfo,
  type LocalAgentInfo,
  isLocalProvider,
  providerState
} from '../lib/providers'
import { useProviderHealth } from '../hooks/useProviderHealth'
import type { Route } from '../hooks/useHashRoute'

/**
 * The dashboard.
 *
 * It answers three questions in one screen: can I ask something right now,
 * what is Klyro using to answer, and what does it already know. Everything
 * here is measured — a key that is saved, a service that answered, a document
 * that was indexed. Nothing is estimated and nothing is invented.
 */

interface InterviewSummary {
  id: string
  company: string
  role: string
  startedAt: number
  questionCount: number
  answeredCount: number
  progress: number
  preview: string
  ephemeral: boolean
}

export function HomeView({ onNavigate }: { onNavigate: (route: Route) => void }): React.ReactNode {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [agents, setAgents] = useState<LocalAgentInfo[]>([])
  const [clis, setClis] = useState<CliInfo[]>([])
  const [data, setData] = useState<DataSummary | null>(null)
  const [sessions, setSessions] = useState<InterviewSummary[] | null>(null)
  const [shortcut, setShortcut] = useState('CommandOrControl+Shift+Space')
  const [usageRows, setUsageRows] = useState<ProviderUsageRow[]>([])
  const [error, setError] = useState<string | null>(null)

  /**
   * Load the dashboard.
   *
   * Every part is loaded on its own: one provider that cannot be reached must
   * not leave the whole page empty. What failed is said out loud, so an empty
   * list is never mistaken for "nothing is connected".
   */
  const load = useCallback(async (): Promise<void> => {
    const failures: string[] = []
    const [next, list, local, programs, summary, usage] = await Promise.all([
      window.klyro.getSettings().catch((caught) => {
        failures.push(`settings: ${(caught as Error).message}`)
        return null
      }),
      window.klyro.listProviders().catch((caught) => {
        failures.push(`providers: ${(caught as Error).message}`)
        return [] as ProviderStatus[]
      }),
      window.klyro.localAgentsDetect().catch((caught) => {
        failures.push(`local services: ${(caught as Error).message}`)
        return [] as LocalAgentInfo[]
      }),
      window.klyro.localAgentClis().catch((caught) => {
        failures.push(`agents: ${(caught as Error).message}`)
        return [] as CliInfo[]
      }),
      window.klyro.dataSummary().catch((caught) => {
        failures.push(`what Klyro knows: ${(caught as Error).message}`)
        return null
      }),
      window.klyro.usageRows().catch(() => [] as ProviderUsageRow[])
    ])
    if (next) {
      setSettings(next)
      setShortcut(next.toggleShortcut || 'CommandOrControl+Shift+Space')
    }
    setProviders(list)
    setAgents(local)
    setClis(programs)
    setData(summary)
    setUsageRows(usage || [])
    setError(failures.length > 0 ? failures.join(' · ') : null)
  }, [])

  useEffect(() => {
    void load()
    const unsubscribe = window.klyro.onSettingsChanged?.(() => {
      void load()
    })
    return () => {
      unsubscribe?.()
    }
  }, [load])

  // Recent activity only when there is some: the history may be off, and the
  // interviews may be ephemeral.
  useEffect(() => {
    if (!data || data.interviews === 0) {
      setSessions([])
      return
    }
    let cancelled = false
    void window.klyro
      .interviewsList({})
      .then((all) => {
        if (!cancelled) setSessions((all ?? []).slice(0, 4))
      })
      .catch(() => {
        if (!cancelled) setSessions([])
      })
    return () => {
      cancelled = true
    }
  }, [data])

  // The local providers are asked directly: a port scan cannot tell whether
  // the server the user pointed at is answering.
  const baseUrls = useMemo(() => {
    const map: Partial<Record<string, string>> = {}
    for (const [id, provider] of Object.entries(settings?.providers ?? {})) {
      map[id] = provider?.baseUrl ?? ''
    }
    return map
  }, [settings])
  const { health } = useProviderHealth(baseUrls as Partial<Record<ProviderId, string>>)

  const active = useMemo(
    () => providers.find((provider) => provider.id === settings?.activeProvider) ?? null,
    [providers, settings]
  )
  const activeState = active ? providerState(active, agents, clis, health[active.id]) : null
  const activeModel =
    (settings?.activeProvider && settings.providers[settings.activeProvider]?.model) ||
    (settings?.activeProvider && settings.providers[settings.activeProvider]?.fastModel) ||
    active?.model ||
    ''

  const connected = useMemo(
    () => providers.filter((provider) => {
      const state = providerState(provider, agents, clis, health[provider.id])
      return state.state === 'ready' || state.state === 'running'
    }),
    [agents, clis, health, providers]
  )
  const notConnected = useMemo(
    () => providers.filter((provider) => !connected.includes(provider)),
    [connected, providers]
  )

  const nothingConfigured = connected.length === 0
  const localCount = connected.filter((provider) => isLocalProvider(provider.id)).length
  const hostedCount = connected.length - localCount

  const totalSpend = useMemo(
    () => usageRows.reduce((sum, r) => sum + (r.estimatedSpendUsd || 0), 0),
    [usageRows]
  )
  const totalTokens = useMemo(
    () => usageRows.reduce((sum, r) => sum + (r.totalTokens || 0), 0),
    [usageRows]
  )
  const totalInTokens = useMemo(
    () => usageRows.reduce((sum, r) => sum + (r.inputTokens || 0), 0),
    [usageRows]
  )
  const totalOutTokens = useMemo(
    () => usageRows.reduce((sum, r) => sum + (r.outputTokens || 0), 0),
    [usageRows]
  )
  const totalRequests = useMemo(
    () => usageRows.reduce((sum, r) => sum + (r.requests || 0), 0),
    [usageRows]
  )

  const formattedKeys = useMemo(() => {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    const raw = shortcut || 'CommandOrControl+Shift+Space'
    const parts = raw.split('+').map((p) => p.trim())
    return parts.map((part) => {
      if (part === 'CommandOrControl') return isMac ? '⌘' : 'Ctrl'
      if (part === 'Control') return isMac ? '⌃' : 'Ctrl'
      if (part === 'Shift') return isMac ? '⇧' : 'Shift'
      if (part === 'Alt') return isMac ? '⌥' : 'Alt'
      return part
    })
  }, [shortcut])

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return n.toLocaleString()
  }

  const formatSpend = (usd: number): string => {
    if (usd === 0) return '$0.00'
    if (usd < 0.01) return `$${usd.toFixed(4)}`
    return `$${usd.toFixed(2)}`
  }

  return (
    <>
      <PageHeader
        title="Klyro"
        description="Your meeting assistant. It answers about the screen or the conversation, in place, using the models you already have."
      />

      {error && (
        <div className="notice notice--error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Ready to Answer Hero Card */}
      <Group>
        <div
          style={{
            padding: '20px 8px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 20,
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, minWidth: 280 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 'var(--radius-md)',
                background: 'rgba(249, 115, 22, 0.12)',
                border: '1px solid rgba(249, 115, 22, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fb923c',
                flexShrink: 0
              }}
            >
              <Zap className="icon icon--md" aria-hidden="true" />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              {/* Header Title Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                  Ready to answer
                </span>
                {activeState && (
                  <Badge tone={activeState.tone === 'ok' ? 'ok' : activeState.tone === 'warn' ? 'warn' : 'idle'}>
                    <StatusDot state={activeState.tone === 'ok' ? 'ok' : activeState.tone === 'warn' ? 'warn' : 'idle'} />
                    {activeState.label}
                  </Badge>
                )}
                {data?.activeProviderIsLocal ? (
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: 'rgba(52, 211, 153, 0.12)',
                      color: 'var(--status-ok)',
                      fontWeight: 500,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <ShieldCheck className="icon icon--2xs" aria-hidden="true" />
                    100% Local · Air-gapped
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: 'rgba(255, 255, 255, 0.06)',
                      color: 'var(--text-muted)',
                      fontWeight: 500
                    }}
                  >
                    Remote API Stream
                  </span>
                )}
              </div>

              {/* Active Model / Provider Specs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Active provider: <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{active ? active.label : 'None configured'}</strong>
                </span>
                {activeModel && (
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: 'var(--font-mono, monospace)',
                      padding: '2px 7px',
                      borderRadius: 4,
                      background: 'var(--surface-hover)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)'
                    }}
                  >
                    {activeModel}
                  </span>
                )}
              </div>

              {/* Shortcut Banner */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 2,
                  color: 'var(--text-muted)',
                  fontSize: 12
                }}
              >
                <Keyboard className="icon icon--xs" style={{ color: 'var(--text-disabled)', flexShrink: 0 }} aria-hidden="true" />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  Press
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {formattedKeys.map((k, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {i > 0 && <span style={{ color: 'var(--text-disabled)', fontSize: 11 }}>+</span>}
                        <kbd className="kbd" style={{ minWidth: 20, textAlign: 'center', padding: '2px 6px' }}>{k}</kbd>
                      </span>
                    ))}
                  </span>
                  to toggle the HUD anywhere on your desktop
                </span>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'center' }}>
            <button className="btn btn--primary" onClick={() => void window.klyro.toggleOverlay?.()}>
              <Zap className="icon icon--xs" aria-hidden="true" />
              <span>Quick ask</span>
            </button>
            <button className="btn" onClick={() => onNavigate('models')}>
              <Cpu className="icon icon--xs" aria-hidden="true" />
              <span>Change model</span>
            </button>
          </div>
        </div>
      </Group>

      {nothingConfigured && !error && (
        <Group
          title="One step to go"
          description="Klyro answers with a model you already pay for. Connect one — a local server, an agent CLI, or a hosted key — and the overlay is ready."
        >
          <div className="row row--wrap" style={{ gap: 8 }}>
            <button className="btn btn--primary" onClick={() => onNavigate('models')}>
              <Cpu className="icon icon--sm" aria-hidden="true" />
              <span>Connect a model</span>
            </button>
            <button className="btn btn--ghost" onClick={() => onNavigate('knowledge')}>
              <Brain className="icon icon--sm" aria-hidden="true" />
              <span>Teach it something</span>
            </button>
          </div>
        </Group>
      )}

      {/* Split Dashboard Columns: Left = Connected + What Klyro knows | Right = Token Expenses + Recent activity */}
      <div className="split" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Group
            title="Connected"
            description={
              connected.length === 0
                ? 'Nothing is connected yet.'
                : `${hostedCount} hosted · ${localCount} on this machine`
            }
            icon={Cpu}
            flush
          >
            {providers.length === 0 ? (
              <div className="list">
                <Loading label="Looking at your providers…" />
              </div>
            ) : (
              <div className="list">
                {connected.map((provider) => {
                  const state = providerState(provider, agents, clis, health[provider.id])
                  const isActive = provider.id === settings?.activeProvider
                  return (
                    <button
                      key={provider.id}
                      className="list__row list__row--button"
                      onClick={() => onNavigate('models')}
                    >
                      <StatusDot state={state.tone === 'ok' ? 'ok' : state.tone === 'warn' ? 'warn' : 'idle'} title={state.label} />
                      <BrandIcon brand={provider.id} size={18} />
                      <div className="list__main">
                        <div className="list__title">
                          {provider.label}
                          {isActive && <Badge tone="accent">In use</Badge>}
                        </div>
                        <div className="list__meta">
                          {state.label}
                          {provider.model ? ` · ${provider.model}` : ''}
                        </div>
                      </div>
                    </button>
                  )
                })}
                {notConnected.length > 0 && (
                  <button className="list__row list__row--button" onClick={() => onNavigate('models')}>
                    <StatusDot state="idle" />
                    <div className="list__main">
                      <div className="list__title">
                        {notConnected.length} provider{notConnected.length === 1 ? '' : 's'} not connected
                      </div>
                      <div className="list__meta">Add a key, or use a local server or an agent CLI</div>
                    </div>
                  </button>
                )}
              </div>
            )}
          </Group>

          {/* What Klyro knows (swapped to left column) */}
          <Group title="What Klyro knows" description="Kept on this machine." icon={Brain} flush>
            <div className="list">
              <div className="list__row">
                <MessageSquare className="icon icon--sm" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                <div className="list__main">
                  <div className="list__title">Memories</div>
                  <div className="list__meta">Facts you asked it to remember</div>
                </div>
                <div className="list__actions">
                  <span className="pill">{data?.memories ?? 0}</span>
                </div>
              </div>
              <div className="list__row">
                <FileText className="icon icon--sm" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                <div className="list__main">
                  <div className="list__title">Documents</div>
                  <div className="list__meta">Indexed locally, cited when relevant</div>
                </div>
                <div className="list__actions">
                  <span className="pill">{data?.documents ?? 0}</span>
                </div>
              </div>
              <div className="list__row">
                <Clock className="icon icon--sm" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                <div className="list__main">
                  <div className="list__title">Saved sessions</div>
                  <div className="list__meta">
                    {data?.ephemeralInterviews
                      ? `${data.ephemeralInterviews} kept in memory only`
                      : 'Interviews and transcripts'}
                  </div>
                </div>
                <div className="list__actions">
                  <span className="pill">{data?.interviews ?? 0}</span>
                </div>
              </div>
            </div>
          </Group>
        </div>

        {/* Right Column: Token Expenses & Spend + Recent activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Token Expenses & Spend Card */}
          <Group
            title="Token Expenses & Spend"
            description="API consumption and estimated spend measured locally on your machine."
            icon={CircleDollarSign}
            flush
            actions={
              <button
                className="btn btn--sm btn--quiet"
                onClick={() => onNavigate('settings')}
                title="View full ledger in Settings"
                style={{ fontSize: 11, padding: '4px 8px' }}
              >
                <span>View ledger</span>
                <ArrowUpRight className="icon icon--2xs" aria-hidden="true" />
              </button>
            }
          >
            {/* Top KPI Metrics */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
                padding: '12px 14px',
                background: 'var(--surface-sunken)',
                borderBottom: '1px solid var(--border-subtle)'
              }}
            >
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Spend
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: totalSpend > 0 ? '#f97316' : 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 3
                  }}
                >
                  {formatSpend(totalSpend)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 2 }}>
                  {totalSpend > 0 ? 'BYOK keys' : '100% Free / Local'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Tokens
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 3
                  }}
                >
                  {formatTokens(totalTokens)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 2 }}>
                  {Math.round(totalInTokens / 1000)}k in · {Math.round(totalOutTokens / 1000)}k out
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Requests
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                    marginTop: 3
                  }}
                >
                  {totalRequests}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-disabled)', marginTop: 2 }}>
                  API calls
                </div>
              </div>
            </div>

            {/* Provider usage breakdown or clean empty state */}
            {usageRows.length > 0 ? (
              <div className="list">
                {usageRows.slice(0, 4).map((row) => {
                  const spend = row.estimatedSpendUsd || 0
                  const isLocal = isLocalProvider(row.provider)
                  const label = row.provider.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
                  return (
                    <div key={row.provider} className="list__row" style={{ padding: '8px 14px' }}>
                      <div className="list__main">
                        <div className="row" style={{ alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</span>
                          {isLocal ? (
                            <Badge tone="ok">Local</Badge>
                          ) : (
                            <Badge tone="idle">Metered</Badge>
                          )}
                        </div>
                        <div className="list__meta" style={{ fontSize: 11 }}>
                          {row.requests} query{row.requests === 1 ? '' : 's'} · {formatTokens(row.totalTokens)} tokens
                        </div>
                      </div>
                      <div className="list__actions" style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: spend > 0 ? '#f97316' : 'var(--text-muted)' }}>
                          {spend > 0 ? formatSpend(spend) : 'Free'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div
                style={{
                  padding: '16px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  color: 'var(--text-muted)',
                  fontSize: 12
                }}
              >
                <Coins className="icon icon--sm" style={{ color: 'var(--text-disabled)', flexShrink: 0 }} aria-hidden="true" />
                <span>
                  No token costs recorded yet. Every query through your connected models logs token consumption here.
                </span>
              </div>
            )}
          </Group>

          <Group
            title="Recent activity"
            description="Only what Klyro kept, and only while history is on."
            icon={Clock}
            flush
          >
            {sessions === null ? (
              <div className="list">
                <Loading label="Reading the history…" />
              </div>
            ) : sessions.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No saved sessions"
                text="Record an interview with “Listen to meeting” or “Record question” in the overlay, and it is written down here."
                action={
                  <button className="btn btn--sm" onClick={() => onNavigate('interviews')}>
                    <span>Open interviews</span>
                  </button>
                }
              />
            ) : (
              <div className="list">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    className="list__row list__row--button"
                    onClick={() => onNavigate('interviews')}
                  >
                    <div className="list__main">
                      <div className="list__title">
                        {session.company || 'Interview'}
                        {session.role ? ` · ${session.role}` : ''}
                        {session.ephemeral && <Badge tone="idle">Not saved</Badge>}
                      </div>
                      <div className="list__meta">
                        {new Date(session.startedAt).toLocaleDateString()} · {session.answeredCount}/
                        {session.questionCount} answered
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Group>
        </div>
      </div>
    </>
  )
}
