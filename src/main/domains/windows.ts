import { join } from 'node:path'
import { BrowserWindow, app, screen, shell, nativeImage } from 'electron'
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
/** The user's custom dragged position on screen. Null = default top center. */
let userOverlayPos: { x: number; y: number } | null = null
/** The user's custom resized width. Null = default OVERLAY_WIDTH (640). */
let userOverlayWidth: number | null = null

function isDev(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL)
}

/** Whether the control panel stays out of the taskbar/Dock. */
function hideMainFromTaskbar(): boolean {
  try {
    return settingsDomain.get().hideFromTaskbar === true
  } catch {
    return false
  }
}

/**
 * Apply the taskbar choice to the control panel.
 *
 * This hides the window's *button*, not the window and not the process: the
 * control panel still opens on screen and the app still runs.
 */
export function applyMainWindowVisibility(): void {
  const hidden = hideMainFromTaskbar()
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setSkipTaskbar(hidden)
    } catch (error) {
      logger.warn('setSkipTaskbar failed', error)
    }
  }
  // macOS has no taskbar entry to remove; the Dock icon is the equivalent.
  if (process.platform === 'darwin') {
    try {
      if (hidden) app.dock?.hide()
      else app.dock?.show()
    } catch (error) {
      logger.warn('Dock visibility failed', error)
    }
  }
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
  applyMainWindowVisibility()
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
    width: userOverlayWidth || OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    minWidth: 420,
    minHeight: OVERLAY_MIN_HEIGHT,
    maxWidth: 1400,
    maxHeight: 1000,
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

  // Remember where the user dragged it, so it stays there across toggles
  overlayWindow.on('moved', () => {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      const b = overlayWindow.getBounds()
      userOverlayPos = { x: b.x, y: b.y }
    }
  })

  // Remember if the user manually resized width from edges
  overlayWindow.on('resized', () => {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      const b = overlayWindow.getBounds()
      if (Math.abs(b.width - OVERLAY_WIDTH) > 10) {
        userOverlayWidth = b.width
      }
      applyOverlayPrivateMode()
    }
  })

  overlayWindow.on('blur', () => {
    // If the user has dragged the overlay somewhere on screen (userOverlayPos),
    // or manually resized it (userOverlayWidth), or is recording / in private mode,
    // it stays pinned on screen and does NOT vanish on click outside.
    // When in default top-center popup mode without recording, it can auto-dismiss.
    if (!overlayStickyRecording && !overlayPrivateModeActive() && !userOverlayPos && !userOverlayWidth) {
      void hideOverlayAnimated()
    }
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
  const display = overlayDisplay()
  const { workArea } = display
  const width = userOverlayWidth || OVERLAY_WIDTH
  const height = overlayContentHeight || OVERLAY_HEIGHT

  let x = Math.round(workArea.x + (workArea.width - width) / 2)
  let y = Math.round(workArea.y + workArea.height * 0.16)

  if (userOverlayPos) {
    const displays = screen.getAllDisplays()
    const onScreen = displays.some(
      (d) =>
        userOverlayPos!.x + width > d.bounds.x &&
        userOverlayPos!.x < d.bounds.x + d.bounds.width &&
        userOverlayPos!.y + height > d.bounds.y &&
        userOverlayPos!.y < d.bounds.y + d.bounds.height
    )
    if (onScreen) {
      x = userOverlayPos.x
      y = userOverlayPos.y
    }
  }

  win.setBounds({ x, y, width, height })
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
export function resizeOverlay(height: number, width?: number): number {
  const win = overlayWindow
  const wanted = Math.round(Number(height))
  if (!Number.isFinite(wanted) || wanted <= 0) return 0
  const clamped = Math.min(OVERLAY_MAX_HEIGHT, Math.max(OVERLAY_MIN_HEIGHT, wanted))
  overlayContentHeight = clamped

  if (typeof width === 'number' && Number.isFinite(width)) {
    const clampedWidth = Math.min(1400, Math.max(420, Math.round(width)))
    userOverlayWidth = clampedWidth
  }

  if (!win || win.isDestroyed() || !win.isVisible()) return clamped
  const bounds = win.getBounds()
  const targetWidth = userOverlayWidth || bounds.width || OVERLAY_WIDTH
  if (Math.abs(bounds.height - clamped) < 2 && bounds.width === targetWidth) return bounds.height
  try {
    win.setBounds({ x: bounds.x, y: bounds.y, width: targetWidth, height: clamped })
    applyOverlayPrivateMode()
  } catch (error) {
    logger.warn('Could not resize the overlay', error)
    return bounds.height
  }
  return clamped
}

export function toggleOverlay(): void {
  const win = createOverlayWindow()
  if (win.isVisible() && !win.isMinimized()) {
    void hideOverlayAnimated()
    return
  }
  if (win.isMinimized()) {
    win.restore()
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

export function minimizeOverlay(): void {
  const win = overlayWindow
  if (!win || win.isDestroyed()) return
  try {
    win.minimize()
  } catch {
    void hideOverlayAnimated()
  }
}

export function showMainWindow(): void {
  const win = createMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * Hide the control panel without closing it.
 *
 * A hidden window has no taskbar button on any platform, so this is the fast
 * way out of the way that does not take the tray icon with it.
 */
export function hideMainWindow(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  try {
    win.hide()
  } catch (error) {
    logger.warn('hideMainWindow failed', error)
  }
}

/**
 * Hide everything the user can see, immediately.
 *
 * The panic shortcut uses this: the overlay and the control panel disappear in
 * one keystroke. The process keeps running — hiding a window is not hiding a
 * process, and it is not meant to be.
 */
export function hideEverything(): void {
  const overlay = overlayWindow
  if (overlay && !overlay.isDestroyed()) {
    try {
      overlay.hide()
    } catch (error) {
      logger.warn('hide overlay failed', error)
    }
  }
  hideMainWindow()
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null
}

export function isDevBuild(): boolean {
  return isDev()
}
