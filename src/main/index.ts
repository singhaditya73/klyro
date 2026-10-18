import { BrowserWindow, app, session } from 'electron'
import { logger } from './logger'
import { secrets } from './security/secrets'
import { registerIpcHandlers } from './domains/ipc'
import { registerShortcuts, unregisterShortcuts } from './domains/shortcuts'
import { createTray } from './domains/tray'
import { createMainWindow, createOverlayWindow, showMainWindow } from './domains/windows'

app.setName('Klyro')

/** Strict CSP in production; the dev server needs inline scripts for HMR. */
function applyContentSecurityPolicy(): void {
  if (process.env.ELECTRON_RENDERER_URL) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; img-src 'self' data: blob:; media-src 'self' data: blob:; " +
            "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
        ]
      }
    })
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(() => {
    secrets.init()
    applyContentSecurityPolicy()
    registerIpcHandlers()
    createMainWindow()
    createOverlayWindow()
    createTray()
    registerShortcuts()
    logger.info(`Klyro ${app.getVersion()} ready on ${process.platform}`)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  // Tray app: keep running when all windows are closed.
  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return
  })

  app.on('will-quit', () => {
    unregisterShortcuts()
  })
}
