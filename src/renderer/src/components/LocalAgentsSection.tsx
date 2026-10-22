import { useCallback, useEffect, useState } from 'react'
import { Circle, Cpu, Key, Loader2, Play, RefreshCcw, Server } from 'lucide-react'
import { Badge, StatusDot } from './ui'

/**
 * What is already running on this machine.
 *
 * OpenCode, Ollama, LM Studio, LiteLLM, vLLM and local bridges to other IDEs'
 * subscriptions all speak something we can use. Klyro probes the usual ports
 * and offers one-click connect — no key, no signup, no copying credentials.
 *
 * The section is split into blocks so the Models page can place each one
 * where it belongs: the detected servers with the local servers, Antigravity
 * with the coding agents.
 */

export interface LocalAgent {
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

export interface CliAgent {
  id: string
  name: string
  installed: boolean
  providerId: string
  note: string
}

interface Props {
  /** Point Klyro at a detected service. */
  onConnect: (agent: LocalAgent, model: string) => void | Promise<void>
  /** Open Settings to add a server password. */
  onOpenSettings?: () => void
  /** Which blocks to show. Everything is shown by default. */
  show?: {
    detected?: boolean
    opencode?: boolean
    antigravity?: boolean
    clis?: boolean
  }
  /** A heading for the block; null means no heading at all. */
  title?: string | null
  description?: string
}

export function LocalAgentsSection({
  onConnect,
  onOpenSettings,
  show,
  title = 'Local models & agents',
  description = 'Use the AI services already running on this machine — no key, no signup'
}: Props) {
  const blocks = { detected: true, opencode: true, antigravity: true, clis: true, ...show }
  const [agents, setAgents] = useState<LocalAgent[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [connected, setConnected] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [installed, setInstalled] = useState(false)
  const [clis, setClis] = useState<CliAgent[]>([])
  const [startingAgent, setStartingAgent] = useState(false)
  const [agentNote, setAgentNote] = useState<string | null>(null)
  const [antigravity, setAntigravity] = useState<{
    supported: boolean
    running: boolean
    installed?: boolean
    service?: 'ide' | 'klyro' | null
    connected?: boolean
    connectedAt?: string | null
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
    void window.klyro
      .localAgentOpenCodeInstalled()
      .then((result) => setInstalled(result.installed))
      .catch(() => setInstalled(false))
    void window.klyro
      .localAgentClis()
      .then(setClis)
      .catch(() => setClis([]))
    void window.klyro
      .antigravityStatus()
      .then(setAntigravity)
      .catch(() => setAntigravity(null))
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
  }, [scan, onConnect])

  const refreshAntigravity = useCallback(async (): Promise<void> => {
    try {
      setAntigravity(await window.klyro.antigravityStatus())
    } catch {
      setAntigravity(null)
    }
  }, [])

  const startAntigravityService = useCallback(async (): Promise<void> => {
    setStartingAgent(true)
    setAgentNote(null)
    try {
      const result = await window.klyro.antigravityStartService()
      setAgentNote(result.error ?? result.note ?? null)
      await refreshAntigravity()
    } catch (error) {
      setAgentNote((error as Error).message)
    } finally {
      setStartingAgent(false)
    }
  }, [refreshAntigravity])

  /**
   * The one-time connect: take a snapshot of the Antigravity account session
   * while the IDE is running, so the IDE never has to be opened again.
   */
  const connectAntigravity = useCallback(async (): Promise<void> => {
    setStartingAgent(true)
    setAgentNote(null)
    try {
      const result = await window.klyro.antigravityConnect()
      setAgentNote(result.error ?? result.note ?? null)
      await refreshAntigravity()
    } catch (error) {
      setAgentNote((error as Error).message)
    } finally {
      setStartingAgent(false)
    }
  }, [refreshAntigravity])

  /** Forget the saved session. */
  const disconnectAntigravity = useCallback(async (): Promise<void> => {
    setStartingAgent(true)
    try {
      await window.klyro.antigravityDisconnect()
      setAgentNote('Antigravity disconnected. Klyro will not use it until you connect again.')
      await refreshAntigravity()
    } finally {
      setStartingAgent(false)
    }
  }, [refreshAntigravity])

  /** Make Antigravity the active provider, on one specific model. */
  const useAntigravityModel = useCallback(async (modelId: string, modelName: string): Promise<void> => {
    setAgentNote(null)
    try {
      const settings = await window.klyro.getSettings()
      await window.klyro.updateSettings({
        activeProvider: 'antigravity',
        providers: {
          ...settings.providers,
          antigravity: { baseUrl: 'local://antigravity', model: modelId }
        }
      })
      setAgentNote(`Klyro will use Antigravity's ${modelName} from now on.`)
    } catch (error) {
      setAgentNote((error as Error).message)
    }
  }, [])

  /** Make Antigravity the active provider, on a free model when there is one. */
  const useAntigravityModels = useCallback(async (): Promise<void> => {
    if (!antigravity?.running) return
    setAgentNote(null)
    try {
      const models = antigravity.models
      const preferred =
        models.find((model) => model.quota === 1 && /opus|sonnet|gemini/i.test(model.name)) ??
        models.find((model) => /opus|sonnet|gemini/i.test(model.name)) ??
        models[0]
      const settings = await window.klyro.getSettings()
      await window.klyro.updateSettings({
        activeProvider: 'antigravity',
        providers: {
          ...settings.providers,
          antigravity: { baseUrl: 'local://antigravity', model: preferred?.id ?? '' }
        }
      })
      setAgentNote(`Klyro will use Antigravity's ${preferred?.name ?? 'models'} from now on.`)
    } catch (error) {
      setAgentNote((error as Error).message)
    }
  }, [antigravity])

  const healthy = (agents ?? []).filter((agent) => agent.healthy)
  const others = (agents ?? []).filter((agent) => !agent.healthy)
  // OpenCode that is installed but not answering: we can start it ourselves.
  const openCodeRunning = (agents ?? []).some((agent) => agent.kind === 'opencode' && agent.healthy)

  return (
    <section>
      {title && (
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <div className="group__title">{title}</div>
            <div className="group__desc">{description}</div>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => void scan()} disabled={scanning}>
            <RefreshCcw className={`icon icon--xs${scanning ? ' spin' : ''}`} aria-hidden="true" />
            <span>{scanning ? 'Scanning…' : 'Scan again'}</span>
          </button>
        </div>
      )}

      {blocks.detected && agents === null && <Loading label="Looking for local services…" />}

      {blocks.detected && healthy.length > 0 && (
        <div className="list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {healthy.map((agent) => (
            <div key={agent.id} className="list__row" style={{ alignItems: 'flex-start' }}>
              <StatusDot state="ok" title="Running" />
              <div className="list__main">
                <div className="list__title">
                  {agent.name}
                  <Badge tone="ok">Running</Badge>
                  {agent.needsAuth && <Badge tone="warn">Needs the server password</Badge>}
                  {agent.version && <span className="muted" style={{ fontSize: 11 }}>v{agent.version}</span>}
                </div>
                <div className="list__meta">
                  {agent.baseUrl} · {agent.models.length} model{agent.models.length === 1 ? '' : 's'} · {agent.note}
                </div>
                {agent.models.length > 0 && (
                  <div className="row row--wrap" style={{ gap: 4, marginTop: 8 }}>
                    {agent.models.slice(0, 6).map((model) => (
                      <button
                        key={model}
                        className="btn btn--ghost btn--xs"
                        onClick={() => {
                          setConnected(agent.id)
                          void onConnect(agent, model)
                        }}
                        title={`Use ${model}`}
                      >
                        <span className="mono">{model}</span>
                      </button>
                    ))}
                    {agent.models.length > 6 && (
                      <span className="hint" style={{ alignSelf: 'center' }}>
                        +{agent.models.length - 6} more
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="list__actions">
                {agent.needsAuth ? (
                  <button className="btn btn--sm" onClick={onOpenSettings}>
                    <Key className="icon icon--xs" aria-hidden="true" />
                    <span>Add the password</span>
                  </button>
                ) : (
                  <button
                    className="btn btn--sm"
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
            </div>
          ))}
        </div>
      )}

      {notice && (
        <div className="notice notice--info" style={{ marginTop: 12 }}>
          <span className="notice__body">{notice}</span>
        </div>
      )}

      {blocks.opencode && installed && !openCodeRunning && agents !== null && (
        <div className="card" style={{ marginTop: 12 }}>
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

      {blocks.antigravity && antigravity && !antigravity.connected && antigravity.installed && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card__row" style={{ flexWrap: 'wrap' }}>
            <span className="icon-tile">
              <Server className="icon icon--sm" aria-hidden="true" />
            </span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="card__title">Antigravity is installed, not connected</div>
              <div className="card__subtitle">
                Connect your Antigravity account once — open the IDE and press Connect. After that Klyro uses its models
                on its own, and the IDE never has to be opened again.
              </div>
            </div>
            <button className="btn btn--primary btn--sm" onClick={() => void connectAntigravity()} disabled={startingAgent}>
              {startingAgent ? (
                <Loader2 className="icon icon--xs spin" aria-hidden="true" />
              ) : (
                <Key className="icon icon--xs" aria-hidden="true" />
              )}
              <span>{startingAgent ? 'Connecting…' : 'Connect'}</span>
            </button>
          </div>
          {agentNote && (
            <div className="notice notice--info" style={{ marginTop: 12 }}>
              <span className="notice__body">{agentNote}</span>
            </div>
          )}
        </div>
      )}

      {blocks.antigravity && antigravity?.connected && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--border-default)' }}>
          <div className="card__row" style={{ flexWrap: 'wrap' }}>
            <span className="icon-tile">
              <Server className="icon icon--sm" aria-hidden="true" />
            </span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="card__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                Antigravity
                <Badge tone="ok">Connected</Badge>
                {antigravity.plan && <Badge tone="accent">{antigravity.plan} plan</Badge>}
                <Badge tone="ok">IDE not needed</Badge>
              </div>
              <div className="card__subtitle">
                {antigravity.running ? (
                  <>
                    Read directly from the Antigravity agent on this machine — {antigravity.models.length} models, no key
                    and no bridge. Endpoint {antigravity.endpoint}
                    {antigravity.service === 'klyro' ? ' (the service Klyro started)' : ' (the IDE\'s own service)'}.
                  </>
                ) : (
                  <>
                    Your Antigravity account is saved, so Klyro can start the agent service itself — the IDE does not
                    need to be open.
                  </>
                )}
              </div>
            </div>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              {antigravity.running ? (
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => void useAntigravityModels()}
                  disabled={startingAgent}
                >
                  <Cpu className="icon icon--xs" aria-hidden="true" />
                  <span>Use these models</span>
                </button>
              ) : (
                <button
                  className="btn btn--primary btn--sm"
                  onClick={() => void startAntigravityService()}
                  disabled={startingAgent}
                >
                  {startingAgent ? (
                    <Loader2 className="icon icon--xs spin" aria-hidden="true" />
                  ) : (
                    <Cpu className="icon icon--xs" aria-hidden="true" />
                  )}
                  <span>{startingAgent ? 'Starting…' : 'Start the service'}</span>
                </button>
              )}
              <button className="btn btn--ghost btn--sm" onClick={() => void scan()}>
                <RefreshCcw className="icon icon--xs" aria-hidden="true" />
                <span>Refresh</span>
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => void disconnectAntigravity()} disabled={startingAgent}>
                <span>Disconnect</span>
              </button>
            </div>
          </div>
          {antigravity.running && (
            <div className="row row--wrap" style={{ gap: 6, marginTop: 10 }}>
              {antigravity.models.slice(0, 10).map((model) => (
                <button
                  key={model.id}
                  className="pill"
                  title={`Use ${model.name} — ${model.id}`}
                  onClick={() => void useAntigravityModel(model.id, model.name)}
                >
                  {model.name}
                  {model.quota !== null && model.quota < 1 ? ` · ${Math.round(model.quota * 100)}%` : ''}
                </button>
              ))}
              {antigravity.models.length > 10 && (
                <span className="hint" style={{ alignSelf: 'center' }}>
                  +{antigravity.models.length - 10} more
                </span>
              )}
            </div>
          )}
          {agentNote && (
            <div className="notice notice--info" style={{ marginTop: 12 }}>
              <span className="notice__body">{agentNote}</span>
            </div>
          )}
        </div>
      )}

      {blocks.clis && clis.filter((cli) => cli.installed).length > 0 && (
        <div className="list" style={{ marginTop: 12, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {clis
            .filter((cli) => cli.installed)
            .map((cli) => (
              <div key={cli.id} className="list__row">
                <StatusDot state="ok" title="Installed" />
                <div className="list__main">
                  <div className="list__title">{cli.name}</div>
                  <div className="list__meta">{cli.note}</div>
                </div>
                <div className="list__actions">
                  <button
                    className="btn btn--sm"
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
              </div>
            ))}
        </div>
      )}

      {blocks.detected && healthy.length === 0 && agents !== null && !installed && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card__text muted">
            Nothing local found. Start <code>opencode serve</code> (free models, no key), or run Ollama, LM Studio,
            LiteLLM or vLLM, then scan again.
          </div>
        </div>
      )}

      {blocks.detected && others.length > 0 && healthy.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="hint" style={{ cursor: 'pointer' }}>
            {others.length} other service{others.length === 1 ? '' : 's'} not running
          </summary>
          <div className="list" style={{ marginTop: 8, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {others.map((agent) => (
              <div key={agent.id} className="list__row">
                <Circle className="icon icon--xs" style={{ color: 'var(--text-disabled)' }} aria-hidden="true" />
                <div className="list__main">
                  <div className="list__title" style={{ fontWeight: 500 }}>{agent.name}</div>
                  <div className="list__meta">{agent.baseUrl}</div>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

/** Small local helper so this file does not need the whole UI kit. */
function Loading({ label }: { label: string }): React.ReactNode {
  return (
    <div className="loading-line" role="status">
      <Loader2 className="icon icon--sm spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
