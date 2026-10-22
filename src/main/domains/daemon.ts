import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Socket } from 'node:net'
import { logger } from '../logger'

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

const STATE_NAME = 'klyro-core.json'
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
  /** The program to run, for the agent CLIs. */
  binary?: string
  /** The port the Antigravity service listens on. */
  port?: number
  /** The token the Antigravity service answers to. */
  csrf?: string
}

export type DaemonEvent =
  | { kind: 'hello'; version: string; pid: number; socket: string }
  | { kind: 'delta'; text: string }
  | { kind: 'done'; ms: number }
  | { kind: 'models'; models: DaemonModel[] }
  | { kind: 'transcribed'; text: string }
  | { kind: 'prewarmed' }
  | { kind: 'error'; message: string }
  | { kind: 'pong' }

/** Where the daemon says it is listening. */
export function daemonStatePath(): string {
  return join(process.env.KLYRO_STATE_DIR ?? join(homedir(), '.config', 'klyro'), STATE_NAME)
}

/** Where the bundled Whisper model file lives. */
export function bundledWhisperModelPath(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'models', 'whisper', 'ggml-base.en-q5_1.bin'),
    join(__dirname, '..', '..', 'resources', 'models', 'whisper', 'ggml-base.en-q5_1.bin'),
    join(process.cwd(), 'resources', 'models', 'whisper', 'ggml-base.en-q5_1.bin')
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** What the daemon told us about itself. */
interface DaemonState {
  port: number
  token: string
  pid: number
  version: string
}

function readDaemonState(): DaemonState | null {
  try {
    const parsed = JSON.parse(readFileSync(daemonStatePath(), 'utf8')) as DaemonState
    if (!parsed?.port || !parsed?.token) return null
    return parsed
  } catch {
    return null
  }
}

