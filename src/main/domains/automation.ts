import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentAction, AgentSession, AutomationCapabilities, AutomationCheck, AutomationRuntime } from '@shared/types'
import { logger } from '../logger'

const execFileAsync = promisify(execFile)
const TIMEOUT_MS = 10_000

/** Why an input command did not run — used to decide whether a retry is safe. */
export type InputErrorKind = 'unavailable' | 'timeout' | 'failed'

export class InputBackendError extends Error {
  constructor(
    message: string,
    readonly kind: InputErrorKind
  ) {
    super(message)
    this.name = 'InputBackendError'
  }
}

export type CommandRunner = (binary: string, args: string[], timeoutMs: number) => Promise<void>

const defaultRunner: CommandRunner = async (binary, args, timeoutMs) => {
  try {
    await execFileAsync(binary, args, { timeout: timeoutMs, maxBuffer: 1 << 20 })
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim()
    const code = (error as { code?: string }).code
    const killed = Boolean((error as { killed?: boolean }).killed)
    const message = stderr || (error as Error).message
    const kind: InputErrorKind = killed ? 'timeout' : code === 'ENOENT' || code === 'EACCES' ? 'unavailable' : 'failed'
    logger.warn(`Automation command failed (${kind}): ${binary}`, message)
    throw new InputBackendError(`${binary}: ${message}`, kind)
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

export interface LinuxTools {
  xdotool: boolean
  ydotool: boolean
  wtype: boolean
  /** ydotool's daemon socket is present and the daemon is likely running. */
  ydotoold: boolean
  /** /dev/uinput is readable/writable by this user. */
  uinput: boolean
}

export function detectLinuxSession(env: NodeJS.ProcessEnv = process.env): AgentSession {
  if (env.WAYLAND_DISPLAY) return 'wayland'
  if ((env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland') return 'wayland'
  if ((env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'x11') return 'x11'
  if (env.DISPLAY) return 'x11'
  return 'unknown'
}

/**
 * Pure decision function: turn raw detections into the capability report the
 * renderer shows. Kept separate from process/IO so it is unit-testable.
 */
export function summarizeLinuxCapabilities(
  tools: LinuxTools,
  session: AgentSession,
  probes: Partial<Record<'xdotool' | 'ydotool' | 'wtype', boolean>> = {}
): AutomationCapabilities {
  const missing: string[] = []
  const limitations: string[] = []
  const checks: AutomationCheck[] = []

  const xdotoolWorks = tools.xdotool && probes.xdotool !== false
  const ydotoolWorks = tools.ydotool && tools.ydotoold && tools.uinput && probes.ydotool !== false

  checks.push({
    name: 'xdotool',
    ok: xdotoolWorks,
    detail: !tools.xdotool ? 'not installed' : probes.xdotool === false ? 'installed but did not respond' : 'ready'
  })
  checks.push({
    name: 'ydotool',
    ok: ydotoolWorks,
    detail: !tools.ydotool
      ? 'not installed'
      : !tools.ydotoold
        ? 'installed but ydotoold is not running'
        : !tools.uinput
          ? 'installed but /dev/uinput is not accessible'
          : probes.ydotool === false
            ? 'installed but did not respond'
            : 'ready'
  })
  checks.push({
    name: 'wtype',
    ok: tools.wtype && probes.wtype !== false,
    detail: !tools.wtype ? 'not installed' : 'typing only'
  })

  const backends: string[] = []
  if (xdotoolWorks) backends.push('xdotool')
  if (ydotoolWorks) backends.push('ydotool')
  if (tools.wtype) backends.push('wtype')

  if (!tools.xdotool) missing.push('xdotool')
  if (session === 'wayland' && !ydotoolWorks) missing.push('ydotool')

  if (session === 'wayland' && !ydotoolWorks) {
    limitations.push(
      'Native Wayland windows need ydotool (plus the ydotoold daemon and uinput access) for input; xdotool only reaches XWayland/X11 apps.'
    )
  }
  if (session === 'wayland' && tools.ydotool && !tools.ydotoold) {
    limitations.push('ydotool is installed but ydotoold is not running — start it with: sudo systemctl enable --now ydotool')
  }
  if (session === 'wayland' && tools.ydotool && !tools.uinput) {
    limitations.push('ydotool needs access to /dev/uinput (load the module and check group membership).')
  }
  if (session !== 'wayland' && tools.ydotool && !xdotoolWorks) {
    limitations.push('ydotool needs ydotoold and uinput access; install xdotool for simpler X11/XWayland input.')
  }
  if (!xdotoolWorks && !ydotoolWorks && tools.wtype) {
    limitations.push('Only wtype is ready: typing works, but clicking and moving the cursor do not.')
  }

  const available = xdotoolWorks || ydotoolWorks
  const runtime: AutomationRuntime = {
    kind: available ? 'ready' : missing.length ? 'executable-missing' : 'permission-denied',
    verifiedBackends: [
      ...(xdotoolWorks ? ['xdotool'] : []),
      ...(ydotoolWorks ? ['ydotool'] : [])
    ],
    checks
  }
  if (!available && tools.ydotool && !tools.ydotoold) runtime.kind = 'permission-denied'

  return {
    platform: 'linux',
    session,
    available,
    backends,
    missing,
    installHint: 'sudo dnf install -y xdotool wtype ydotool   # Fedora\nthen: sudo systemctl enable --now ydotool',
    limitations,
    runtime
  }
}

/**
 * Synthesises mouse/keyboard input via platform backends.
 * Linux: xdotool (X11/XWayland) or ydotool (native Wayland, needs ydotoold).
 * macOS: osascript (cliclick for mouse). Windows: PowerShell SendKeys/user32.
 */
export class Automation {
  private caps: AutomationCapabilities | null = null
  private tools = { xdotool: false, ydotool: false, wtype: false, cliclick: false }
  private linuxTools: LinuxTools = { xdotool: false, ydotool: false, wtype: false, ydotoold: false, uinput: false }

  constructor(private readonly runner: CommandRunner = defaultRunner) {}

  async capabilities(force = false): Promise<AutomationCapabilities> {
    if (this.caps && !force) return this.caps
    this.caps = await this.detect()
    return this.caps
  }

  private async has(binary: string): Promise<boolean> {
    try {
      await this.runner('sh', ['-c', `command -v ${binary}`], 3000)
      return true
    } catch {
      return false
    }
  }

  private async probe(binary: string, args: string[]): Promise<boolean> {
    try {
      await this.runner(binary, args, 4000)
      return true
    } catch (error) {
      // A non-zero exit still proves the binary ran; only "unavailable" fails.
      return !(error instanceof InputBackendError) || error.kind === 'failed'
    }
  }

  private ydotooldSocket(): boolean {
    const candidates = [
      process.env.YDOTOOL_SOCKET,
      process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, '.ydotool_socket') : undefined,
      '/tmp/.ydotool_socket'
    ].filter((value): value is string => Boolean(value))
    return candidates.some((path) => existsSync(path))
  }

  private uinputAccessible(): boolean {
    try {
      accessSync('/dev/uinput', constants.W_OK)
      return true
    } catch {
      return false
    }
  }

  private async detect(): Promise<AutomationCapabilities> {
    const platform = process.platform
    if (platform === 'linux') {
      const [xdotool, ydotool, wtype] = await Promise.all([this.has('xdotool'), this.has('ydotool'), this.has('wtype')])
      this.tools.xdotool = xdotool
      this.tools.ydotool = ydotool
      this.tools.wtype = wtype

      const probes: Partial<Record<'xdotool' | 'ydotool' | 'wtype', boolean>> = {}
      if (xdotool) probes.xdotool = await this.probe('xdotool', ['getmouselocation'])
      if (ydotool) probes.ydotool = await this.probe('ydotool', ['--version'])
      if (wtype) probes.wtype = await this.probe('wtype', ['--version'])

      this.linuxTools = {
        xdotool,
        ydotool,
        wtype,
        ydotoold: ydotool ? this.ydotooldSocket() : false,
        uinput: ydotool ? this.uinputAccessible() : false
      }
      return summarizeLinuxCapabilities(this.linuxTools, detectLinuxSession(), probes)
    }
    if (platform === 'darwin') {
      const cliclick = await this.has('cliclick')
      this.tools.cliclick = cliclick
      const checks: AutomationCheck[] = [
        { name: 'osascript', ok: true, detail: 'built-in (keystrokes and clicks)' },
        { name: 'cliclick', ok: cliclick, detail: cliclick ? 'ready (precise mouse control)' : 'not installed' }
      ]
      const limitations = [
        'Requires Accessibility permission in System Settings → Privacy & Security → Accessibility.',
        'Requires Automation permission for System Events the first time it runs.'
      ]
      if (!cliclick) limitations.push('Without cliclick, the cursor cannot be moved; use keyboard-driven flows or install it with: brew install cliclick')
      return {
        platform,
        session: 'macos',
        available: true,
        backends: ['osascript', ...(cliclick ? ['cliclick'] : [])],
        missing: cliclick ? [] : ['cliclick'],
        installHint: 'brew install cliclick',
        limitations,
        runtime: { kind: 'ready', verifiedBackends: ['osascript', ...(cliclick ? ['cliclick'] : [])], checks }
      }
    }
    if (platform === 'win32') {
      const checks: AutomationCheck[] = [{ name: 'powershell', ok: true, detail: 'used for SendKeys and user32 input' }]
      return {
        platform,
        session: 'windows',
        available: true,
        backends: ['powershell'],
        missing: [],
        installHint: '',
        limitations: [
          'Coordinates are applied in physical pixels; multi-monitor setups above 100% scaling may need adjustment.',
          'Unicode text is sent via SendKeys and cannot type characters that require an IME.'
        ],
        runtime: { kind: 'ready', verifiedBackends: ['powershell'], checks }
      }
    }
    return {
      platform,
      session: 'unknown',
      available: false,
      backends: [],
      missing: ['an input backend'],
      installHint: '',
      limitations: ['Automation is not supported on this platform.'],
      runtime: { kind: 'unsupported', verifiedBackends: [], checks: [{ name: 'platform', ok: false, detail: platform }] }
    }
  }

  async perform(action: AgentAction): Promise<string> {
    const caps = await this.capabilities()
    if (!caps.available) throw new InputBackendError('No desktop input backend is available.', 'unavailable')

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

  private run(binary: string, args: string[]): Promise<void> {
    return this.runner(binary, args, TIMEOUT_MS)
  }

  private move(x: number, y: number): Promise<void> {
    if (this.tools.xdotool) return this.run('xdotool', ['mousemove', '--sync', String(x), String(y)])
    if (this.tools.ydotool) return this.run('ydotool', ['mousemove', '-a', String(x), String(y)])
    if (process.platform === 'darwin') return this.macMove(x, y)
    if (process.platform === 'win32') return this.winMouse(x, y, 'move')
    throw new InputBackendError('No cursor-control backend available', 'unavailable')
  }

  private click(button: string): Promise<void> {
    if (this.tools.xdotool) return this.run('xdotool', ['click', XDO_BUTTON[button] ?? '1'])
    if (this.tools.ydotool) return this.run('ydotool', ['click', YDO_BUTTON[button] ?? YDO_BUTTON.left])
    if (process.platform === 'darwin') return this.macClick(button)
    if (process.platform === 'win32') return this.winMouse(0, 0, 'click', button)
    throw new InputBackendError('No click backend available', 'unavailable')
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

  private typeText(text: string): Promise<void> {
    if (this.tools.xdotool) return this.run('xdotool', ['type', '--delay', '12', '--clearmodifiers', '--', text])
    if (this.tools.wtype) return this.run('wtype', ['--', text])
    if (this.tools.ydotool) return this.run('ydotool', ['type', text])
    if (process.platform === 'darwin') return this.macType(text)
    if (process.platform === 'win32') return this.winType(text)
    throw new InputBackendError('No typing backend available', 'unavailable')
  }

  private key(keys: string): Promise<void> {
    const normalized = this.normalizeKeys(keys)
    if (this.tools.xdotool) return this.run('xdotool', ['key', '--clearmodifiers', normalized])
    if (this.tools.ydotool) return this.run('ydotool', ['key', normalized])
    if (process.platform === 'darwin') return this.macKey(normalized)
    if (process.platform === 'win32') return this.winKey(normalized)
    throw new InputBackendError('Key presses require xdotool (or platform support)', 'unavailable')
  }

  private scroll(dy: number): Promise<void> {
    if (dy === 0) return Promise.resolve()
    const button = dy > 0 ? '5' : '4'
    const times = Math.min(10, Math.abs(dy))
    if (this.tools.xdotool) return this.run('xdotool', ['click', '--repeat', String(times), '--delay', '40', button])
    if (this.tools.ydotool) return this.run('ydotool', ['click', dy > 0 ? '0x41' : '0x40'])
    throw new InputBackendError('Scrolling requires xdotool or ydotool', 'unavailable')
  }

  /* ---------- macOS (best-effort) ---------- */

  private osascript(script: string): Promise<void> {
    return this.run('osascript', ['-e', script])
  }

  private macMove(x: number, y: number): Promise<void> {
    if (!this.tools.cliclick) throw new InputBackendError('Mouse control on macOS needs cliclick (brew install cliclick)', 'unavailable')
    return this.run('cliclick', [`m:${x},${y}`])
  }

  private macClick(button: string): Promise<void> {
    if (!this.tools.cliclick) throw new InputBackendError('Mouse control on macOS needs cliclick (brew install cliclick)', 'unavailable')
    const map: Record<string, string> = { left: 'c', right: 'rc', middle: 'mc' }
    return this.run('cliclick', [map[button] ?? 'c'])
  }

  private macType(text: string): Promise<void> {
    return this.osascript(`tell application "System Events" to keystroke ${JSON.stringify(text)}`)
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
      throw new InputBackendError(`Unsupported key on macOS: ${keys}`, 'unavailable')
    }
  }

  /* ---------- Windows (best-effort) ---------- */

  private powershell(script: string): Promise<void> {
    return this.run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])
  }

  private winType(text: string): Promise<void> {
    const escaped = text.replace(/[+^%~(){}[\]]/g, '{$&}')
    return this.powershell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${JSON.stringify(escaped)})`
    )
  }

  private winKey(keys: string): Promise<void> {
    const parts = keys.split('+')
    const base = parts[parts.length - 1]
    const prefix = parts
      .slice(0, -1)
      .map((m) => ({ ctrl: '^', alt: '%', shift: '+', super: '^' })[m] ?? '')
      .join('')
    const special: Record<string, string> = { Return: '{ENTER}', Tab: '{TAB}', Escape: '{ESC}', Delete: '{DEL}' }
    return this.powershell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${JSON.stringify(prefix + (special[base] ?? base))})`
    )
  }

  private winMouse(x: number, y: number, mode: 'move' | 'click', button = 'left'): Promise<void> {
    const flag = button === 'right' ? '0x0008' : button === 'middle' ? '0x0020' : '0x0002'
    const up = button === 'right' ? '0x0010' : button === 'middle' ? '0x0040' : '0x0004'
    const events = mode === 'click' ? `[M]::mouse_event(${flag},0,0,0,0);[M]::mouse_event(${up},0,0,0,0);` : ''
    return this.powershell(
      `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class M{[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint dx,uint dy,uint d,int e);}';[M]::SetCursorPos(${x},${y});${events}`
    )
  }
}

export const automation = new Automation()
