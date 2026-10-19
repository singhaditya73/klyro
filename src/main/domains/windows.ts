import { join } from 'node:path'
import { BrowserWindow, screen, shell, nativeImage } from 'electron'
import { KLYRO_ICON_DATA_URL } from '../assets'
import { isExternalHttpUrl, isTrustedRendererUrl } from '../security/origins'
import { diagnostics } from '../diagnostics'
import { logger } from '../logger'
import { settingsDomain } from './settings'

const OVERLAY_WIDTH = 640
const OVERLAY_HEIGHT = 208

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let overlayStickyRecording = false

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
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 520,
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
    backgroundColor: '#0b0d12',
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
    if (!overlayStickyRecording && !overlayPrivateModeActive()) overlayWindow?.hide()
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

function positionOverlay(win: BrowserWindow): void {
  const { workArea } = screen.getPrimaryDisplay()
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - OVERLAY_WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height * 0.16),
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT
  })
}

export function toggleOverlay(): void {
  const win = createOverlayWindow()
  if (win.isVisible()) {
    win.hide()
    return
  }
  positionOverlay(win)
  applyOverlayPrivateMode()
  applyOverlayOpacity()
  win.show()
  win.focus()
}

export function hideOverlay(): void {
  overlayWindow?.hide()
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
