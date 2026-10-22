import { join } from 'node:path'
import { BrowserWindow, screen, shell, nativeImage } from 'electron'
import { KLYRO_ICON_DATA_URL } from '../assets'
import { isExternalHttpUrl, isTrustedRendererUrl } from '../security/origins'
import { diagnostics } from '../diagnostics'
import { logger } from '../logger'
import { settingsDomain } from './settings'

const OVERLAY_WIDTH = 640
const OVERLAY_HEIGHT = 208
/** The overlay is sized by its content, between these two heights. */
const OVERLAY_MIN_HEIGHT = 150
const OVERLAY_MAX_HEIGHT = 520
/** How long the show/hide animation runs, in milliseconds. */
const OVERLAY_ANIMATION_MS = 150

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let overlayStickyRecording = false
/** The height the overlay's content asked for, so showing it is the right size. */
let overlayContentHeight = 0

function isDev(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL)
}

/**
 * A window may only ever display Klyro's own renderer. Anything the renderer
 * tries to navigate to is refused, and real web links are handed to the user's
 * browser instead of being loaded inside the app.
 */
function attachNavigationGuards(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererUrl(url)) return
    event.preventDefault()
    if (isExternalHttpUrl(url)) void shell.openExternal(url)
  })

  // Klyro never embeds third-party content.
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

  // A crashed renderer is a crash report, not a silent blank window.
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Renderer process gone (${details.reason})`, details)
    diagnostics.capture('render-process-gone', {
      message: `Renderer process gone: ${details.reason}${details.exitCode ? ` (exit ${details.exitCode})` : ''}`
    })
  })
  win.webContents.on('preload-error', (_event, path, error) => {
    logger.error(`Preload error in ${path}`, error)
    diagnostics.capture('main-crash', { message: `preload error: ${error.message}` })
  })
}

function loadRoute(win: BrowserWindow, route: string): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    const url = new URL(devUrl)
    url.hash = route
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
  }
}

function baseWebPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true
  }
}

export function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: 'Klyro',
    icon: nativeImage.createFromDataURL(KLYRO_ICON_DATA_URL),
    backgroundColor: '#0b0d12',
    webPreferences: baseWebPreferences()
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  attachNavigationGuards(mainWindow)
  loadRoute(mainWindow, '/')
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  return mainWindow
}

export function createOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow
  overlayWindow = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    // Matched to the renderer's glass surface so the window never flashes a
    // different colour on the way in.
    backgroundColor: '#14171b',
    webPreferences: baseWebPreferences()
  })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  applyOverlayPrivateMode()
  applyOverlayOpacity()
  overlayWindow.on('blur', () => {
    // While meeting-assist recording is live the overlay must keep running even
    // when focus returns to the meeting app; private mode has the same need
    // (reading notes while the meeting has focus) without recording.
    if (!overlayStickyRecording && !overlayPrivateModeActive()) void hideOverlayAnimated()
  })
  attachNavigationGuards(overlayWindow)
  loadRoute(overlayWindow, 'overlay')
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
  return overlayWindow
}

function overlayPrivateModeActive(): boolean {
  try {
    return settingsDomain.get().overlayPrivateMode === true
  } catch {
    return false
  }
}

/**
 * Exclude the overlay from screen captures and shares on platforms that support
 * per-window capture exclusion (Windows: WDA_EXCLUDEFROMCAPTURE; macOS:
 * content protection). Linux/X11 has no such API — the overlay stays visible to
 * captures there, and the UI says so rather than pretending.
 */
export function applyOverlayPrivateMode(): boolean {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false
  const on = overlayPrivateModeActive()
  try {
    overlayWindow.setContentProtection(on)
  } catch (error) {
    logger.warn('setContentProtection failed', error)
  }
  return on
}

/** Platform up-front: private mode works on Windows/macOS, not Linux/X11. */
export function overlayPrivateModeSupported(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin'
}

/**
 * Window-level opacity, so the whole overlay (text included) fades to the
 * user's taste while staying fully interactive and capture-excluded exactly
 * as before. Clamped here as well as at the IPC boundary.
 */
export function applyOverlayOpacity(): number {
  if (!overlayWindow || overlayWindow.isDestroyed()) return 100
  let value = 100
  try {
    value = settingsDomain.get().overlayOpacity
  } catch {
    return 100
  }
  const clamped = Math.min(100, Math.max(20, Math.round(Number(value) || 100)))
  try {
    overlayWindow.setOpacity(clamped / 100)
  } catch (error) {
    logger.warn('setOpacity failed', error)
  }
  return clamped
}

/** Meeting-assist recording keeps the overlay alive across focus changes. */
export function setOverlayStickyRecording(sticky: boolean): void {
  overlayStickyRecording = sticky === true
}

/**
 * Which display the overlay lives on. 'primary' is the normal one; a number
 * is the index of another connected screen. Putting the overlay on a screen
 * you are *not* sharing is the simplest way to keep it out of the meeting —
 * no capture trickery required, the shared framebuffer simply does not
 * contain it.
 */
function overlayDisplay(): Electron.Display {
  const displays = screen.getAllDisplays()
  const chosen = settingsDomain.get().overlayDisplay
  if (typeof chosen === 'number' && chosen >= 0 && chosen < displays.length) {
    return displays[chosen]
  }
  return screen.getPrimaryDisplay()
}

function positionOverlay(win: BrowserWindow): void {
  const { workArea } = overlayDisplay()
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - OVERLAY_WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height * 0.16),
    width: OVERLAY_WIDTH,
    height: overlayContentHeight || OVERLAY_HEIGHT
  })
}

/** Connected displays, for the settings picker. */
export function listDisplays(): Array<{ index: number; label: string; primary: boolean; bounds: { x: number; y: number; width: number; height: number } }> {
  return screen.getAllDisplays().map((display, index) => ({
    index,
    label: `Screen ${index + 1}`,
    primary: display.id === screen.getPrimaryDisplay().id,
    bounds: display.bounds
  }))
}

/** Move the overlay to another display (or back to the primary one). */
export function applyOverlayDisplay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  positionOverlay(overlayWindow)
}

/**
 * Size the overlay to its content.
 *
 * The idle box is short; an answer makes it taller, up to a limit — after
 * that the answer scrolls inside the window instead of the window growing
 * forever. The top edge stays where the user put it, so the overlay grows
 * downwards and never jumps.
 */
export function resizeOverlay(height: number): number {
  const win = overlayWindow
  const wanted = Math.round(Number(height))
  if (!Number.isFinite(wanted) || wanted <= 0) return 0
  const clamped = Math.min(OVERLAY_MAX_HEIGHT, Math.max(OVERLAY_MIN_HEIGHT, wanted))
  overlayContentHeight = clamped
  if (!win || win.isDestroyed() || !win.isVisible()) return clamped
  const bounds = win.getBounds()
  if (Math.abs(bounds.height - clamped) < 2) return bounds.height
  try {
    win.setBounds({ x: bounds.x, y: bounds.y, width: OVERLAY_WIDTH, height: clamped })
  } catch (error) {
    logger.warn('Could not resize the overlay', error)
    return bounds.height
  }
  return clamped
}

export function toggleOverlay(): void {
  const win = createOverlayWindow()
  if (win.isVisible()) {
    void hideOverlayAnimated()
    return
  }
  positionOverlay(win)
  applyOverlayPrivateMode()
  applyOverlayOpacity()
  showOverlayAnimated(win)
}

/** The user's chosen opacity, as a 0..1 number. */
function overlayOpacityValue(): number {
  try {
    const raw = settingsDomain.get().overlayOpacity
    return Math.min(100, Math.max(20, Math.round(Number(raw) || 100))) / 100
  } catch {
    return 1
  }
}

/**
 * Show the overlay the way a native panel appears: fade in with a slight
 * lift instead of popping onto the screen. The window is already created at
 * launch, so the hotkey only pays for the animation.
 */
function showOverlayAnimated(win: BrowserWindow): void {
  const target = overlayOpacityValue()
  const started = Date.now()
  try {
    win.setOpacity(0)
  } catch {
    // Some Linux compositors refuse opacity changes; the overlay still shows.
  }
  win.show()
  win.focus()
  const step = (): void => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    const elapsed = Date.now() - started
    // An ease-out curve: fast at first, settling gently.
    const progress = Math.min(1, elapsed / OVERLAY_ANIMATION_MS)
    const eased = 1 - Math.pow(1 - progress, 3)
    try {
      win.setOpacity(target * eased)
    } catch {
      // Ignore: the window is visible either way.
    }
    if (progress < 1) setTimeout(step, 16)
  }
  step()
}

/** Fade out, then hide — the mirror of the entrance. */
export function hideOverlayAnimated(): Promise<void> {
  const win = overlayWindow
  if (!win || win.isDestroyed() || !win.isVisible()) {
    win?.hide()
    return Promise.resolve()
  }
  const target = overlayOpacityValue()
  const started = Date.now()
  return new Promise((resolve) => {
    const step = (): void => {
      if (!overlayWindow || overlayWindow.isDestroyed()) {
        resolve()
        return
      }
      const elapsed = Date.now() - started
      const progress = Math.min(1, elapsed / OVERLAY_ANIMATION_MS)
      try {
        win.setOpacity(target * (1 - progress))
      } catch {
        // Ignore.
      }
      if (progress < 1) {
        setTimeout(step, 16)
        return
      }
      win.hide()
      try {
        win.setOpacity(target)
      } catch {
        // Ignore.
      }
      resolve()
    }
    step()
  })
}

export function hideOverlay(): void {
  void hideOverlayAnimated()
}

export function showMainWindow(): void {
  const win = createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null
}

export function isDevBuild(): boolean {
  return isDev()
}