/** What the binary on disk says its version is, or null when it cannot run. */
function binaryVersion(binary: string): string | null {
  try {
    const version = execFileSync(binary, ['--version'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return version || null
  } catch {
    return null
  }
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

  /**
   * The version the running daemon reports, or null when it does not answer.
   *
   * A daemon outlives an app update: the process started by yesterday's Klyro
   * keeps holding the hot path, so a fix in the Rust provider would never be
   * used. The app compares this with the binary on disk and replaces the daemon
   * when they differ.
   */
  async version(): Promise<string | null> {
    const state = readDaemonState()
    if (!state) return null
    return new Promise((resolve) => {
      const socket = new Socket()
      let buffer = ''
      const finish = (version: string | null): void => {
        clearTimeout(timer)
        socket.destroy()
        resolve(version)
      }
      const timer = setTimeout(() => finish(null), CONNECT_TIMEOUT_MS)
      socket.once('connect', () => {
        socket.write(`${JSON.stringify({ kind: 'auth', token: state.token })}\n`)
      })
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
        let index = buffer.indexOf('\n')
        while (index !== -1) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (line) {
            try {
              const event = JSON.parse(line) as DaemonEvent
              if (event.kind === 'hello') {
                finish(event.version)
                return
              }
            } catch {
              // Ignore a line we cannot read.
            }
          }
          index = buffer.indexOf('\n')
        }
      })
      socket.on('error', () => finish(null))
      socket.connect(state.port, '127.0.0.1')
    })
  }

  /** Close our connection (used before replacing a stale daemon). */
  disconnect(): void {
    this.socket?.destroy()
    this.socket = null
  }

  private connect(): Promise<boolean> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(true)
    if (this.connecting) return this.connecting
    this.connecting = new Promise<boolean>((resolve) => {
      const state = readDaemonState()
      if (!state) {
        resolve(false)
        return
      }
      const socket = new Socket()
      const timer = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, CONNECT_TIMEOUT_MS)
      socket.once('connect', () => {
        clearTimeout(timer)
        this.socket = socket
        this.attach(socket)
        // The daemon serves nothing without its token.
        socket.write(`${JSON.stringify({ kind: 'auth', token: state.token })}\n`)
        resolve(true)
      })
      socket.once('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
      socket.connect(state.port, '127.0.0.1')
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

  /**
   * Ask a question; the answer streams back through `onEvent`.
   *
   * This resolves when the answer is *complete*, not when the request has
   * been sent — the caller waits for the whole answer.
   */
  async ask(request: DaemonAsk, onEvent: (event: DaemonEvent) => void): Promise<boolean> {
    if (!(await this.connect())) return false
    const socket = this.socket
    if (!socket) return false
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener)
        resolve(false)
      }, 180000)
      const listener = (event: DaemonEvent): void => {
        if (event.kind === 'delta' || event.kind === 'error' || event.kind === 'done') onEvent(event)
        if (event.kind === 'done' || event.kind === 'error') {
          clearTimeout(timer)
          this.listeners.delete(listener)
          resolve(true)
        }
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
          images: (request.images ?? []).map((image) => ({ data_url: image.dataUrl, mime: image.mime })),
          binary: request.binary ?? '',
          port: request.port ?? 0,
          csrf: request.csrf ?? ''
        })}\n`
      )
    })
  }

  /** Transcribe 16kHz mono float32 audio samples using local bundled whisper. */
  async transcribe(audioPcmBase64: string, modelPath: string): Promise<string> {
    if (!(await this.connect())) throw new Error('Local speech engine daemon is not running')
    const socket = this.socket
    if (!socket) throw new Error('Local speech engine socket is not connected')
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener)
        reject(new Error('Local transcription timed out'))
      }, 60000)
      const listener = (event: DaemonEvent): void => {
        if (event.kind === 'transcribed') {
          clearTimeout(timer)
          this.listeners.delete(listener)
          resolve(event.text)
        } else if (event.kind === 'error') {
          clearTimeout(timer)
          this.listeners.delete(listener)
          reject(new Error(event.message))
        }
      }
      this.listeners.add(listener)
      socket.write(
        `${JSON.stringify({
          kind: 'transcribe',
          audio_pcm_base64: audioPcmBase64,
          model_path: modelPath
        })}\n`
      )
    })
  }

  /** Prewarm the local Whisper model in RAM for zero first-utterance latency. */
  async prewarm(modelPath: string): Promise<boolean> {
    const answer = await this.request<{ kind: 'prewarmed' }>(
      { kind: 'prewarm', model_path: modelPath },
      (event) => event.kind === 'prewarmed' || event.kind === 'error'
    )
    return Boolean(answer && answer.kind === 'prewarmed')
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

  /**
   * Start the daemon, if it is built and not already running.
   *
   * A daemon that runs is compared with the binary on disk: if their versions
   * differ, the running one is from another build (an update, or a leftover
   * process) and is replaced. Otherwise a Rust fix would never reach the app
   * that ships it, because the old process outlives the update.
   */
  async start(): Promise<boolean> {
    if (this.started) return true
    this.started = true
    const binary = daemonBinary()
    if (await this.client.available()) {
      const running = await this.client.version()
      const expected = binary ? binaryVersion(binary) : null
      if (!expected || !running || running === expected) {
        const model = bundledWhisperModelPath()
        if (model) void this.client.prewarm(model).catch(() => undefined)
        return true
      }
      await this.replaceStale()
    }
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
      if (await this.client.available()) {
        const model = bundledWhisperModelPath()
        if (model) void this.client.prewarm(model).catch(() => undefined)
        return true
      }
    }
    return false
  }

  /** Stop a daemon from another build and wait for its socket to close. */
  private async replaceStale(): Promise<void> {
    const state = readDaemonState()
    logger.info('Replacing a daemon from another build', { pid: state?.pid ?? null })
    if (state?.pid) {
      try {
        process.kill(state.pid, 'SIGTERM')
      } catch {
        // Already gone, or not ours to signal.
      }
    }
    this.client.disconnect()
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!(await this.client.available())) return
      this.client.disconnect()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    logger.warn('The old daemon is still answering after a stop request')
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

  /** Transcribe speech locally using the bundled whisper model. */
  async transcribe(audioPcmBase64: string, modelPath: string): Promise<string> {
    if (!(await this.start())) throw new Error('Could not start local speech engine')
    return this.client.transcribe(audioPcmBase64, modelPath)
  }

  /** Prewarm the bundled Whisper model into memory. */
  async prewarm(modelPath: string): Promise<boolean> {
    if (!(await this.start())) return false
    return this.client.prewarm(modelPath)
  }
}

export const daemon = new DaemonDomain()
