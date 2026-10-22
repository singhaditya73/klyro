import { readFileSync } from 'node:fs'
import type { ChildProcess } from 'node:child_process'
import { logger } from '../logger'
import {
  findAntigravityExtension,
  findLanguageServerPids,
  listeningPorts,
  startLanguageServer
} from './antigravity-service'
import {
  ReplaySidecar,
  captureIdeState,
  clearSession,
  loadSession,
  saveSession,
  type AntigravitySession
} from './antigravity-session'

/**
 * Antigravity, the local agent IDE — read directly from its own service.
 *
 * The IDE runs a language server (`language_server_*`) and the extension
 * spawns it with a one-time CSRF token on the command line. That server
 * speaks Connect-RPC over plain HTTP on localhost, and authenticates every
 * request with the header `x-codeium-csrf-token`.
 *
 * So the whole integration is: find the process, read its token, find its
 * port, and speak the protocol. No key, no bridge, no scraping of private
 * files — the token is handed to us by the same machine that runs the IDE.
 *
 * Verified live against the installed IDE:
 *   POST http://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus
 *     headers: content-type: application/json
 *              connect-protocol-version: 1
 *              x-codeium-csrf-token: <token>
 *     body:    { "metadata": { "ideName": "antigravity", … } }
 *   → 200 { userStatus: { planStatus, … } }   (a wrong token → 401)
 *   → GetAvailableModels → 22 models with live quota
 */

const SERVICE = 'exa.language_server_pb.LanguageServerService'
const RPC_TIMEOUT_MS = 8000

/**
 * Can this catalogue entry answer a chat request?
 *
 * The server lists more than chat models: `MODEL_CHAT_*` are internal aliases
 * that answer 404 when asked, and the `tab_*` entries are autocomplete models
 * that take no conversation at all. Offering them is a trap: the first entry
 * in the catalogue would be the one a picker chooses, and it would fail.
 */
export function isChatModel(model: { id: string; name: string }): boolean {
  const id = model.id.toUpperCase()
  const name = model.name.toLowerCase()
  if (id.startsWith('MODEL_CHAT_')) return false
  if (name.startsWith('tab_') || name.includes('tab_jump') || name.includes('tab_flash')) return false
  return true
}

export interface AntigravityModel {
  id: string
  name: string
  provider: string
  /** 0..1 — how much of the user's quota is left for this model. */
  quota: number | null
}

export interface AntigravityStatus {
  supported: boolean
  running: boolean
  /** Which service answered: the IDE's own, or the one Klyro started. */
  service?: 'ide' | 'klyro' | null
  /** The IDE is installed, so Klyro can start it. */
  installed?: boolean
  /** Klyro has a saved Antigravity session, so the IDE is not needed. */
  connected?: boolean
  /** When the session was captured. */
  connectedAt?: string | null
  plan: string | null
  account: string | null
  models: AntigravityModel[]
  endpoint: string | null
  error: string | null
}

const METADATA = {
  metadata: {
    ideName: 'antigravity',
    extensionName: 'antigravity',
    ideVersion: 'unknown',
    locale: 'en'
  }
}

interface Connection {
  port: number
  token: string
  /** The process the connection belongs to. */
  pid: string
  /** True when this service is the one Klyro started. */
  ours: boolean
}

/** Is the Antigravity agent service installed on this machine? */
export function isAntigravityInstalled(): boolean {
  return findAntigravityExtension() !== null
}

/**
 * Every Antigravity language server on this machine, with the CSRF token the
 * IDE handed it. The IDE spawns more than one, and each has its own port and
 * token — so all of them are candidates.
 */
function findLanguageServers(): Array<{ pid: string; token: string }> {
  const servers: Array<{ pid: string; token: string }> = []
  for (const pid of findLanguageServerPids()) {
    let cmdline = ''
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
    } catch {
      continue
    }
    const token = cmdline.match(/--csrf_token (\S+)/)?.[1]
    if (token) servers.push({ pid, token })
  }
  return servers
}

