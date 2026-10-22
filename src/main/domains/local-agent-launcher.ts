import { spawn, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../logger'
import { secrets } from '../security/secrets'
import { listOpenCodeModels, probeOpenCode, type OpenCodeModelInfo } from '../providers/opencode'
import { settingsDomain } from './settings'

/**
 * Start the user's own OpenCode server, so connecting takes one click.
 *
 * `opencode serve` prints the URL it listens on and the password it generated
 * (when OPENCODE_SERVER_PASSWORD is not set). Because we start the process
 * ourselves, we can read that password from its output and store it in the
 * encrypted secret store — so the user never has to find, copy or paste it.
 * Klyro is talking to the user's own OpenCode, with the user's own account.
 */

const DEFAULT_PORT = 4096
const START_TIMEOUT_MS = 20000
const SECRET_ID = 'opencode'

export interface LaunchedAgent {
  started: boolean
  baseUrl: string
  /** True when we had to start it (false when it was already running). */
  spawned: boolean
  error?: string
}

interface ServerProcess {
  child: ChildProcess
  baseUrl: string
  password: string | null
}

let running: ServerProcess | null = null

/**
 * The names an OpenCode binary can have. On Windows an npm install produces
 * `opencode.cmd` (and sometimes `opencode.exe`), and Node will not spawn a
 * `.cmd` without a shell — which is why the launcher takes the platform into
 * account rather than assuming a Unix-style executable.
 */
function binaryNames(): string[] {
  if (process.platform === 'win32') return ['opencode.exe', 'opencode.cmd', 'opencode.bat']
  return ['opencode']
}

/** Where an OpenCode binary usually lives, beyond PATH. */
function candidateBinaries(): string[] {
  const home = homedir()
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    return [
      join(home, '.opencode', 'bin', 'opencode.exe'),
      join(appData, 'npm', 'opencode.cmd'),
      join(appData, 'npm', 'opencode.exe'),
      join(localAppData, 'Programs', 'opencode', 'opencode.exe'),
      join(localAppData, 'opencode', 'opencode.exe')
    ]
  }
  return [
    join(home, '.opencode', 'bin', 'opencode'),
    join(home, '.local', 'bin', 'opencode'),
    join(home, 'bin', 'opencode'),
    '/usr/local/bin/opencode',
    '/opt/homebrew/bin/opencode',
    '/usr/bin/opencode'
  ]
}

/** Is OpenCode installed on this machine? */
export function findOpenCodeBinary(): string | null {
  const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean)
  const names = binaryNames()
  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  for (const candidate of candidateBinaries()) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Is the port free? A quick TCP check: if nothing answers, it is ours to take. */
function portFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
    socket.setTimeout(600)
    socket.on('connect', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('error', () => resolve(true))
    socket.on('timeout', () => {
      socket.destroy()
      resolve(true)
    })
  })
}

/** Read the URL and password the server prints on startup. */
function readStartupLines(child: ChildProcess, timeoutMs: number): Promise<{ baseUrl: string | null; password: string | null }> {
  return new Promise((resolve) => {
    let baseUrl: string | null = null
    let password: string | null = null
    let buffer = ''
    let settled = false

    const finish = (): void => {
      if (settled) return
      settled = true
      resolve({ baseUrl, password })
    }
    const timer = setTimeout(finish, timeoutMs)

    const consume = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const url = line.match(/server listening on (http:\/\/\S+)/i)
        if (url) baseUrl = url[1]
        const pw = line.match(/server password (\S+)/i)
        if (pw) password = pw[1]
      }
      if (baseUrl && password) {
        clearTimeout(timer)
        finish()
      }
    }

    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)
    child.on('exit', () => {
      clearTimeout(timer)
      finish()
    })
    child.on('error', (error) => {
      logger.warn('Could not start OpenCode', error)
      clearTimeout(timer)
      finish()
    })
  })
}

class LocalAgentLauncher {
  /** The OpenCode server we started, if any. */
  status(): { running: boolean; baseUrl: string | null } {
    const child = running?.child
    return { running: Boolean(child && child.exitCode === null), baseUrl: running?.baseUrl ?? null }
  }

