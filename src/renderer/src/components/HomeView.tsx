import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Brain,
  Clock,
  Cpu,
  FileText,
  Keyboard,
  MessageSquare,
  Sparkles,
  Zap
} from 'lucide-react'
import type { AppSettings, DataSummary, ProviderId, ProviderStatus } from '@shared/types'
import { Badge, EmptyState, Group, Loading, PageHeader, StatusDot } from './ui'
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
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [next, list, local, programs, summary] = await Promise.all([
        window.klyro.getSettings(),
        window.klyro.listProviders(),
        window.klyro.localAgentsDetect(),
        window.klyro.localAgentClis(),
        window.klyro.dataSummary()
      ])
      setSettings(next)
      setProviders(list)
      setAgents(local)
      setClis(programs)
      setData(summary)
      setShortcut(next.toggleShortcut || 'CommandOrControl+Shift+Space')
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
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
  const activeModel = active?.model || ''

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

  return (
    <>
      <PageHeader
        title="Klyro"
        description="Your meeting assistant. It answers about the screen or the conversation, in place, using the models you already have."
        actions={
          <button className="btn btn--accent" onClick={() => void window.klyro.toggleOverlay()}>
            <Zap className="icon icon--sm" aria-hidden="true" />
            <span>Open Klyro</span>
          </button>
        }
      />

      {error && (
        <div className="notice notice--error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <Group>
        <div className="row row--wrap" style={{ gap: 16 }}>
          <span className="icon-tile">
            <Sparkles className="icon icon--md" aria-hidden="true" />
          </span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="card__title">Ready to answer</span>
              {activeState && (
                <Badge tone={activeState.tone === 'ok' ? 'ok' : activeState.tone === 'warn' ? 'warn' : 'idle'}>
                  <StatusDot state={activeState.tone === 'ok' ? 'ok' : activeState.tone === 'warn' ? 'warn' : 'idle'} />
                  {activeState.label}
                </Badge>
              )}
            </div>
            <div className="card__subtitle">
              {active ? (
                <>
                  {active.label}
                  {activeModel ? ` · ${activeModel}` : ''} ·{' '}
                  {data?.activeProviderIsLocal
                    ? 'answers stay on this machine'
                    : 'answers go to a remote service'}
                </>
              ) : (
                'No provider selected yet.'
              )}
            </div>
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <Keyboard className="icon icon--xs" style={{ color: 'var(--text-disabled)' }} aria-hidden="true" />
              <span className="hint">
                <kbd className="kbd">{shortcut}</kbd> opens the overlay anywhere — in a meeting, in your editor, anywhere.
              </span>
            </div>
          </div>
          <button className="btn" onClick={() => onNavigate('models')}>
            <Cpu className="icon icon--sm" aria-hidden="true" />
            <span>Change the model</span>
          </button>
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

      <div className="split" style={{ marginTop: 16 }}>
        <div>
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
        </div>

        <div>
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