class AntigravityDomain {
  private connection: Connection | null = null
  /** A language server we started ourselves. */
  private service: { child: ChildProcess; token: string } | null = null
  /** The sidecar that replays the saved session to our own language server. */
  private sidecar: ReplaySidecar | null = null
  /** Starting the service takes a few seconds, so it is only done once. */
  private starting: Promise<Connection | null> | null = null

  /**
   * Talk to the language server, finding it if we have not yet.
   *
   * The port and the token both change every time the IDE starts, so the
   * connection is never assumed to be good: every call re-checks, and a dead
   * connection is dropped so the next call discovers the new one.
   */
  private async connectToServer(force = false): Promise<Connection | null> {
    if (this.connection && !force) return this.connection
    if (force && this.starting) return this.starting
    const servers = findLanguageServers()
    if (servers.length === 0) {
      // The IDE is not running — but a saved session means Klyro can serve
      // Antigravity on its own.
      this.connection = null
      return this.startOwnService()
    }
    // The server listens on several ports (one of them is HTTPS); ask them all
    // at once instead of waiting for each timeout in turn.
    const candidates = servers.flatMap((server) =>
      listeningPorts(server.pid).map((port) => ({ port, token: server.token, pid: server.pid }))
    )
    const probes = await Promise.all(
      candidates.map(async (candidate) => {
        const probe = await this.rpc(candidate.port, candidate.token, 'GetUserStatus', METADATA, 2500)
        return probe.ok ? candidate : null
      })
    )
    const found = probes.find((value) => value !== null)
    this.connection = found
      ? {
          port: found.port,
          token: found.token,
          pid: found.pid,
          ours: this.service !== null && found.pid === String(this.service.child.pid)
        }
      : null
    return this.connection
  }

  /**
   * Start Antigravity's language server ourselves and feed it the saved
   * session — this is what makes the IDE unnecessary after the one-time
   * connect.
   */
  private async startOwnService(): Promise<Connection | null> {
    if (this.starting) return this.starting
    const session = loadSession()
    if (!session) return null
    const extension = findAntigravityExtension()
    if (!extension) return null

    this.starting = (async () => {
      // The server explains a failed boot on stderr and nowhere else.
      let output: () => string = () => ''
      try {
        const sidecar = new ReplaySidecar(session)
        const sidecarPort = await sidecar.listen()
        this.sidecar = sidecar
        const started = startLanguageServer(extension.serverBinary, extension.extensionPath, {
          sidecar: { port: sidecarPort, token: sidecar.token }
        })
        output = started.output
        this.service = { child: started.child, token: started.token }
        // The server binds its ports a moment after it starts.
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          const candidates = listeningPorts(String(started.child.pid))
          const probes = await Promise.all(
            candidates.map(async (port) => {
              const probe = await this.rpc(port, started.token, 'GetUserStatus', METADATA, 2500)
              return probe.ok ? port : null
            })
          )
          const port = probes.find((value) => value !== null)
          if (port) {
            this.connection = { port, token: started.token, pid: String(started.child.pid), ours: true }
            return this.connection
          }
        }
      } catch {
        // Fall through: the caller reports that Antigravity is not available.
      }
      const tail = output().split('\n').slice(-8).join(' | ')
      logger.warn(`Antigravity's own service did not start${tail ? `: ${tail}` : '.'}`)
      this.service = null
      this.sidecar?.close()
      this.sidecar = null
      return null
    })()

