import { join } from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'

const OVERLAY_WIDTH = 640
const OVERLAY_HEIGHT = 208

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

function isDev(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL)
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
    backgroundColor: '#0b0d12',
    webPreferences: baseWebPreferences()
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
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
  overlayWindow.on('blur', () => overlayWindow?.hide())
  loadRoute(overlayWindow, 'overlay')
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
  return overlayWindow
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
