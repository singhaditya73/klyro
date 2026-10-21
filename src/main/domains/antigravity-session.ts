import { createServer, request as httpRequest, type Server } from 'node:http'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'
import { secrets } from '../security/secrets'

/**
 * Antigravity's "connect once" — use the IDE's models with the IDE closed.
 *
 * The Antigravity IDE is a client of its own language server. The server gets
 * its account session from the IDE's *sidecar* (the extension server), which
 * hands it a per-topic state blob over Connect-RPC:
 *
 *   POST /exa.extension_server_pb.ExtensionServerService/SubscribeToUnifiedStateSyncTopic
 *     content-type: application/connect+proto
 *     body: <connect frame> <protobuf: field 1 = topic name>
 *   → a stream of <connect frame> <protobuf UnifiedStateSyncUpdate>
 *
 * The `uss-oauth` topic carries the OAuth access token *and* the refresh
 * token, so a captured copy is enough to keep the session alive: the server
 * refreshes the access token itself when it expires.
 *
 * So "connect once" is: subscribe to the IDE's sidecar, save what it says,
 * and afterwards replay it to a language server Klyro started itself.
 */

const SERVICE = 'exa.extension_server_pb.ExtensionServerService'
const SUBSCRIBE = 'SubscribeToUnifiedStateSyncTopic'

/**
 * The topics the language server subscribes to at startup. Capturing all of
 * them keeps the replayed server as close to the IDE's own as possible.
 */
export const ANTIGRAVITY_STATE_TOPICS = [
  'uss-agentPreferences',
  'uss-oauth',
  'uss-browserPreferences',
  'uss-enterprisePreferences',
  'uss-userStatus',
  'uss-modelPreferences',
  'uss-editorPreferences',
  'uss-tabPreferences',
  'uss-windowPreferences',
  'uss-overrideStore',
  'uss-modelCredits'
] as const

export interface AntigravitySession {
  /** Captured when the session was taken. */
  capturedAt: string
  /** topic name → the raw Connect-RPC frames the sidecar sent. */
  topics: Record<string, string>
}

export interface AntigravitySidecar {
  port: number
  token: string
}

export interface AntigravityCaptureResult {
  ok: boolean
  error?: string
  /** The captured topics, keyed by topic name. */
  topics?: Record<string, string>
}

// --- protobuf helpers ---------------------------------------------------------

function varint(value: number): Buffer {
  const bytes: number[] = []
  let n = value
  while (n > 127) {
    bytes.push((n & 127) | 128)
    n >>>= 7
  }
  bytes.push(n)
  return Buffer.from(bytes)
}

/** A protobuf field: length-delimited (wire type 2). */
function lengthDelimited(field: number, payload: Buffer): Buffer {
  return Buffer.concat([varint((field << 3) | 2), varint(payload.length), payload])
}

/** A Connect-RPC frame: one flag byte plus a four-byte length. */
function connectFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(5)
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

/** The topic name out of a subscription request body. */
export function readTopicFromRequest(body: Buffer): string | null {
  if (body.length < 7) return null
  const length = body.readUInt32BE(1)
  const payload = body.subarray(5, 5 + length)
  if (payload.length < 2 || payload[0] !== 0x0a) return null
  return payload.subarray(2, 2 + payload[1]).toString('utf8')
}

// --- finding the IDE's sidecar -------------------------------------------------

/**
 * The IDE's extension server: its port and CSRF token are handed to the
 * language server on the command line, so they can be read from `/proc`.
 *
 * There can be more than one language server on the machine — including the
 * ones Klyro starts itself — so every candidate is returned and the caller
 * picks the one that actually answers.
 */
export function findIdeSidecars(excludePids: string[] = []): AntigravitySidecar[] {
  if (process.platform !== 'linux') return []
  let output = ''
  try {
    output = execFileSync('pgrep', ['-af', 'language_server_linux_x64'], { encoding: 'utf8', timeout: 4000 })
  } catch {
    return []
  }
  const sidecars: AntigravitySidecar[] = []
  for (const line of output.split('\n')) {
    if (!line.includes('language_server_linux_x64')) continue
    const pid = line.trim().split(/\s+/)[0]
    if (excludePids.includes(pid)) continue
    const port = line.match(/--extension_server_port (\d+)/)?.[1]
    const token = line.match(/--extension_server_csrf_token (\S+)/)?.[1]
    if (port && token) sidecars.push({ port: Number(port), token })
  }
  return sidecars
}

/** The first sidecar that answers, if any. */
export function findIdeSidecar(excludePids: string[] = []): AntigravitySidecar | null {
  return findIdeSidecars(excludePids)[0] ?? null
}

// --- capturing the session -----------------------------------------------------

/** One Connect-RPC call that reads until the stream goes quiet. */
function subscribe(
  sidecar: AntigravitySidecar,
  topic: string,
  idleMs: number
): Promise<{ status: number; body: Buffer }> {
  const payload = lengthDelimited(1, Buffer.from(topic, 'utf8'))
  const body = connectFrame(payload)
  return new Promise((resolve, reject) => {
    let settled = false
    const chunks: Buffer[] = []
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: sidecar.port,
        path: `/${SERVICE}/${SUBSCRIBE}`,
        method: 'POST',
        headers: {
          'content-type': 'application/connect+proto',
          'connect-protocol-version': '1',
          'x-codeium-csrf-token': sidecar.token,
          'content-length': body.length
        }
      },
      (response) => {
        const finish = () => {
          if (settled) return
          settled = true
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) })
        }
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', finish)
        // The subscription stays open for as long as the IDE runs, so we take
        // what has arrived once the stream has been quiet for a moment.
        const timer = setTimeout(() => {
          // Settle before tearing the socket down: destroying it raises an
          // error, which would otherwise reject the promise we are resolving.
          finish()
          request.destroy()
        }, idleMs)
        response.on('close', () => clearTimeout(timer))
      }
    )
    request.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    request.end(body)
  })
}

