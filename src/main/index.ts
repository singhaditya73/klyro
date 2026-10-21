import { join } from 'node:path'
import { BrowserWindow, app, desktopCapturer, session } from 'electron'
import { logger } from './logger'
import { diagnostics } from './diagnostics'
import { secrets } from './security/secrets'
import { isAllowedPermission, isTrustedRendererUrl, setPackagedRenderer } from './security/origins'
import { registerIpcHandlers } from './domains/ipc'
import { registerShortcuts, unregisterShortcuts } from './domains/shortcuts'
import { settingsDomain } from './domains/settings'
import { createTray } from './domains/tray'
import { createMainWindow, createOverlayWindow, showMainWindow } from './domains/windows'
import { maintenance } from './domains/maintenance'
import { warmupScreenPermission } from './domains/screenshot'
import { localAgentLauncher } from './domains/local-agent-launcher'
import { antigravity } from './domains/antigravity'

app.setName('Klyro')

/** Strict CSP in production; the dev server needs inline scripts for HMR. */
function applyContentSecurityPolicy(): void {
  if (process.env.ELECTRON_RENDERER_URL) return
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'none'; " +
            "script-src 'self'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; " +
            "connect-src 'self'; " +
            "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        ]
      }
    })
  })
}

/** Only our own renderer may use the microphone; everything else is denied. */
function applyPermissionPolicy(): void {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(isTrustedRendererUrl(contents.getURL()) && isAllowedPermission(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => isAllowedPermission(permission))
}

/**
 * Meeting-assist system-audio capture: the overlay's Listen mode asks for
 * display media with audio so the question audio reaches transcription even
 * when the user is on headphones (loopback records the output bus, not the
 * room). The picker is answered automatically with the primary display — only
 * for a trusted renderer origin, and the video track is discarded by the
 * caller. No window is ever chosen silently; this is Klyro's own capture
 * consent flow, not a screen-share interceptor.
 */
function applyDisplayMediaPolicy(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!isTrustedRendererUrl(request.securityOrigin)) {
      logger.warn('Display media request from untrusted origin refused', request.securityOrigin)
      return
    }
    void desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        const primary = sources.find((source) => source.id.startsWith('screen:')) ?? sources[0]
        if (!primary) return
        // Loopback audio is a Windows-only Chromium capability; elsewhere the
        // renderer falls back to the microphone.
        callback({ video: primary, ...(process.platform === 'win32' ? { audio: 'loopback' as const } : {}) })
      })
      .catch((error) => logger.warn('Display media source resolution failed', error))
  })
}


const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(() => {
    diagnostics.init()
    secrets.init()
    setPackagedRenderer(join(__dirname, '../renderer/index.html'))
    settingsDomain.get() // applies the plaintext-secrets policy before any key is written
    // Remove leftovers from a previous run before anything writes again.
    maintenance.sweep()
    applyContentSecurityPolicy()
    applyPermissionPolicy()
    applyDisplayMediaPolicy()
    registerIpcHandlers()
    createMainWindow()
    createOverlayWindow()
    createTray()
    registerShortcuts()
    // Ask the OS for screen-capture permission at launch, not in the middle of
    // a meeting: on macOS the first capture raises a system prompt, and it is
    // much better to answer it before the call starts. Windows never asks per
    // capture, and on Linux (Wayland portals) asking here would pop a dialog
    // at launch — so the warm-up is macOS-only.
    if (settingsDomain.get().screenPreWarm && process.platform === 'darwin') {
      void warmupScreenPermission()
    }
    // If the user has connected Antigravity, start its agent service now so
    // the first question does not wait for it. It fails quietly: the service
    // is started again on demand.
    void antigravity.warmUp()
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
    // Never leave a server we started running behind us.
    localAgentLauncher.stopOpenCode()
    antigravity.stopService()
  })
}
