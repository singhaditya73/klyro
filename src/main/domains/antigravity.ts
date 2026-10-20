import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'

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
}

/** The CSRF token and pid of a running Antigravity language server. */
function findLanguageServer(): { pid: string; token: string } | null {
  if (process.platform !== 'linux') return null
  let pids: string[] = []
  try {
    pids = readdirSync('/proc').filter((name) => /^\d+$/.test(name))
  } catch {
    return null
  }
  for (const pid of pids) {
    let cmdline = ''
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
    } catch {
      continue
    }
    if (!cmdline.includes('language_server_')) continue
    // Only Antigravity's own server, not some other tool's.
    if (!cmdline.includes('antigravity')) continue
    const token = cmdline.match(/--csrf_token (\S+)/)?.[1]
    if (!token) continue
    return { pid, token }
  }
  return null
}

/** The localhost ports that process is listening on. */
function listeningPorts(pid: string): number[] {
  try {
    const output = execFileSync('ss', ['-ltnp'], { encoding: 'utf8', timeout: 4000 })
    const ports: number[] = []
    for (const line of output.split('\n')) {
      if (!line.includes(`pid=${pid},`)) continue
      const match = line.match(/127\.0\.0\.1:(\d+)/)
      if (match) ports.push(Number(match[1]))
    }
    return ports
  } catch {
    return []
  }
}

class AntigravityDomain {
  private connection: Connection | null = null

  /** Talk to the language server, finding the port if we have not yet. */
  private async connect(): Promise<Connection | null> {
    if (this.connection) return this.connection
    const server = findLanguageServer()
    if (!server) return null
    // The server listens on several ports (one of them is HTTPS); ask them all
    // at once instead of waiting for each timeout in turn.
    const probes = await Promise.all(
      listeningPorts(server.pid).map(async (port) => {
        const probe = await this.rpc(port, server.token, 'GetUserStatus', METADATA, 2500)
        return probe.ok ? port : null
      })
    )
    const port = probes.find((value) => value !== null)
    if (port === undefined || port === null) return null
    this.connection = { port, token: server.token }
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
    const connection = await this.connect()
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
      plan: planInfo.planName ?? null,
      account,
      models: list,
      endpoint: `127.0.0.1:${connection.port}`,
      error: status.error
    }
  }
}

export const antigravity = new AntigravityDomain()
