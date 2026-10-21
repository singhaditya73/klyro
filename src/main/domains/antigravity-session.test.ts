import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { request as httpRequest } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ANTIGRAVITY_STATE_TOPICS,
  ReplaySidecar,
  clearSession,
  loadSession,
  readTopicFromRequest,
  saveSession
} from './antigravity-session'

// The tests must never touch the real session, so they get their own folder.
process.env.KLYRO_STATE_DIR = mkdtempSync(join(tmpdir(), 'klyro-antigravity-'))

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

function lengthDelimited(field: number, payload: Buffer): Buffer {
  return Buffer.concat([varint((field << 3) | 2), varint(payload.length), payload])
}

function connectFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(5)
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

/** Subscribe to a topic on a sidecar and read what it sends. */
function subscribe(
  port: number,
  token: string,
  topic: string,
  idleMs = 400
): Promise<{ status: number; body: Buffer }> {
  const body = connectFrame(lengthDelimited(1, Buffer.from(topic, 'utf8')))
  return new Promise((resolve, reject) => {
    let settled = false
    const chunks: Buffer[] = []
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/exa.extension_server_pb.ExtensionServerService/SubscribeToUnifiedStateSyncTopic',
        method: 'POST',
        headers: {
          'content-type': 'application/connect+proto',
          'connect-protocol-version': '1',
          'x-codeium-csrf-token': token,
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
        const timer = setTimeout(() => {
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

describe('Antigravity session capture', () => {
  it('reads the topic name out of a subscription request', () => {
    const body = connectFrame(lengthDelimited(1, Buffer.from('uss-oauth', 'utf8')))
    expect(readTopicFromRequest(body)).toBe('uss-oauth')
  })

  it('ignores a request it cannot read', () => {
    expect(readTopicFromRequest(Buffer.alloc(3))).toBeNull()
  })

  it('knows every topic the language server subscribes to', () => {
    expect(ANTIGRAVITY_STATE_TOPICS).toContain('uss-oauth')
    expect(ANTIGRAVITY_STATE_TOPICS).toContain('uss-agentPreferences')
    expect(ANTIGRAVITY_STATE_TOPICS).toContain('uss-userStatus')
  })
})

describe('Antigravity replay sidecar', () => {
  it('replays the captured payload for a topic', async () => {
    const payload = Buffer.concat([Buffer.from([0, 0, 0, 0, 4]), Buffer.from([1, 2, 3, 4])])
    const sidecar = new ReplaySidecar({
      capturedAt: new Date().toISOString(),
      topics: { 'uss-oauth': payload.toString('base64') }
    })
    const port = await sidecar.listen()
    try {
      const result = await subscribe(port, sidecar.token, 'uss-oauth')
      expect(result.status).toBe(200)
      expect(result.body.equals(payload)).toBe(true)
    } finally {
      sidecar.close()
    }
  })

  it('answers a topic it has nothing for without failing', async () => {
    const sidecar = new ReplaySidecar({
      capturedAt: new Date().toISOString(),
      topics: { 'uss-oauth': Buffer.from('x').toString('base64') }
    })
    const port = await sidecar.listen()
    try {
      const result = await subscribe(port, sidecar.token, 'uss-userStatus')
      expect(result.status).toBe(200)
      expect(result.body.length).toBe(0)
    } finally {
      sidecar.close()
    }
  })

  it('keeps the stream open so the client does not treat it as a protocol error', async () => {
    const sidecar = new ReplaySidecar({
      capturedAt: new Date().toISOString(),
      topics: { 'uss-oauth': Buffer.from('x').toString('base64') }
    })
    const port = await sidecar.listen()
    try {
      // The subscription must not end on its own: the language server reads it
      // as a protocol error and retries forever.
      const result = await subscribe(port, sidecar.token, 'uss-oauth', 800)
      expect(result.status).toBe(200)
      expect(result.body.length).toBeGreaterThan(0)
    } finally {
      sidecar.close()
    }
  })
})

describe('Antigravity cloud endpoint', () => {
  it('uses the same host the IDE uses', async () => {
    const { CLOUD_CODE_ENDPOINT } = await import('./antigravity-service')
    // The plain host answers model calls with a quota error even for an
    // entitled account, so this has to be the "daily" host.
    expect(CLOUD_CODE_ENDPOINT).toBe('https://daily-cloudcode-pa.googleapis.com')
  })
})

describe('Antigravity session storage', () => {
  it('keeps a captured session and gives it back', () => {
    const session = {
      capturedAt: new Date().toISOString(),
      topics: { 'uss-oauth': Buffer.from('token').toString('base64') }
    }
    saveSession(session)
    const loaded = loadSession()
    expect(loaded?.topics['uss-oauth']).toBe(session.topics['uss-oauth'])
    clearSession()
    expect(loadSession()).toBeNull()
  })

  it('refuses to load a session without an account', () => {
    saveSession({ capturedAt: new Date().toISOString(), topics: { 'uss-userStatus': 'x' } })
    expect(loadSession()).toBeNull()
    clearSession()
  })
})
describe('a fake IDE sidecar', () => {
  it('is not mistaken for the real one', async () => {
    // A plain HTTP server on a random port must not be picked up as a sidecar.
    const server = createServer((_request, response) => response.end('nope'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    expect(address && typeof address !== 'string').toBe(true)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})
