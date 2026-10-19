import { desktopCapturer, screen, BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CaptureResult, CaptureSource } from '@shared/types'
import { getOverlayWindow } from './windows'

export interface AgentFrame {
  dataUrl: string
  /** Raw BGRA pixels, for before/after verification. */
  bitmap: Buffer
  imageWidth: number
  imageHeight: number
  screenWidth: number
  screenHeight: number
  name: string
}

/** Klyro's own windows must never appear as a capture target. */
function isOwnWindow(name: string): boolean {
  if (!name) return false
  const lowered = name.toLowerCase()
  return lowered.includes('klyro')
}

export async function listCaptureSources(): Promise<CaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 480, height: 300 },
    fetchWindowIcons: false
  })
  return sources
    .filter((source) => source.name.startsWith('screen') || !isOwnWindow(source.name))
    .map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }))
}

/**
 * Hide Klyro's own windows for a moment so a full-screen capture shows the
 * user's work, not the app they are asking about. A screenshot of Klyro asking
 * about Klyro is useless.
 */
async function withSelfHidden<T>(action: () => Promise<T>): Promise<T> {
  const hidden: BrowserWindow[] = []
  const focused = BrowserWindow.getFocusedWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || !win.isVisible()) continue
    hidden.push(win)
    win.hide()
  }
  if (hidden.length === 0) return action()
  // Give the compositor a moment to actually repaint without our windows.
  await new Promise((resolve) => setTimeout(resolve, 180))
  try {
    return await action()
  } finally {
    for (const win of hidden) {
      if (win.isDestroyed()) continue
      win.show()
    }
    if (focused && !focused.isDestroyed()) focused.focus()
  }
}

/**
 * A raw capture of the primary display *without* hiding Klyro. Only the
 * privacy probe uses this: it needs to see whether the overlay is present in
 * the pixels, which is exactly what a screen share would contain.
 */
async function captureRawDisplay(): Promise<{ bitmap: Buffer; width: number; height: number }> {
  const primary = screen.getPrimaryDisplay()
  const pixelWidth = Math.max(1, Math.round(primary.size.width * primary.scaleFactor))
  const pixelHeight = Math.max(1, Math.round(primary.size.height * primary.scaleFactor))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: pixelWidth, height: pixelHeight },
    fetchWindowIcons: false
  })
  const target = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0]
  if (!target) throw new Error('No screen available for the privacy check.')
  const size = target.thumbnail.getSize()
  return { bitmap: target.thumbnail.toBitmap(), width: size.width, height: size.height }
}

/**
 * Prove, on this machine, whether the overlay is excluded from screen
 * captures. The check captures the display twice — once with the overlay
 * visible, once with it hidden — and compares the pixels where the overlay
 * was. Identical pixels mean the overlay is excluded from what a screen
 * share would contain; different pixels mean it is visible to everyone.
 *
 * No guessing, no marketing: the app measures it and reports the number.
 */
