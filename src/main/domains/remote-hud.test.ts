import { afterEach, describe, expect, it } from 'vitest'
import {
  broadcastRemoteHud,
  getRemoteHudUrl,
  startRemoteHudServer,
  stopRemoteHudServer
} from './remote-hud'

afterEach(() => {
  stopRemoteHudServer()
})

describe('the Ghost Phone HUD server', () => {
  it('listens on loopback unless LAN access was asked for', async () => {
    const started = await startRemoteHudServer(0)
    expect(started.url).toContain('127.0.0.1')
    expect(started.url).toMatch(/[?&]t=[0-9a-f]{36}/)
    // The page is served, but data routes need the session token.
    const page = await fetch(`http://127.0.0.1:${started.port}/`)
    expect(page.status).toBe(200)
    expect(page.headers.get('access-control-allow-origin')).toBeNull()
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
    const status = await fetch(`http://127.0.0.1:${started.port}/api/status`)
    expect(status.status).toBe(403)
  })

  it('gives the token holder the live state and refuses everyone else', async () => {
    const started = await startRemoteHudServer(0)
    broadcastRemoteHud({ type: 'question', question: 'What is the deadline?' })
    broadcastRemoteHud({ type: 'delta', text: 'Friday.' })

    const withToken = await fetch(getRemoteHudUrl().replace('/?t=', '/api/status?t='))
    expect(withToken.status).toBe(200)
    const body = (await withToken.json()) as { ok: boolean; state: { question: string; answer: string } }
    expect(body.ok).toBe(true)
    expect(body.state.question).toBe('What is the deadline?')
    expect(body.state.answer).toBe('Friday.')

    const wrong = await fetch(`http://127.0.0.1:${started.port}/api/status?t=not-the-token`)
    expect(wrong.status).toBe(403)
  })
})