    try {
      return await this.starting
    } finally {
      this.starting = null
    }
  }

  /** One Connect-RPC call against the language server. */
  private async rpc(
    port: number,
    token: string,
    method: string,
    body: unknown,
    timeoutMs = RPC_TIMEOUT_MS
  ): Promise<{ ok: boolean; status: number; data: unknown; error: string | null }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/${SERVICE}/${method}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'connect-protocol-version': '1',
          'x-codeium-csrf-token': token
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      const text = await response.text()
      let data: unknown = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }
      return {
        ok: response.ok,
        status: response.status,
        data,
        error: response.ok
          ? null
          : ((data as { message?: string } | null)?.message ?? `HTTP ${response.status}`)
      }
    } catch (error) {
      return { ok: false, status: 0, data: null, error: (error as Error).message }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Start our own Antigravity agent service — the same language server the
   * IDE uses — so Klyro can talk to Antigravity without the IDE being open.
   *
   * The server needs an initial-metadata protobuf on stdin (built from the
   * descriptor in the binary) and, for a signed-in agent, the account session
   * that normally comes from the IDE's sidecar. With a saved session Klyro
   * replays that itself.
   */
  async startService(): Promise<{ started: boolean; error?: string; note?: string }> {
    if (process.platform !== 'linux') {
      return { started: false, error: 'Running an Antigravity service is currently Linux-only.' }
    }
    const extension = findAntigravityExtension()
    if (!extension) {
      return { started: false, error: 'The Antigravity IDE is not installed on this machine.' }
    }
    const session = loadSession()
    if (!session) {
      return {
        started: false,
        error:
          'Connect your Antigravity account first — open the Antigravity IDE once and press Connect in Integrations.'
      }
    }
    const connection = await this.startOwnService()
    if (!connection) {
      return { started: false, error: 'The Antigravity service did not answer. Try again in a moment.' }
    }
    return {
      started: true,
      note: 'The Antigravity service is running. The Antigravity IDE does not need to be open.'
    }
  }

  /**
   * The one-time connect.
   *
   * The IDE owns the account session, so it has to be running for this. We
   * take a snapshot of what its sidecar hands the language server and save it;
   * from then on Klyro can start Antigravity's service itself and the IDE
   * never has to be opened again.
   */
  async connect(): Promise<{ ok: boolean; error?: string; note?: string }> {
    if (process.platform !== 'linux') {
      return { ok: false, error: 'The Antigravity integration is currently Linux-only.' }
    }
    // Our own service has a sidecar too (the replay one) — it is not the IDE.
    const ours = this.service ? [String(this.service.child.pid)] : []
    const result = await captureIdeState(1200, ours)
    if (!result.ok) {
      return { ok: false, error: result.error }
    }
    const session: AntigravitySession = {
      capturedAt: new Date().toISOString(),
      topics: result.topics ?? {}
    }
    if (!session.topics['uss-oauth']) {
      return {
        ok: false,
        error:
          'Antigravity did not hand over an account session. Sign in to Antigravity in the IDE, then try again.'
      }
    }
    saveSession(session)
    return {
      ok: true,
      note: 'Connected. Klyro can use your Antigravity models now — the IDE does not have to be open.'
    }
  }

  /** Forget the saved session. */
  disconnect(): void {
    clearSession()
    this.stopService()
  }

  /** Is there a saved session? */
  isConnected(): boolean {
    return loadSession() !== null
  }

  /**
   * Start the service ahead of time, so the first question does not wait for
   * it. Used at launch; failures are quiet, because the service is started
   * again on demand.
   */
  async warmUp(): Promise<void> {
    try {
      if (!loadSession()) return
      await this.connectToServer(true)
    } catch {
      // Nothing to do: the service is started on demand.
    }
  }

  /**
   * Where the Antigravity service is listening, and the token it answers to.
   *
   * The daemon asks the service over this, so the call itself happens in
   * Rust while the session stays where it is: the app's own store.
   */
  async endpoint(): Promise<{ port: number; token: string } | null> {
    const connection = await this.connectToServer()
    if (!connection) return null
    return { port: connection.port, token: connection.token }
  }

  /** Stop a service we started. */
  stopService(): void {
    if (this.service) {
      try {
        this.service.child.kill()
      } catch {
        // Already gone.
      }
    }
    this.service = null
    this.sidecar?.close()
    this.sidecar = null
    this.connection = null
  }

  /**
   * Ask one of Antigravity's models a question.
   *
   * The language server exposes a direct model call: a model id and a prompt
   * in, one answer out. That is all Klyro needs to use the user's Antigravity
   * models (Claude Opus 4.6, Sonnet 4.6, Gemini 3.5 …) as a provider.
   */
  async complete(model: string, prompt: string): Promise<string> {
    const connection = await this.connectToServer()
    if (!connection) {
      throw new Error(
        'Antigravity is not available. Open the Antigravity IDE, or connect your account in Integrations.'
      )
    }
    const result = await this.rpc(connection.port, connection.token, 'GetModelResponse', {
      ...METADATA,
      model,
      prompt
    })
    if (!result.ok) {
      throw new Error(result.error ?? 'Antigravity did not answer.')
    }
    const payload = result.data as { response?: string } | null
    return payload?.response ?? ''
  }

  /** The account, plan, quota and model catalogue, if Antigravity is running. */
  async status(): Promise<AntigravityStatus> {
    if (process.platform !== 'linux') {
      return {
        supported: false,
        running: false,
        plan: null,
        account: null,
        models: [],
        endpoint: null,
        error: 'The Antigravity integration is currently Linux-only.'
      }
    }
    const session = loadSession()
    let connection = await this.connectToServer()
    if (connection) {
      // The port and token change when the IDE restarts: if the call fails,
      // discover the new server instead of trusting the cached one.
      const probe = await this.rpc(connection.port, connection.token, 'GetUserStatus', METADATA, 4000)
      if (!probe.ok) {
        connection = await this.connectToServer(true)
      }
    }
    if (!connection) {
      return {
        supported: true,
        running: false,
        installed: isAntigravityInstalled(),
        connected: session !== null,
        connectedAt: session?.capturedAt ?? null,
        plan: null,
        account: null,
        models: [],
        endpoint: null,
        error: session
          ? 'Antigravity could not be started. Try again in a moment.'
          : 'Antigravity is not running. Open the Antigravity IDE, or connect your account in Integrations.'
      }
    }

    const status = await this.rpc(connection.port, connection.token, 'GetUserStatus', METADATA)
    const payload = (status.data as { userStatus?: Record<string, unknown> } | null)?.userStatus ?? {}
    const planInfo = (payload.planStatus as { planInfo?: { planName?: string } } | null)?.planInfo ?? {}
    const account = typeof payload.email === 'string' ? payload.email : null

    const catalogue = await this.rpc(connection.port, connection.token, 'GetAvailableModels', METADATA)
    const models = ((catalogue.data as { response?: { models?: Record<string, Record<string, unknown>> } } | null)
      ?.response?.models ?? {}) as Record<string, Record<string, unknown>>
    const list: AntigravityModel[] = Object.entries(models).map(([id, model]) => ({
      id: typeof model.model === 'string' ? model.model : id,
      name: typeof model.displayName === 'string' ? model.displayName : id,
      provider: typeof model.modelProvider === 'string' ? model.modelProvider : '',
      quota:
        typeof (model.quotaInfo as { remainingFraction?: number } | null)?.remainingFraction === 'number'
          ? ((model.quotaInfo as { remainingFraction: number }).remainingFraction)
          : null
    }))

    return {
      supported: true,
      running: true,
      installed: isAntigravityInstalled(),
      connected: session !== null,
      connectedAt: session?.capturedAt ?? null,
      plan: planInfo.planName ?? null,
      account,
      models: list.filter(isChatModel),
      endpoint: `127.0.0.1:${connection.port}`,
      service: connection.ours ? 'klyro' : 'ide',
      error: status.error
    }
  }
}

export const antigravity = new AntigravityDomain()
