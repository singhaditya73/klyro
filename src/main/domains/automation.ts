import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentAction, AgentSession, AutomationCapabilities } from '@shared/types'
import { logger } from '../logger'

const exec = promisify(execFile)
const TIMEOUT_MS = 10_000

async function has(binary: string): Promise<boolean> {
  try {
    await exec('sh', ['-c', `command -v ${binary}`], { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${String(value)}`)
  return Math.min(max, Math.max(min, n))
}

const XDO_BUTTON: Record<string, string> = { left: '1', middle: '2', right: '3' }
const YDO_BUTTON: Record<string, string> = {
  left: process.env.KLYRO_YDOTOOL_BTN_LEFT ?? '0xC0',
  middle: process.env.KLYRO_YDOTOOL_BTN_MIDDLE ?? '0xC1',
  right: process.env.KLYRO_YDOTOOL_BTN_RIGHT ?? '0xC2'
}
const KEY_ALIASES: Record<string, string> = {
  control: 'ctrl',
  cmd: 'super',
  command: 'super',
  option: 'alt',
  meta: 'super',
  win: 'super',
  enter: 'Return',
  esc: 'Escape',
  del: 'Delete'
}

/**
 * Synthesises mouse/keyboard input via platform backends.
 * Linux: xdotool (X11/XWayland) or ydotool (native Wayland, needs ydotoold).
 * macOS: osascript (cliclick for mouse). Windows: PowerShell SendKeys/user32.
 */
class Automation {
  private caps: AutomationCapabilities | null = null
  private tools = { xdotool: false, ydotool: false, wtype: false, cliclick: false }

  async capabilities(force = false): Promise<AutomationCapabilities> {
    if (this.caps && !force) return this.caps
    this.caps = await this.detect()
    return this.caps
  }

  private async detect(): Promise<AutomationCapabilities> {
    const platform = process.platform
    if (platform === 'linux') {
      const [xdotool, ydotool, wtype] = await Promise.all([has('xdotool'), has('ydotool'), has('wtype')])
      this.tools.xdotool = xdotool
      this.tools.ydotool = ydotool
      this.tools.wtype = wtype
      const session: AgentSession = process.env.WAYLAND_DISPLAY
        ? 'wayland'
        : process.env.DISPLAY
          ? 'x11'
          : 'unknown'
      const backends = [xdotool && 'xdotool', ydotool && 'ydotool', wtype && 'wtype'].filter(Boolean) as string[]
      const missing: string[] = []
      if (!xdotool) missing.push('xdotool')
      if (session === 'wayland' && !ydotool) missing.push('ydotool')
      const limitations: string[] = []
      if (session === 'wayland' && !ydotool) {
        limitations.push(
          'Native Wayland windows need ydotool (+ the ydotoold daemon) for input; xdotool only reaches XWayland/X11 apps.'
        )
      }
      if (session === 'wayland' && ydotool) limitations.push('ydotool requires ydotoold running and uinput access.')
      if (!xdotool && !ydotool && wtype) limitations.push('Only wtype is present: typing works, but clicking/moving does not.')
      return {
        platform,
        session,
        available: xdotool || ydotool,
        backends,
        missing,
        installHint: 'sudo dnf install -y xdotool wtype ydotool',
        limitations
      }
    }
    if (platform === 'darwin') {
      const cliclick = await has('cliclick')
      this.tools.cliclick = cliclick
      return {
        platform,
        session: 'macos',
        available: true,
        backends: ['osascript', ...(cliclick ? ['cliclick'] : [])],
        missing: cliclick ? [] : ['cliclick'],
        installHint: 'brew install cliclick',
        limitations: ['Requires Accessibility permission in System Settings → Privacy & Security.']
      }
    }
    if (platform === 'win32') {
      return { platform, session: 'windows', available: true, backends: ['powershell'], missing: [], installHint: '', limitations: [] }
    }
    return {
      platform,
      session: 'unknown',
      available: false,
      backends: [],
      missing: ['an input backend'],
      installHint: '',
      limitations: ['Automation is not supported on this platform.']
    }
  }

  async perform(action: AgentAction): Promise<string> {
    const caps = await this.capabilities()
    if (!caps.available) throw new Error('No desktop input backend is available.')

    switch (action.type) {
      case 'move': {
        const { x, y } = this.point(action)
        await this.move(x, y)
        return `Moved cursor to (${x}, ${y})`
      }
      case 'click': {
        const { x, y } = this.point(action)
        await this.move(x, y)
        await this.click(action.button ?? 'left')
        return `Clicked ${action.button ?? 'left'} at (${x}, ${y})`
      }
      case 'doubleClick': {
        const { x, y } = this.point(action)
        await this.move(x, y)
        await this.doubleClick()
        return `Double-clicked at (${x}, ${y})`
      }
      case 'type': {
        const text = String(action.text ?? '')
        if (!text) throw new Error('No text provided for typing')
        await this.typeText(text.slice(0, 2000))
        return `Typed ${text.length} character(s)`
      }
      case 'key': {
        const keys = String(action.keys ?? '').trim()
        if (!keys) throw new Error('No keys provided')
        await this.key(keys)
        return `Pressed ${keys}`
      }
      case 'scroll': {
        const dy = clampInt(action.dy ?? 0, -10, 10)
        await this.scroll(dy)
        return `Scrolled ${dy >= 0 ? 'down' : 'up'} ${Math.abs(dy)}`
      }
      case 'wait': {
        const ms = clampInt(action.ms ?? 500, 0, 8000)
        await new Promise((resolve) => setTimeout(resolve, ms))
        return `Waited ${ms} ms`
      }
      case 'screenshot':
        return 'Captured screen'
      case 'done':
      case 'ask':
        return action.type
      default:
        throw new Error(`Unsupported action`)
    }
  }

  private point(action: AgentAction): { x: number; y: number } {
    if (action.x === undefined || action.y === undefined) throw new Error('Action requires x and y coordinates')
    return { x: clampInt(action.x, 0, 20000), y: clampInt(action.y, 0, 20000) }
  }

  private async run(binary: string, args: string[]): Promise<void> {
    try {
      await exec(binary, args, { timeout: TIMEOUT_MS, maxBuffer: 1 << 20 })
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr?.trim()
      const message = stderr || (error as Error).message
      logger.warn(`Automation command failed: ${binary}`, message)
      throw new Error(`${binary}: ${message}`)
    }
  }

  private async move(x: number, y: number): Promise<void> {
    if (this.tools.xdotool) return this.run('xdotool', ['mousemove', '--sync', String(x), String(y)])
    if (this.tools.ydotool) return this.run('ydotool', ['mousemove', '-a', String(x), String(y)])
    if (process.platform === 'darwin') return this.macMove(x, y)
    if (process.platform === 'win32') return this.winMouse(x, y, 'move')
    throw new Error('No cursor-control backend available')
  }

  private async click(button: string): Promise<void> {
    if (this.tools.xdotool) return this.run('xdotool', ['click', XDO_BUTTON[button] ?? '1'])
    if (this.tools.ydotool) return this.run('ydotool', ['click', YDO_BUTTON[button] ?? YDO_BUTTON.left])
    if (process.platform === 'darwin') return this.macClick(button)
    if (process.platform === 'win32') return this.winMouse(0, 0, 'click', button)
    throw new Error('No click backend available')
  }

  private async doubleClick(): Promise<void> {
    if (this.tools.xdotool) return this.run('xdotool', ['click', '--repeat', '2', '--delay', '120', '1'])
    await this.click('left')
    await new Promise((resolve) => setTimeout(resolve, 120))
    await this.click('left')
  }

  private normalizeKeys(keys: string): string {
    return keys
      .split('+')
      .map((part) => KEY_ALIASES[part.trim().toLowerCase()] ?? part.trim())
      .filter(Boolean)
      .join('+')
  }

  private async typeText(text: string): Promise<void> {
    if (this.tools.xdotool) return this.run('xdotool', ['type', '--delay', '12', '--clearmodifiers', '--', text])
    if (this.tools.wtype) return this.run('wtype', ['--', text])
    if (this.tools.ydotool) return this.run('ydotool', ['type', text])
    if (process.platform === 'darwin') return this.macType(text)
    if (process.platform === 'win32') return this.winType(text)
    throw new Error('No typing backend available')
  }

  private async key(keys: string): Promise<void> {
    const normalized = this.normalizeKeys(keys)
    if (this.tools.xdotool) return this.run('xdotool', ['key', '--clearmodifiers', normalized])
    if (this.tools.ydotool) return this.run('ydotool', ['key', normalized])
    if (process.platform === 'darwin') return this.macKey(normalized)
    if (process.platform === 'win32') return this.winKey(normalized)
    throw new Error('Key presses require xdotool (or platform support)')
  }

  private async scroll(dy: number): Promise<void> {
    if (dy === 0) return
    const button = dy > 0 ? '5' : '4'
    const times = Math.min(10, Math.abs(dy))
    if (this.tools.xdotool) return this.run('xdotool', ['click', '--repeat', String(times), '--delay', '40', button])
    if (this.tools.ydotool) return this.run('ydotool', ['click', dy > 0 ? '0x41' : '0x40'])
    throw new Error('Scrolling requires xdotool')
  }

  /* ---------- macOS (best-effort) ---------- */

  private async osascript(script: string): Promise<void> {
    await this.run('osascript', ['-e', script])
  }

  private async macMove(x: number, y: number): Promise<void> {
    if (!this.tools.cliclick) throw new Error('Mouse control on macOS needs cliclick (brew install cliclick)')
    await this.run('cliclick', [`m:${x},${y}`])
  }

  private async macClick(button: string): Promise<void> {
    if (!this.tools.cliclick) throw new Error('Mouse control on macOS needs cliclick (brew install cliclick)')
    const map: Record<string, string> = { left: 'c', right: 'rc', middle: 'mc' }
    await this.run('cliclick', [map[button] ?? 'c'])
  }

  private async macType(text: string): Promise<void> {
    await this.osascript(`tell application "System Events" to keystroke ${JSON.stringify(text)}`)
  }

  private async macKey(keys: string): Promise<void> {
    const parts = keys.split('+')
    const base = parts[parts.length - 1]
    const using = parts
      .slice(0, -1)
      .map((m) => ({ ctrl: 'control down', alt: 'option down', super: 'command down', shift: 'shift down' })[m])
      .filter(Boolean)
      .join(', ')
    const codes: Record<string, string> = { Return: '36', Tab: '48', Escape: '53', space: '49' }
    if (codes[base]) {
      await this.osascript(`tell application "System Events" to key code ${codes[base]}${using ? ` using {${using}}` : ''}`)
    } else if (base.length === 1) {
      await this.osascript(`tell application "System Events" to keystroke ${JSON.stringify(base)}${using ? ` using {${using}}` : ''}`)
    } else {
      throw new Error(`Unsupported key on macOS: ${keys}`)
    }
  }

  /* ---------- Windows (best-effort) ---------- */

  private async powershell(script: string): Promise<void> {
    await this.run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])
  }

  private async winType(text: string): Promise<void> {
    const escaped = text.replace(/[+^%~(){}[\]]/g, '{$&}')
    await this.powershell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${JSON.stringify(escaped)})`
    )
  }

  private async winKey(keys: string): Promise<void> {
    const parts = keys.split('+')
    const base = parts[parts.length - 1]
    const prefix = parts
      .slice(0, -1)
      .map((m) => ({ ctrl: '^', alt: '%', shift: '+', super: '^' })[m] ?? '')
      .join('')
    const special: Record<string, string> = { Return: '{ENTER}', Tab: '{TAB}', Escape: '{ESC}', Delete: '{DEL}' }
    await this.powershell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${JSON.stringify(prefix + (special[base] ?? base))})`
    )
  }

  private async winMouse(x: number, y: number, mode: 'move' | 'click', button = 'left'): Promise<void> {
    const flag = button === 'right' ? '0x0008' : button === 'middle' ? '0x0020' : '0x0002'
    const up = button === 'right' ? '0x0010' : button === 'middle' ? '0x0040' : '0x0004'
    const events = mode === 'click' ? `[M]::mouse_event(${flag},0,0,0,0);[M]::mouse_event(${up},0,0,0,0);` : ''
    await this.powershell(
      `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,uint d,int e);}';[M]::SetCursorPos(${x},${y});${events}`
    )
  }
}

export const automation = new Automation()
