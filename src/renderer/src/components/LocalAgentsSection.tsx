import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Circle, Cpu, Key, RefreshCcw, Server } from 'lucide-react'

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
  }, [scan])

  const healthy = (agents ?? []).filter((agent) => agent.healthy)
  const others = (agents ?? []).filter((agent) => !agent.healthy)

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

      {healthy.length === 0 && agents !== null && (
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