export async function probeOverlayVisibility(): Promise<{
  excluded: boolean
  changedRatio: number
  platform: NodeJS.Platform
  supported: boolean
}> {
  const overlay = getOverlayWindow()
  if (!overlay || overlay.isDestroyed()) {
    return { excluded: false, changedRatio: 1, platform: process.platform, supported: false }
  }
  const wasVisible = overlay.isVisible()
  const bounds = overlay.getBounds()
  try {
    overlay.showInactive()
    await new Promise((resolve) => setTimeout(resolve, 320))
    const withOverlay = await captureRawDisplay()

    overlay.hide()
    await new Promise((resolve) => setTimeout(resolve, 320))
    const withoutOverlay = await captureRawDisplay()

    // Compare the region the overlay occupied, in capture pixels.
    const scaleX = withOverlay.width / screen.getPrimaryDisplay().size.width
    const scaleY = withOverlay.height / screen.getPrimaryDisplay().size.height
    const x0 = Math.max(0, Math.floor(bounds.x * scaleX))
    const y0 = Math.max(0, Math.floor(bounds.y * scaleY))
    const x1 = Math.min(withOverlay.width, Math.ceil((bounds.x + bounds.width) * scaleX))
    const y1 = Math.min(withOverlay.height, Math.ceil((bounds.y + bounds.height) * scaleY))
    if (x1 <= x0 || y1 <= y0) {
      return { excluded: false, changedRatio: 1, platform: process.platform, supported: false }
    }

    let changed = 0
    let total = 0
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const index = (y * withOverlay.width + x) * 4
        total += 1
        if (
          withOverlay.bitmap[index] !== withoutOverlay.bitmap[index] ||
          withOverlay.bitmap[index + 1] !== withoutOverlay.bitmap[index + 1] ||
          withOverlay.bitmap[index + 2] !== withoutOverlay.bitmap[index + 2]
        ) {
          changed += 1
        }
      }
    }
    const changedRatio = total === 0 ? 1 : changed / total
    // A little noise is normal (a blinking caret in the region); a real
    // overlay changes a large part of its own area.
    const excluded = changedRatio < 0.02
    return { excluded, changedRatio, platform: process.platform, supported: true }
  } finally {
    if (!wasVisible) overlay.hide()
    else overlay.showInactive()
  }
}

/**
 * Ask the OS for screen-capture permission at launch rather than in the
 * middle of a meeting. On macOS the first capture triggers a system prompt;
 * doing it here means the user grants it before the meeting starts, not while
 * the meeting is on screen.
 */
export async function warmupScreenPermission(): Promise<void> {
  try {
    await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 16, height: 16 },
      fetchWindowIcons: false
    })
  } catch {
    // Permission not granted (or not supported) — the user is asked later.
  }
}

/**
 * Capture the display with a compositor-native screenshot tool, so no
 * permission dialog appears.
 *
 * On Wayland, Electron's desktopCapturer goes through the xdg-desktop-portal,
 * which raises a "share your screen" dialog on every capture — and that
 * dialog is on your screen, where the meeting can see it. A native tool
 * (grim on wlroots, gnome-screenshot or ImageMagick's import on X11) grabs
 * the display with no dialog at all.
 *
 * Returns null when no tool is available, and the caller falls back to
 * Electron's own capture.
 */
/** How long the native-tool path may take before Electron's capture is used. */
const NATIVE_BUDGET_MS = 1500

/** Is this tool on PATH? Probing tools that do not exist wastes seconds. */
function hasTool(command: string): boolean {
  const paths = (process.env.PATH ?? '').split(':').filter(Boolean)
  return paths.some((dir) => existsSync(join(dir, command)))
}

async function captureViaNativeTool(): Promise<{ dataUrl: string; name: string } | null> {
  if (process.platform !== 'linux') return null
  const started = Date.now()
  const attempts: Array<{ command: string; args: string[]; file?: boolean }> = []

  // wlroots compositors: grim writes a PNG to stdout and never prompts.
  if (process.env.WAYLAND_DISPLAY && hasTool('grim')) {
    attempts.push({ command: 'grim', args: ['-'] })
  }
  // GNOME: the Shell's own screenshot interface takes a picture without any
  // dialogue, unlike the portal.
  if (hasTool('gdbus')) {
    attempts.push({
      command: 'gdbus',
      args: [
        'call',
        '--session',
        '--dest',
        'org.gnome.Shell.Screenshot',
        '--object-path',
        '/org/gnome/Shell/Screenshot',
        '--method',
        'org.gnome.Shell.Screenshot.Screenshot',
        'false',
        'false',
        '/tmp/klyro-capture.png'
      ],
      file: true
    })
  }
  // X11: plain screenshot tools, no dialog.
  if (hasTool('gnome-screenshot')) attempts.push({ command: 'gnome-screenshot', args: ['-f', '-'] })
  if (hasTool('scrot')) attempts.push({ command: 'scrot', args: ['-o', '-'] })
  if (hasTool('magick')) attempts.push({ command: 'magick', args: ['import', '-window', 'root', 'png:-'] })
  else if (hasTool('import')) attempts.push({ command: 'import', args: ['-window', 'root', 'png:-'] })

  for (const attempt of attempts) {
    // The native path is an optimisation, not a dependency: if the tools are
    // slow to answer, fall back to Electron's capture instead of making the
    // user wait.
    if (Date.now() - started > NATIVE_BUDGET_MS) break
    if (attempt.file) {
      const file = attempt.args[attempt.args.length - 1]
      const result = await runCaptureTool(attempt.command, attempt.args)
      if (result !== null) {
        try {
          const bytes = readFileSync(file)
          unlinkSync(file)
          if (bytes.length > 1000) {
            return { dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, name: 'Screen' }
          }
        } catch {
          // The tool wrote nothing usable; try the next one.
        }
      }
      continue
    }
    const png = await runCaptureTool(attempt.command, attempt.args)
    if (png && png.length > 1000) {
      return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, name: 'Screen' }
    }
  }
  return null
}