/**
 * Take a snapshot of the IDE's state — the one-time connect.
 *
 * The IDE has to be running for this: it owns the account session. Once
 * captured, the snapshot is enough on its own.
 */
export async function captureIdeState(
  idleMs = 1200,
  excludePids: string[] = []
): Promise<AntigravityCaptureResult> {
  const sidecars = findIdeSidecars(excludePids)
  if (sidecars.length === 0) {
    return {
      ok: false,
      error:
        'No Antigravity service is running. Open the Antigravity IDE once so Klyro can connect to your account.'
    }
  }
  // More than one language server can be running — including services Klyro
  // started itself, which have no IDE behind them. Try each until one hands
  // over an account session.
  for (const sidecar of sidecars) {
    const topics = await captureFrom(sidecar, idleMs)
    if (topics['uss-oauth']) return { ok: true, topics }
  }
  return {
    ok: false,
    error:
      'Antigravity did not hand over an account session. Sign in to Antigravity in the IDE, then try again.'
  }
}

/** Read every topic from one sidecar. */
async function captureFrom(sidecar: AntigravitySidecar, idleMs: number): Promise<Record<string, string>> {
  const topics: Record<string, string> = {}
  for (const topic of ANTIGRAVITY_STATE_TOPICS) {
    try {
      const result = await subscribe(sidecar, topic, idleMs)
      if (result.status === 200 && result.body.length > 0) {
        topics[topic] = result.body.toString('base64')
      }
    } catch {
      // A topic the IDE does not publish is not an error.
    }
  }
  return topics
}

// --- storing the session ------------------------------------------------------

/**
 * Where the captured session lives when the OS keychain is not available.
 *
 * It sits next to the rest of Klyro's data (the app's own user-data folder),
 * and `KLYRO_STATE_DIR` moves it elsewhere — which is what the tests use so
 * they never touch the real one.
 */
export function sessionDirectory(): string {
  const override = process.env.KLYRO_STATE_DIR
  if (override) return override
  try {
    return app.getPath('userData')
  } catch {
    return join(homedir(), '.config', 'klyro')
  }
}

export function sessionPath(): string {
  return join(sessionDirectory(), 'antigravity-session.json')
}

/** The id the session is stored under in the encrypted secret store. */
const SECRET_ID = 'antigravity.session'

export function saveSession(session: AntigravitySession): void {
  const payload = JSON.stringify(session)
  try {
    secrets.set(SECRET_ID, payload)
    removeSessionFile()
    return
  } catch {
    // The keychain is not available: fall through to the file below.
  }
  const path = sessionPath()
  mkdirSync(sessionDirectory(), { recursive: true })
  writeFileSync(path, payload, { mode: 0o600 })
}

export function loadSession(): AntigravitySession | null {
  const fromStore = readSession(() => secrets.get(SECRET_ID))
  if (fromStore) return fromStore
  return readSession(() => {
    const path = sessionPath()
    if (!existsSync(path)) return null
    return readFileSync(path, 'utf8')
  })
}

export function clearSession(): void {
  try {
    secrets.delete(SECRET_ID)
  } catch {
    /* nothing stored there */
  }
  removeSessionFile()
}

function readSession(read: () => string | null): AntigravitySession | null {
  try {
    const raw = read()
    if (!raw) return null
    const parsed = JSON.parse(raw) as AntigravitySession
    if (!parsed?.topics?.['uss-oauth']) return null
    return parsed
  } catch {
    return null
  }
}

function removeSessionFile(): void {
  try {
    rmSync(sessionPath(), { force: true })
  } catch {
    /* nothing to remove */
  }
}

// --- replaying the session ----------------------------------------------------

/**
 * A sidecar that replays a captured session, so a language server Klyro
 * started itself sees exactly what the IDE's sidecar would have sent.
 */
export class ReplaySidecar {
  private server: Server | null = null
  private sockets = new Set<import('node:net').Socket>()
  port = 0
  readonly token: string

  constructor(session: AntigravitySession) {
    this.token = randomUUID()
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const body = Buffer.concat(chunks)
        const path = request.url ?? ''
        if (path.includes(SUBSCRIBE)) {
          const topic = readTopicFromRequest(body)
          const captured = topic ? session.topics[topic] : undefined
          response.writeHead(200, { 'content-type': 'application/connect+proto' })
          // Send the headers even when there is nothing to send, so the client
          // sees the subscription start.
          response.flushHeaders()
          if (captured) response.write(Buffer.from(captured, 'base64'))
          // The stream must stay open: the client treats the end of it as a
          // protocol error and retries.
          const socket = response.socket
          if (socket) {
            this.sockets.add(socket)
            socket.on('close', () => this.sockets.delete(socket))
          }
          return
        }
        // Everything else (LanguageServerStarted and friends) is answered
        // with an empty successful response.
        response.writeHead(200, { 'content-type': 'application/proto' })
        response.end()
      })
    })
  }

  async listen(): Promise<number> {
    if (!this.server) throw new Error('The replay sidecar is not running.')
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    const address = this.server.address()
    if (address === null || typeof address === 'string') throw new Error('Could not start the replay sidecar.')
    this.port = address.port
    return address.port
  }

  close(): void {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    this.server?.close()
    this.server = null
  }
}
