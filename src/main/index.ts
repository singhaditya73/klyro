import { join } from 'node:path'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { BrowserWindow, app, desktopCapturer, session } from 'electron'
import { logger } from './logger'
import { diagnostics } from './diagnostics'
import { secrets } from './security/secrets'
import { isAllowedPermission, isTrustedRendererUrl, setPackagedRenderer } from './security/origins'
import { registerIpcHandlers } from './domains/ipc'
import { registerShortcuts, unregisterShortcuts } from './domains/shortcuts'
import { settingsDomain } from './domains/settings'
import { applyTrayVisibility } from './domains/tray'
import { createMainWindow, createOverlayWindow, showMainWindow, toggleOverlay } from './domains/windows'
import { maintenance } from './domains/maintenance'
import { interviews } from './domains/interviews'
import { conversations } from './domains/conversations'
import { audit } from './domains/audit'
import { answerCache } from './domains/answer-cache'
import { warmupScreenPermission } from './domains/screenshot'
import { localAgentLauncher } from './domains/local-agent-launcher'
import { antigravity } from './domains/antigravity'
import { daemon } from './domains/daemon'
import { prewarmOcr } from './domains/ocr'
import { startUpdater } from './domains/updater'
import { installAirgapFetchGuard, setAirgapShield } from './providers/request'

app.setName('Klyro')

// Hardware Acceleration, Zero-Copy GPU Rasterization & V8 Memory Flags
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
// Screen Recording Border & Indicator Bypass (Prevents Windows 11 / macOS yellow/purple capture borders)
app.commandLine.appendSwitch('disable-features', 'DrawBorderOnScreenCapture,ScreenCaptureBorder,CaptureBorder')

// Periodic V8 heap compaction on idle to keep RAM minimal. `js-flags` only
// applies to renderer processes, so the main process needs its own GC handle.
const IDLE_GC_INTERVAL_MS = 5 * 60_000
/** Forcing a collection below this heap size costs more than it reclaims. */
const IDLE_GC_HEAP_THRESHOLD_BYTES = 120 * 1024 * 1024
let idleGcTimer: NodeJS.Timeout | null = null
let mainProcessGc: (() => void) | null = null

/** Expose V8's collector in the main process (the `--expose-gc` trick). */
function resolveMainProcessGc(): (() => void) | null {
  if (mainProcessGc) return mainProcessGc
  try {
    setFlagsFromString('--expose-gc')
    const candidate: unknown = runInNewContext('gc')
    if (typeof candidate === 'function') mainProcessGc = candidate as () => void
  } catch {
    // GC is an optimisation, not a requirement.
  }
  return mainProcessGc
}

function startIdleMemoryCompaction(): void {
  if (idleGcTimer) clearInterval(idleGcTimer)
  const gc = resolveMainProcessGc()
  if (!gc) {
    logger.info('Main-process GC is unavailable; idle compaction is disabled')
    return
  }
  idleGcTimer = setInterval(() => {
    try {
      // Only compact when the user is not looking at a window, and only when
      // there is enough garbage to make the pause worth taking.
      const focused = BrowserWindow.getAllWindows().some(
        (window) => !window.isDestroyed() && window.isFocused()
      )
      if (focused) return
      if (process.memoryUsage().heapUsed < IDLE_GC_HEAP_THRESHOLD_BYTES) return
      gc()
    } catch {
      // GC optional
    }
  }, IDLE_GC_INTERVAL_MS)
  idleGcTimer.unref()
}

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
    // Restore the local-only network switch before the first provider request.
    // The fetch guard covers every other outbound call (calendar, webhooks,
    // diagnostics), not just the provider adapter path.
    installAirgapFetchGuard()
    setAirgapShield(settingsDomain.get().airgap === true)
    applyContentSecurityPolicy()
    applyPermissionPolicy()
    applyDisplayMediaPolicy()
    registerIpcHandlers()
    // First run: the control panel, because onboarding (provider key, model,
    // permissions) needs a real window. Every later run: the HUD, with the
    // control panel one click away — its own button, the tray, and the
    // "launch Klyro again" path all open it.
    const showPanelAtLaunch = settingsDomain.get().onboardingComplete !== true
    // HUD-first launches do not pay for the control panel: it is created the
    // first time something asks for it (the logo button, the tray, a second
    // launch). Onboarding still gets its window immediately.
    if (showPanelAtLaunch) createMainWindow({ show: true })
    const overlay = createOverlayWindow()
    applyTrayVisibility()
    registerShortcuts()
    if (!showPanelAtLaunch) {
      // Wait for the renderer so the HUD fades in already painted instead of
      // flashing an empty background colour.
      if (overlay.webContents.isLoading()) {
        overlay.once('ready-to-show', () => toggleOverlay())
      } else {
        toggleOverlay()
      }
    }
    // Opt-in only: a capture permission prompt at launch is a prompt the user
    // did not trigger. This stays off unless the user turns on
    // "Ask for screen permission at launch" in Settings; capture asks for the
    // permission on the click instead. macOS-only, because Windows never asks
    // per capture and the Wayland portal would raise a dialog at startup.
    if (settingsDomain.get().screenPreWarm && process.platform === 'darwin') {
      void warmupScreenPermission()
    }

    // Everything below is background work: disk sweeps, retention pruning, the
    // daemon, OCR and the Antigravity service. None of it is needed to paint
    // the HUD, and each one costs startup time or RAM, so let the first frame
    // land first. Failures stay local to their step.
    const startBackgroundWork = (): void => {
      // Remove leftovers from a previous run before anything writes again.
      maintenance.sweep()
      // A retention policy is only a policy if it is applied: what is older
      // than the user's window is gone before any of it is ever shown.
      interviews.prune()
      conversations.prune()
      audit.prune()
      // The answer cache promises fifteen minutes; make the file say the same.
      answerCache.sweep()
      // If the user has connected Antigravity, start its agent service now so
      // the first question does not wait for it. It fails quietly: the service
      // is started again on demand.
      void antigravity.warmUp()
      // The daemon owns the hot path. It starts in milliseconds and lives in a
      // few megabytes. If it is not built, the app carries on without it, and
      // the TypeScript clients answer until it is ready.
      void daemon.start()
      prewarmOcr()
      // A quiet check for a newer release, fifteen seconds from now. It never
      // downloads without a click, and it is skipped on an airgapped machine.
      startUpdater()
    }
    const backgroundTimer = setTimeout(startBackgroundWork, 1200)
    backgroundTimer.unref()

    startIdleMemoryCompaction()
    logger.info(`Klyro ${app.getVersion()} ready on ${process.platform}`)

    app.on('activate', () => {
      // The dock icon opens the control panel, whether or not the overlay is
      // already on screen.
      showMainWindow()
    })
  })

  // Tray app: keep running when all windows are closed.
  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return
  })

  app.on('will-quit', () => {
    if (idleGcTimer) clearInterval(idleGcTimer)
    unregisterShortcuts()
    // Never leave a server we started running behind us.
    localAgentLauncher.stopOpenCode()
    daemon.stop()
    antigravity.stopService()
  })
}
