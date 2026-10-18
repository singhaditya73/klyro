import { describe, expect, it } from 'vitest'
import { Automation, InputBackendError, detectLinuxSession, summarizeLinuxCapabilities, type CommandRunner, type LinuxTools } from './automation'

function tools(overrides: Partial<LinuxTools> = {}): LinuxTools {
  return { xdotool: false, ydotool: false, wtype: false, ydotoold: false, uinput: false, ...overrides }
}

describe('detectLinuxSession', () => {
  it('prefers WAYLAND_DISPLAY, then XDG_SESSION_TYPE, then DISPLAY', () => {
    expect(detectLinuxSession({ WAYLAND_DISPLAY: 'wayland-0' })).toBe('wayland')
    expect(detectLinuxSession({ XDG_SESSION_TYPE: 'wayland' })).toBe('wayland')
    expect(detectLinuxSession({ XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' })).toBe('x11')
    expect(detectLinuxSession({ DISPLAY: ':0' })).toBe('x11')
    expect(detectLinuxSession({})).toBe('unknown')
  })
})

describe('summarizeLinuxCapabilities', () => {
  it('reports nothing available when no backend is installed', () => {
    const caps = summarizeLinuxCapabilities(tools(), 'x11')
    expect(caps.available).toBe(false)
    expect(caps.runtime.kind).toBe('executable-missing')
    expect(caps.missing).toContain('xdotool')
  })

  it('uses xdotool on X11 and treats ydotool as optional', () => {
    const caps = summarizeLinuxCapabilities(tools({ xdotool: true }), 'x11', { xdotool: true })
    expect(caps.available).toBe(true)
    expect(caps.backends).toEqual(['xdotool'])
    expect(caps.runtime.verifiedBackends).toEqual(['xdotool'])
    expect(caps.limitations.join(' ')).not.toMatch(/ydotool/)
  })

  it('explains the Wayland limitation when only xdotool is present', () => {
    const caps = summarizeLinuxCapabilities(tools({ xdotool: true }), 'wayland', { xdotool: true })
    expect(caps.available).toBe(true)
    expect(caps.missing).toContain('ydotool')
    expect(caps.limitations.join(' ')).toMatch(/Wayland/)
  })

  it('does not verify ydotool without the daemon or uinput access', () => {
    const noDaemon = summarizeLinuxCapabilities(tools({ ydotool: true }), 'wayland')
    expect(noDaemon.available).toBe(false)
    expect(noDaemon.runtime.kind).toBe('permission-denied')
    expect(noDaemon.limitations.join(' ')).toMatch(/ydotoold/)

    const ready = summarizeLinuxCapabilities(tools({ ydotool: true, ydotoold: true, uinput: true }), 'wayland', {
      ydotool: true
    })
    expect(ready.available).toBe(true)
    expect(ready.runtime.verifiedBackends).toContain('ydotool')
  })

  it('flags wtype-only setups as typing-only', () => {
    const caps = summarizeLinuxCapabilities(tools({ wtype: true }), 'wayland')
    expect(caps.available).toBe(false)
    expect(caps.limitations.join(' ')).toMatch(/typing works/)
  })

  it('records per-backend checks', () => {
    const caps = summarizeLinuxCapabilities(tools({ xdotool: true }), 'x11', { xdotool: true })
    expect(caps.runtime.checks.map((check) => check.name)).toEqual(['xdotool', 'ydotool', 'wtype'])
  })
})

function fakeRunner(available: string[]) {
  const calls: { binary: string; args: string[] }[] = []
  const runner: CommandRunner = async (binary, args) => {
    calls.push({ binary, args })
    if (binary === 'sh' && args[0] === '-c') {
      const match = /command -v (\S+)/.exec(args[1])
      if (match && available.includes(match[1])) return
      throw new Error('not found')
    }
    if (available.includes(binary)) return
    throw new Error('missing')
  }
  return { runner, calls }
}

describe('Automation with a mocked backend (integration)', () => {
  it('detects an available xdotool and issues correct commands', async () => {
    const { runner, calls } = fakeRunner(['xdotool'])
    const automation = new Automation(runner)

    const caps = await automation.capabilities()
    expect(caps.available).toBe(true)
    expect(caps.backends).toContain('xdotool')

    await automation.perform({ type: 'move', x: 10, y: 20 })
    expect(calls.at(-1)).toEqual({ binary: 'xdotool', args: ['mousemove', '--sync', '10', '20'] })

    await automation.perform({ type: 'click', x: 1, y: 2, button: 'right' })
    expect(calls.at(-1)).toEqual({ binary: 'xdotool', args: ['click', '3'] })

    await automation.perform({ type: 'key', keys: 'ctrl+l' })
    expect(calls.at(-1)).toEqual({ binary: 'xdotool', args: ['key', '--clearmodifiers', 'ctrl+l'] })

    await automation.perform({ type: 'key', keys: 'Super' })
    expect(calls.at(-1)).toEqual({ binary: 'xdotool', args: ['key', '--clearmodifiers', 'Super'] })

    await automation.perform({ type: 'type', text: 'héllo wörld' })
    expect(calls.at(-1)?.args).toEqual(['type', '--delay', '12', '--clearmodifiers', '--', 'héllo wörld'])
  })

  it('throws a categorised error when no backend is available', async () => {
    const { runner } = fakeRunner([])
    const automation = new Automation(runner)
    const caps = await automation.capabilities()
    expect(caps.available).toBe(false)
    await expect(automation.perform({ type: 'move', x: 0, y: 0 })).rejects.toBeInstanceOf(InputBackendError)
  })
})
