import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * The Antigravity language server, started by Klyro instead of the IDE.
 *
 * The IDE spawns this binary and hands it an "initial metadata" protobuf on
 * stdin (ide name, extension path, device fingerprint, the account token, …).
 * The server refuses to start without it — "Failed to read initial metadata
 * from stdin" — so Klyro builds the same message. The field numbers below come
 * from the message's own descriptor in the server binary (`Metadata` in
 * exa.language_server_pb).
 *
 * The account session comes from the IDE's sidecar, so a server Klyro starts
 * needs a sidecar too: `antigravity-session.ts` replays a captured session to
 * it, which is what makes the IDE unnecessary after a one-time connect.
 */

/**
 * The Antigravity cloud endpoint. The IDE points its language server at the
 * "daily" host — the plain host rejects model calls with a quota error even
 * though the account is entitled, so this has to match the IDE exactly.
 */
export const CLOUD_CODE_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com'

/** Field numbers of the `Metadata` message, read out of the server binary. */
const FIELD = {
  extensionPath: 1,
  ideVersion: 2,
  locale: 4,
  ideName: 8,
  sessionId: 9,
  extensionName: 12,
  lsTimestamp: 16,
  deviceFingerprint: 24,
  triggerId: 25,
  apiKey: 26,
  disableTelemetry: 27,
  userTierId: 29
} as const

function varint(value: number): Buffer {
  const bytes: number[] = []
  let remaining = value
  do {
    let byte = remaining & 0x7f
    remaining = Math.floor(remaining / 128)
    if (remaining > 0) byte |= 0x80
    bytes.push(byte)
  } while (remaining > 0)
  return Buffer.from(bytes)
}

function stringField(number: number, value: string): Buffer {
  const raw = Buffer.from(value, 'utf8')
  return Buffer.concat([varint((number << 3) | 2), varint(raw.length), raw])
}

function boolField(number: number, value: boolean): Buffer {
  return Buffer.concat([varint((number << 3) | 0), varint(value ? 1 : 0)])
}

function messageField(number: number, payload: Buffer): Buffer {
  return Buffer.concat([varint((number << 3) | 2), varint(payload.length), payload])
}

export interface MetadataOptions {
  extensionPath: string
  ideName?: string
  ideVersion?: string
  locale?: string
  deviceFingerprint?: string
  apiKey?: string
  userTierId?: string
  sessionId?: string
}

/** Build the initial metadata protobuf the server reads from stdin. */
export function buildInitialMetadata(options: MetadataOptions): Buffer {
  const seconds = Math.floor(Date.now() / 1000)
  const timestamp = Buffer.concat([varint((1 << 3) | 0), varint(seconds)])
  return Buffer.concat([
    stringField(FIELD.extensionPath, options.extensionPath),
    stringField(FIELD.ideVersion, options.ideVersion ?? '1.0.0'),
    stringField(FIELD.locale, options.locale ?? 'en'),
    stringField(FIELD.ideName, options.ideName ?? 'antigravity'),
    stringField(FIELD.sessionId, options.sessionId ?? randomUUID()),
    stringField(FIELD.extensionName, options.ideName ?? 'antigravity'),
    messageField(FIELD.lsTimestamp, timestamp),
    stringField(FIELD.deviceFingerprint, options.deviceFingerprint ?? 'klyro'),
    stringField(FIELD.triggerId, randomUUID()),
    stringField(FIELD.apiKey, options.apiKey ?? ''),
    boolField(FIELD.disableTelemetry, true),
    stringField(FIELD.userTierId, options.userTierId ?? '')
  ])
}

/** Where the Antigravity extension (and its language server) live. */
export function findAntigravityExtension(): { extensionPath: string; serverBinary: string } | null {
  const candidates = [
    '/opt/antigravity-ide/resources/app/extensions/antigravity',
    join(homedir(), '.local', 'share', 'antigravity-ide', 'resources', 'app', 'extensions', 'antigravity'),
    join(homedir(), '.config', 'Antigravity', 'resources', 'app', 'extensions', 'antigravity')
  ]
  for (const extensionPath of candidates) {
    for (const name of serverBinaryNames()) {
      const serverBinary = join(extensionPath, 'bin', name)
      if (existsSync(serverBinary)) return { extensionPath, serverBinary }
    }
  }
  return null
}

function serverBinaryNames(): string[] {
  if (process.platform === 'win32') return ['language_server_windows_x64.exe', 'language_server_windows_arm64.exe']
  if (process.platform === 'darwin') return ['language_server_macos_x64', 'language_server_macos_arm64']
  return ['language_server_linux_x64', 'language_server_linux_arm']
}

/**
 * Start the language server the way the IDE does, and hand it our metadata.
 *
 * `sidecar` points the server at a replay sidecar that stands in for the
 * IDE's own extension server — that is how a server Klyro started gets an
 * account session without the IDE running.
 */
export function startLanguageServer(
  serverBinary: string,
  extensionPath: string,
  options: { apiKey?: string; sidecar?: { port: number; token: string } } = {}
): { child: ChildProcess; token: string } {
  const token = randomUUID()
  const args = [
    '--csrf_token',
    token,
    '--app_data_dir',
    'antigravity-ide',
    '--subclient_type',
    'ide',
    '--cloud_code_endpoint',
    CLOUD_CODE_ENDPOINT
  ]
  if (options.sidecar) {
    args.push('--extension_server_port', String(options.sidecar.port))
    args.push('--extension_server_csrf_token', options.sidecar.token)
  }
  const child = spawn(serverBinary, args, {
    cwd: join(homedir(), '.local', 'share'),
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
    env: process.env
  })
  const metadata = buildInitialMetadata({
    extensionPath,
    apiKey: options.apiKey ?? '',
    deviceFingerprint: 'klyro'
  })
  child.stdin?.write(metadata)
  child.stdin?.end()
  return { child, token }
}

/** The pids of every Antigravity language server on this machine. */
export function findLanguageServerPids(): string[] {
  if (process.platform !== 'linux') return []
  let pids: string[] = []
  try {
    pids = readdirSync('/proc').filter((name) => /^\d+$/.test(name))
  } catch {
    return []
  }
  const found: string[] = []
  for (const pid of pids) {
    let cmdline = ''
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')
    } catch {
      continue
    }
    if (cmdline.includes('language_server_') && cmdline.includes('antigravity')) found.push(pid)
  }
  return found
}

/** The localhost ports a process listens on. */
export function listeningPorts(pid: string): number[] {
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