  /**
   * Start `opencode serve` (if it is not already running) and remember the
   * password it generated, encrypted, so the provider can use it.
   */
  async startOpenCode(): Promise<LaunchedAgent> {
    const binary = findOpenCodeBinary()
    if (!binary) {
      return {
        started: false,
        baseUrl: `http://127.0.0.1:${DEFAULT_PORT}`,
        spawned: false,
        error: 'OpenCode is not installed on this machine. Install it, then run "opencode serve" yourself.'
      }
    }

    // An OpenCode server that is already running is the best case — but only
    // when it accepts the password we have. A server we cannot authenticate
    // with is someone else's: adopting it would turn every question into a 401,
    // so a port of our own is used instead.
    const storedPassword = secrets.get(SECRET_ID) ?? process.env.OPENCODE_SERVER_PASSWORD ?? null
    const existing = await probeOpenCode(`http://127.0.0.1:${DEFAULT_PORT}`, storedPassword)
    if (existing.healthy && !existing.needsAuth) {
      return { started: true, baseUrl: `http://127.0.0.1:${DEFAULT_PORT}`, spawned: false }
    }
    const port = (await portFree(DEFAULT_PORT)) ? DEFAULT_PORT : DEFAULT_PORT + 1
    const baseUrl = `http://127.0.0.1:${port}`

    let child: ChildProcess
    try {
      // On Windows the binary is usually a .cmd shim, which Node only runs
      // through a shell; the path is quoted because it may contain spaces.
      const command = process.platform === 'win32' ? `"${binary}"` : binary
      child = spawn(command, ['serve', '--port', String(port)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
        windowsHide: true,
        shell: process.platform === 'win32'
      })
    } catch (error) {
      return {
        started: false,
        baseUrl,
        spawned: false,
        error: `Could not start OpenCode: ${(error as Error).message}`
      }
    }

    const { baseUrl: announced, password } = await readStartupLines(child, START_TIMEOUT_MS)
    if (!announced) {
      try {
        child.kill()
      } catch {
        // Already gone.
      }
      return {
        started: false,
        baseUrl,
        spawned: false,
        error: 'OpenCode did not report a server URL. It may still be starting — try again in a moment.'
      }
    }

    running = { child, baseUrl: announced, password }
    if (password) {
      // The server generated its own password; keep it encrypted, like a key.
      secrets.set(SECRET_ID, password)
    } else if (process.env.OPENCODE_SERVER_PASSWORD) {
      secrets.set(SECRET_ID, process.env.OPENCODE_SERVER_PASSWORD)
    }

    // Never leave a server running behind us.
    child.on('exit', () => {
      if (running?.child === child) running = null
    })

    return { started: true, baseUrl: announced, spawned: true }
  }

  /**
   * The whole promise in one action: find OpenCode, start it if needed, and
   * wire it up as the active provider with a sensible model — so the user
   * opens Klyro, clicks once, and it just works.
   */
  async connectOpenCode(): Promise<{
    connected: boolean
    baseUrl: string
    model: string
    models: number
    free: number
    error?: string
  }> {
    const launched = await this.startOpenCode()
    if (!launched.started) {
      return { connected: false, baseUrl: launched.baseUrl, model: '', models: 0, free: 0, error: launched.error }
    }
    const password = secrets.get(SECRET_ID)
    const models = await listOpenCodeModels(launched.baseUrl, password).catch(() => [] as OpenCodeModelInfo[])
    if (models.length === 0) {
      return {
        connected: false,
        baseUrl: launched.baseUrl,
        model: '',
        models: 0,
        free: 0,
        error: 'OpenCode is running, but it offered no models. Sign in to OpenCode and try again.'
      }
    }
    // Prefer a free model: the whole point is using what the user already has.
    const preferred = models.find((model) => model.free) ?? models[0]

    const settings = settingsDomain.get()
    await settingsDomain.update({
      activeProvider: 'opencode',
      providers: {
        ...settings.providers,
        opencode: {
          ...settings.providers.opencode,
          baseUrl: launched.baseUrl,
          model: preferred.id
        }
      }
    })

    return {
      connected: true,
      baseUrl: launched.baseUrl,
      model: preferred.id,
      models: models.length,
      free: models.filter((model) => model.free).length
    }
  }

  /** Stop a server we started. */
  stopOpenCode(): void {
    if (!running) return
    try {
      running.child.kill()
    } catch (error) {
      logger.warn('Could not stop the OpenCode server', error)
    }
    running = null
  }
}

export const localAgentLauncher = new LocalAgentLauncher()
