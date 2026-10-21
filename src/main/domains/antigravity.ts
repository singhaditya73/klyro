import { readFileSync } from 'node:fs'
import type { ChildProcess } from 'node:child_process'
import {
  findAntigravityExtension,
  findLanguageServerPids,
  listeningPorts,
  startLanguageServer
} from './antigravity-service'

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

  /**
   * Talk to the language server, finding it if we have not yet.
   *
   * The port and the token both change every time the IDE starts, so the
   * connection is never assumed to be good: every call re-checks, and a dead
   * connection is dropped so the next call discovers the new one.
   */
  private async connect(force = false): Promise<Connection | null> {
    if (this.connection && !force) return this.connection
    const servers = findLanguageServers()
    if (servers.length === 0) {
      this.connection = null
      return null
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
   * descriptor in the binary) and, for a signed-in agent, the account token
   * and the model config that normally come from the IDE's sidecar. This
   * reports honestly what is missing rather than pretending.
   */
  async startService(): Promise<{ started: boolean; error?: string; note?: string }> {
    if (process.platform !== 'linux') {
      return { started: false, error: 'Running an Antigravity service is currently Linux-only.' }
    }
    const extension = findAntigravityExtension()
    if (!extension) {
      return { started: false, error: 'The Antigravity IDE is not installed on this machine.' }
    }
    let child: ChildProcess
    let token: string
    try {
      const started = startLanguageServer(extension.serverBinary, extension.extensionPath)
      child = started.child
      token = started.token
    } catch (error) {
      return { started: false, error: `Could not start the Antigravity service: ${(error as Error).message}` }
    }
    this.service = { child, token }
    // Give the server a moment to bind its ports.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      const connection = await this.connect(true)
      if (connection) {
        return {
          started: true,
          note: 'The Antigravity service is running. Sign-in and model configuration still come from the IDE the first time.'
        }
      }
    }
    return {
      started: false,
      error: 'The Antigravity service did not answer. Open the Antigravity IDE once so it can finish signing in.'
    }
  }

  /** Stop a service we started. */
  stopService(): void {
    if (!this.service) return
    try {
      this.service.child.kill()
    } catch {
      // Already gone.
    }
    this.service = null
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
    const connection = await this.connect()
    if (!connection) {
      throw new Error('Antigravity is not running. Open the Antigravity IDE, or start its service from Integrations.')
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
    let connection = await this.connect()
    if (connection) {
      // The port and token change when the IDE restarts: if the call fails,
      // discover the new server instead of trusting the cached one.
      const probe = await this.rpc(connection.port, connection.token, 'GetUserStatus', METADATA, 4000)
      if (!probe.ok) {
        connection = await this.connect(true)
      }
    }
    if (!connection) {
      return {
        supported: true,
        running: false,
        plan: null,
        account: null,
        models: [],
        endpoint: null,
        error: 'Antigravity is not running. Open the Antigravity IDE and Klyro will pick it up.'
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
      plan: planInfo.planName ?? null,
      account,
      models: list,
      endpoint: `127.0.0.1:${connection.port}`,
      service: connection.ours ? 'klyro' : 'ide',
      error: status.error
    }
  }
}

export const antigravity = new AntigravityDomain()
