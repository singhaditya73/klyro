import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Circle, Cpu, Key, Loader2, Play, RefreshCcw, Server } from 'lucide-react'

/**
 * What is already running on this machine.
 *
 * OpenCode, Ollama, LM Studio, LiteLLM, vLLM and local bridges to other IDEs'
 * subscriptions all speak something we can use. Klyro probes the usual ports
 * and offers one-click connect — no key, no signup, no copying credentials.
 */

interface LocalAgent {
  id: string
  kind: 'opencode' | 'openai-compatible'
  name: string
  baseUrl: string
  healthy: boolean
  needsAuth?: boolean
  version?: string
  models: string[]
  note: string
}

interface Props {
  /** Point Klyro at a detected service. */
  onConnect: (agent: LocalAgent, model: string) => void | Promise<void>
  /** Open Settings to add a server password. */
  onOpenSettings?: () => void
}

export function LocalAgentsSection({ onConnect, onOpenSettings }: Props) {
  const [agents, setAgents] = useState<LocalAgent[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [connected, setConnected] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [installed, setInstalled] = useState(false)
  const [clis, setClis] = useState<Array<{ id: string; name: string; installed: boolean; providerId: string; note: string }>>([])
  const [antigravity, setAntigravity] = useState<{
    supported: boolean
    running: boolean
    plan: string | null
    models: Array<{ id: string; name: string; provider: string; quota: number | null }>
    endpoint: string | null
    error: string | null
  } | null>(null)

  const scan = useCallback(async (): Promise<void> => {
    setScanning(true)
    try {
      setAgents(await window.klyro.localAgentsDetect())
    } catch {
      setAgents([])
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    void scan()
    void window.klyro.localAgentOpenCodeInstalled().then((result) => setInstalled(result.installed)).catch(() => setInstalled(false))
    void window.klyro.localAgentClis().then(setClis).catch(() => setClis([]))
    void window.klyro.antigravityStatus().then(setAntigravity).catch(() => setAntigravity(null))
  }, [scan])

  /**
   * Start the user's own OpenCode server and connect to it. Klyro reads the
   * password the server prints and keeps it encrypted, so the user never has
   * to copy anything.
   */
  const startOpenCode = useCallback(async (): Promise<void> => {
    setStarting(true)
    setNotice(null)
    try {
      const result = await window.klyro.localAgentStartOpenCode()
      if (!result.started) {
        setNotice(result.error ?? 'OpenCode did not start.')
        return
      }
      setNotice(
        result.spawned
          ? `OpenCode is running on ${result.baseUrl} and connected. No key needed.`
          : 'OpenCode was already running — connected. No key needed.'
      )
      // Point the provider at the server that is actually listening.
      await onConnect(
        {
          id: 'opencode',
          kind: 'opencode',
          name: 'OpenCode',
          baseUrl: result.baseUrl,
          healthy: true,
          needsAuth: false,
          models: [],
          note: 'Your OpenCode account, its free models and its limits — no key needed.'
        },
        ''
      )
      await scan()
    } finally {
      setStarting(false)
    }
  }, [scan])

  const healthy = (agents ?? []).filter((agent) => agent.healthy)
  const others = (agents ?? []).filter((agent) => !agent.healthy)
  // OpenCode that is installed but not answering: we can start it ourselves.
  const openCodeRunning = (agents ?? []).some((agent) => agent.kind === 'opencode' && agent.healthy)

  return (
    <section style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="icon-tile">
            <Server className="icon icon--md" aria-hidden="true" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Local models & agents</h2>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
              Use the AI services already running on this machine — no key, no signup
            </p>
          </div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => void scan()} disabled={scanning}>
          <RefreshCcw className={`icon icon--xs${scanning ? ' spin' : ''}`} aria-hidden="true" />
          <span>{scanning ? 'Scanning…' : 'Scan again'}</span>
        </button>
      </div>

      {agents === null && <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>Looking for local services…</div>}

      {healthy.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {healthy.map((agent) => (
            <div key={agent.id} className="card">
              <div className="card__row" style={{ flexWrap: 'wrap' }}>
                <CheckCircle2 className="icon icon--sm" style={{ color: 'var(--success)' }} aria-hidden="true" />
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div className="card__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {agent.name}
                    <span className="pill pill--ok">Running</span>
                    {agent.needsAuth && <span className="pill pill--warn">Needs the server password</span>}
                    {agent.version && <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>v{agent.version}</span>}
                  </div>
                  <div className="card__subtitle">
                    {agent.baseUrl} · {agent.models.length} model{agent.models.length === 1 ? '' : 's'} · {agent.note}
                  </div>
                </div>
                {agent.needsAuth ? (
                  <button className="btn btn--primary btn--sm" onClick={onOpenSettings}>
                    <Key className="icon icon--xs" aria-hidden="true" />
                    <span>Add the password</span>
                  </button>
                ) : (
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={() => {
                      setConnected(agent.id)
                      void onConnect(agent, agent.models[0] ?? '')
                    }}
                  >
                    <Cpu className="icon icon--xs" aria-hidden="true" />
                    <span>{connected === agent.id ? 'Connected' : 'Use this'}</span>
                  </button>
                )}
              </div>
              {agent.models.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {agent.models.slice(0, 8).map((model) => (
                    <button
                      key={model}
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        setConnected(agent.id)
                        void onConnect(agent, model)
                      }}
                      title={`Use ${model}`}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{model}</span>
                    </button>
                  ))}
                  {agent.models.length > 8 && <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>+{agent.models.length - 8} more</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {notice && (
        <div className="notice notice--info" style={{ marginTop: 12 }}>
          <span className="notice__body">{notice}</span>
        </div>
      )}

      {installed && !openCodeRunning && agents !== null && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card__row" style={{ flexWrap: 'wrap' }}>
            <Server className="icon icon--sm" style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="card__title">OpenCode is installed here</div>
              <div className="card__subtitle">
                Start it and Klyro will use your OpenCode account — its free models, its limits — with no key.
              </div>
            </div>
            <button className="btn btn--primary btn--sm" onClick={() => void startOpenCode()} disabled={starting}>
              {starting ? (
                <Loader2 className="icon icon--xs spin" aria-hidden="true" />
              ) : (
                <Play className="icon icon--xs" aria-hidden="true" />
              )}
              <span>{starting ? 'Starting…' : 'Start it'}</span>
            </button>
          </div>
        </div>
      )}

      {antigravity?.running && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--border-default)' }}>
          <div className="card__row" style={{ flexWrap: 'wrap' }}>
            <span className="icon-tile">
              <Server className="icon icon--sm" aria-hidden="true" />
            </span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="card__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Antigravity
                <span className="pill pill--ok">Connected</span>
                {antigravity.plan && <span className="pill pill--accent">{antigravity.plan} plan</span>}
              </div>
              <div className="card__subtitle">
                Read directly from the Antigravity agent on this machine — {antigravity.models.length} models, no
                key and no bridge. Endpoint {antigravity.endpoint}.
              </div>
            </div>
            <button className="btn btn--ghost btn--sm" onClick={() => void scan()}>
              <RefreshCcw className="icon icon--xs" aria-hidden="true" />
              <span>Refresh</span>
            </button>
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {antigravity.models.slice(0, 8).map((model) => (
              <span key={model.id} className="pill" title={`${model.id} · ${model.provider}`}>
                {model.name}
                {model.quota !== null && model.quota < 1 ? ` · ${Math.round(model.quota * 100)}%` : ''}
              </span>
            ))}
            {antigravity.models.length > 8 && (
              <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
                +{antigravity.models.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}

      {clis.filter((cli) => cli.installed).length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {clis
            .filter((cli) => cli.installed)
            .map((cli) => (
              <div key={cli.id} className="card__row" style={{ gap: 10, fontSize: 12 }}>
                <span className="pill pill--ok">Installed</span>
                <span style={{ fontWeight: 550 }}>{cli.name}</span>
                <span className="muted" style={{ flex: 1, minWidth: 0 }}>{cli.note}</span>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    void (async () => {
                      const settings = await window.klyro.getSettings()
                      await window.klyro.updateSettings({
                        activeProvider: cli.providerId,
                        providers: {
                          ...settings.providers,
                          [cli.providerId]: { ...settings.providers[cli.providerId], baseUrl: '', model: '' }
                        }
                      })
                      setNotice(`${cli.name} is now your provider. Ask something and it will answer.`)
                    })()
                  }}
                >
                  <Cpu className="icon icon--xs" aria-hidden="true" />
                  <span>Use this</span>
                </button>
              </div>
            ))}
        </div>
      )}

      {healthy.length === 0 && agents !== null && !installed && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 13 }}>
            Nothing local found. Start <code>opencode serve</code> (free models, no key), or run Ollama, LM Studio,
            LiteLLM or vLLM, then scan again.
          </div>
        </div>
      )}

      {others.length > 0 && healthy.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>
            {others.length} other service{others.length === 1 ? '' : 's'} not running
          </summary>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {others.map((agent) => (
              <div key={agent.id} className="data-row" style={{ fontSize: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Circle className="icon icon--xs" aria-hidden="true" />
                  {agent.name}
                </span>
                <span className="muted">{agent.baseUrl}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}
