import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createConnection, type Socket } from 'node:net'

/**
 * The Klyro daemon.
 *
 * `klyro-core` is a small Rust process that owns the hot path: it keeps the
 * provider connections warm and answers questions over a local socket. The
 * app is its control panel — it starts the daemon, hands it the provider
 * configuration (keys included, in memory), and asks it things.
 *
 * The app works perfectly well without the daemon; when it is there, the
 * overlay's answer comes from a process that starts in 2.3 ms and lives in
 * 4 MB, instead of from a browser runtime that lives in 851 MB.
 */

const SOCKET_NAME = 'klyro-core.sock'
const CONNECT_TIMEOUT_MS = 1500

export interface DaemonProvider {
  id: string
  baseUrl: string
  model: string
  apiKey: string | null
}

export interface DaemonModel {
  id: string
  name: string
  provider: string
}

export interface DaemonAsk {
  provider: string
  model: string
  baseUrl?: string
  apiKey?: string | null
  prompt: string
  images?: Array<{ dataUrl: string; mime: string }>
}

export type DaemonEvent =
  | { kind: 'hello'; version: string; pid: number; socket: string }
  | { kind: 'delta'; text: string }
  | { kind: 'done'; ms: number }
  | { kind: 'models'; models: DaemonModel[] }
  | { kind: 'error'; message: string }
  | { kind: 'pong' }

/** Where the daemon listens. */
export function daemonSocketPath(): string {
  return join(process.env.KLYRO_STATE_DIR ?? join(homedir(), '.config', 'klyro'), SOCKET_NAME)
}

/** Where the built daemon may live. */
function daemonBinary(): string | null {
  const roots = [
    // Packaged: next to the app.
    join(process.resourcesPath ?? '', 'klyro-core'),
    // Development: the cargo output.
    join(__dirname, '..', '..', 'crates', 'klyro-core', 'target', 'release', 'klyro-core'),
    join(__dirname, '..', '..', 'crates', 'klyro-core', 'target', 'debug', 'klyro-core')
  ]
  for (const root of roots) {
    if (existsSync(root)) return root
    // Windows names the binary ".exe".
    if (process.platform === 'win32' && existsSync(`${root}.exe`)) return `${root}.exe`
  }
  return null
}

class DaemonClient {
  private socket: Socket | null = null
  private buffer = ''
  private listeners = new Set<(event: DaemonEvent) => void>()
  private connecting: Promise<boolean> | null = null

  /** Is the daemon there? */
  async available(): Promise<boolean> {
    return this.connect()
  }

  private connect(): Promise<boolean> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(true)
    if (this.connecting) return this.connecting
    this.connecting = new Promise<boolean>((resolve) => {
      const socket = createConnection(daemonSocketPath())
      const timer = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, CONNECT_TIMEOUT_MS)
      socket.once('connect', () => {
        clearTimeout(timer)
        this.socket = socket
        this.attach(socket)
        resolve(true)
      })
      socket.once('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
    return this.connecting.finally(() => {
      this.connecting = null
    })
  }

  private attach(socket: Socket): void {
    socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8')
      let index = this.buffer.indexOf('\n')
      while (index !== -1) {
        const line = this.buffer.slice(0, index).trim()
        this.buffer = this.buffer.slice(index + 1)
        if (line) {
          try {
            const event = JSON.parse(line) as DaemonEvent
            for (const listener of this.listeners) listener(event)
          } catch {
            // A line we cannot read is not worth crashing over.
          }
        }
        index = this.buffer.indexOf('\n')
      }
    })
    socket.on('close', () => {
      this.socket = null
    })
    socket.on('error', () => {
      this.socket = null
    })
  }

  /** Send a request and wait for its answer. */
  private async request<T extends DaemonEvent>(payload: Record<string, unknown>, match: (event: DaemonEvent) => boolean): Promise<T | null> {
    if (!(await this.connect())) return null
    const socket = this.socket
    if (!socket) return null
    return new Promise<T | null>((resolve) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener)
        resolve(null)
      }, 120000)
      const listener = (event: DaemonEvent): void => {
        if (!match(event)) return
        clearTimeout(timer)
        this.listeners.delete(listener)
        resolve(event as T)
      }
      this.listeners.add(listener)
      socket.write(`${JSON.stringify(payload)}\n`)
    })
  }

  /** Hand the daemon the providers it may use. */
  async configure(providers: DaemonProvider[]): Promise<boolean> {
    if (!(await this.connect())) return false
    const socket = this.socket
    if (!socket) return false
    socket.write(
      `${JSON.stringify({
        kind: 'configure',
        providers: providers.map((provider) => ({
          id: provider.id,
          base_url: provider.baseUrl,
          model: provider.model,
          api_key: provider.apiKey
        }))
      })}\n`
    )
    return true
  }

  /** The models a provider can serve. */
  async models(provider: string): Promise<DaemonModel[]> {
    const answer = await this.request<{ kind: 'models'; models: DaemonModel[] }>(
      { kind: 'models', provider },
      (event) => event.kind === 'models' || event.kind === 'error'
    )
    if (answer && answer.kind === 'models') return answer.models
    return []
  }

  /** Ask a question; the answer streams back through `onEvent`. */
  async ask(request: DaemonAsk, onEvent: (event: DaemonEvent) => void): Promise<boolean> {
    if (!(await this.connect())) return false
    const socket = this.socket
    if (!socket) return false
    const listener = (event: DaemonEvent): void => {
      if (event.kind === 'delta' || event.kind === 'error' || event.kind === 'done') onEvent(event)
    }
    this.listeners.add(listener)
    socket.write(
      `${JSON.stringify({
        kind: 'ask',
        provider: request.provider,
        model: request.model,
        base_url: request.baseUrl ?? '',
        api_key: request.apiKey ?? null,
        prompt: request.prompt,
        images: (request.images ?? []).map((image) => ({ data_url: image.dataUrl, mime: image.mime }))
      })}\n`
    )
    return true
  }

  /** Stop listening to the daemon's events. */
  onEvent(listener: (event: DaemonEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

class DaemonDomain {
  private client = new DaemonClient()
  private child: ChildProcess | null = null
  private started = false

  /** Start the daemon, if it is built and not already running. */
  async start(): Promise<boolean> {
    if (this.started) return true
    this.started = true
    if (await this.client.available()) return true
    const binary = daemonBinary()
    if (!binary) return false
    try {
      this.child = spawn(binary, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      this.child.unref()
    } catch {
      this.child = null
      return false
    }
    // Give it a moment to bind its socket.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (await this.client.available()) return true
    }
    return false
  }

  /** Stop the daemon we started. */
  stop(): void {
    if (!this.child) return
    try {
      this.child.kill()
    } catch {
      // Already gone.
    }
    this.child = null
  }

  /** Is the daemon answering? */
  async available(): Promise<boolean> {
    return this.client.available()
  }

  /** Hand the daemon the providers it may use, keys included. */
  async configure(providers: DaemonProvider[]): Promise<boolean> {
    if (!(await this.start())) return false
    return this.client.configure(providers)
  }

  /** The models a provider can serve, through the daemon. */
  async models(provider: string): Promise<DaemonModel[]> {
    if (!(await this.start())) return []
    return this.client.models(provider)
  }

  /** Ask a question through the daemon. */
  async ask(request: DaemonAsk, onEvent: (event: DaemonEvent) => void): Promise<boolean> {
    if (!(await this.start())) return false
    return this.client.ask(request, onEvent)
  }
}

export const daemon = new DaemonDomain()