/** Run a capture tool, returning its PNG bytes (or null on any failure). */
function runCaptureTool(command: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: Buffer | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
      const chunks: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.on('error', () => finish(null))
      child.on('close', (code) => finish(code === 0 ? Buffer.concat(chunks) : null))
      // Never let a stuck tool hold the capture hostage.
      setTimeout(() => {
        try {
          child.kill()
        } catch {
          // already gone
        }
        finish(null)
      }, 1500)
    } catch {
      finish(null)
    }
  })
}

export async function grabScreen(sourceId?: string): Promise<CaptureResult> {
  // A specific screen or window: the user chose it, so capture it as-is.
  if (sourceId) {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 1920, height: 1080 },
      fetchWindowIcons: false
    })
    const chosen = sources.find((s) => s.id === sourceId)
    if (!chosen) throw new Error('That screen or window is no longer available.')
    return { dataUrl: chosen.thumbnail.toDataURL(), name: chosen.name || 'Screen' }
  }

  // The whole display, with Klyro hidden for the moment of the shot so the
  // picture shows what is *below* the overlay.
  //
  // On Linux a compositor-native tool is preferred: Electron's capture goes
  // through the xdg-desktop-portal, and that portal dialog appears on your
  // screen — where a meeting can see it. The native path raises no dialog.
  return withSelfHidden(async () => {
    const native = await captureViaNativeTool()
    if (native) return native

    const primary = screen.getPrimaryDisplay()
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
      fetchWindowIcons: false
    })
    const target =
      sources.find((s) => s.display_id === String(primary.id)) ?? sources[0]
    if (!target) {
      throw new Error('No screen available for capture. Screen recording permission may be required.')
    }
    return { dataUrl: target.thumbnail.toDataURL(), name: target.name || 'Screen' }
  })
}

/** Physical-pixel capture of the primary display for the agent, with the
 *  dimensions needed to map model coordinates back to screen coordinates. */
export async function captureForAgent(): Promise<AgentFrame> {
  const display = screen.getPrimaryDisplay()
  const pixelWidth = Math.max(1, Math.round(display.size.width * display.scaleFactor))
  const pixelHeight = Math.max(1, Math.round(display.size.height * display.scaleFactor))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: pixelWidth, height: pixelHeight },
    fetchWindowIcons: false
  })
  if (sources.length === 0) {
    throw new Error('No screen available for capture. Screen recording permission may be required.')
  }
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  const size = source.thumbnail.getSize()
  return {
    dataUrl: source.thumbnail.toDataURL(),
    bitmap: source.thumbnail.toBitmap(),
    imageWidth: size.width,
    imageHeight: size.height,
    screenWidth: display.size.width,
    screenHeight: display.size.height,
    name: source.name
  }
}
