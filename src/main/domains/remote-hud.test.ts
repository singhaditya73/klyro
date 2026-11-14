import { afterEach, describe, expect, it } from 'vitest'
import {
  broadcastRemoteHud,
  getRemoteHudPairing,
  getRemoteHudUrl,
  rotatePairingCode,
  startRemoteHudServer,
  stopRemoteHudServer
} from './remote-hud'

/**
 * The phone HUD is reachable by anything on the network, so its address must
 * not be the credential. These tests pin that: no token in a URL, a one-time
 * code to pair, a bearer token for every data route, and a rate limit so six
 * digits cannot be guessed.
 */

afterEach(() => {
  stopRemoteHudServer()
})

async function pair(port: number, code: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code })
  })
}

describe('the Ghost Phone HUD server', () => {
  it('listens on loopback and keeps every secret out of the URL', async () => {
    const started = await startRemoteHudServer(0)
    expect(started.url).toContain('127.0.0.1')
    // The address a user copies is not a credential.
    expect(started.url).not.toContain('t=')
    expect(started.url).not.toContain(started.pairingCode)
    expect(started.pairingCode).toMatch(/^\d{6}$/)

    const page = await fetch(`http://127.0.0.1:${started.port}/`)
    expect(page.status).toBe(200)
    expect(page.headers.get('access-control-allow-origin')).toBeNull()
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")

    requireNoToken(await fetch(`http://127.0.0.1:${started.port}/api/status`))
  })

  it('refuses the data until the device proves it holds the code', async () => {
    const started = await startRemoteHudServer(0)

    const wrong = await pair(started.port, '000000')
    expect(wrong.status).toBe(403)

    const right = await pair(started.port, started.pairingCode)
    expect(right.status).toBe(200)
    const body = (await right.json()) as { ok: boolean; token: string; expiresAt: number }
    expect(body.ok).toBe(true)
    expect(body.token).toMatch(/^[0-9a-f]{48}$/)
    expect(body.expiresAt).toBeGreaterThan(Date.now())

    const status = await fetch(`http://127.0.0.1:${started.port}/api/status`, {
      headers: { authorization: `Bearer ${body.token}` }
    })
    expect(status.status).toBe(200)

    // The token is not accepted from a URL.
    requireNoToken(await fetch(`http://127.0.0.1:${started.port}/api/status?t=${body.token}`))
  })

  it('uses a code once, and rate-limits the guesses', async () => {
    const started = await startRemoteHudServer(0)
    expect((await pair(started.port, started.pairingCode)).status).toBe(200)
    expect((await pair(started.port, started.pairingCode)).status).toBe(403)

    // A fresh code, then a burst of wrong ones from the same address.
    rotatePairingCode()
    const codes = await Promise.all(
      Array.from({ length: 9 }, (_, index) => pair(started.port, String(index).padStart(6, '0')))
    )
    expect(codes.at(-1)?.status).toBe(429)
  })

  it('gives the paired device live state and no one else', async () => {
    const started = await startRemoteHudServer(0)
    const paired = (await (await pair(started.port, started.pairingCode)).json()) as { token: string }

    const controller = new AbortController()
    const stream = await fetch(`http://127.0.0.1:${started.port}/events`, {
      headers: { authorization: `Bearer ${paired.token}` },
      signal: controller.signal
    })
    expect(stream.status).toBe(200)
    const reader = stream.body!.getReader()
    const decoder = new TextDecoder()
    const first = decoder.decode((await reader.read()).value)
    expect(first).toContain('"type":"init"')

    broadcastRemoteHud({ type: 'question', question: 'What is the deadline?' })
    const second = decoder.decode((await reader.read()).value)
    expect(second).toContain('What is the deadline?')
    controller.abort()

    requireNoToken(await fetch(`http://127.0.0.1:${started.port}/events`))
  })

  it('shows a fresh code when the old one expired or was used', async () => {
    const started = await startRemoteHudServer(0)
    await pair(started.port, started.pairingCode)
    const next = getRemoteHudPairing()
    expect(next.code).toMatch(/^\d{6}$/)
    expect(next.code).not.toBe(started.pairingCode)
    expect(next.url).toBe(getRemoteHudUrl())
  })
})

function requireNoToken(response: Response): void {
  expect(response.status).toBe(403)
}
