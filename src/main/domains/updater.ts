import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { IPC } from '@shared/ipc'
import { logger } from '../logger'
import { isAirgapShield } from '../providers/request'
import { settingsDomain } from './settings'

/**
 * Auto-update.
 *
 * Updates are checked, never assumed: the app asks the release page whether a
 * newer version exists, tells the user, and downloads only when they click.
 * Nothing is installed behind their back — `quitAndInstall` runs when they
 * press *Restart now* (or on the next quit for an already-downloaded build).
 *
 * The check contacts GitHub. That is exactly what Airgap Shield forbids, so
 * the check is skipped while the shield is on; the UI says why instead of
 * pretending the app is up to date.
 */

/** How long after launch the first check runs, so it never delays a HUD. */
const CHECK_DELAY_MS = 15_000

let wired = false
let timer: NodeJS.Timeout | null = null

let status: UpdateStatus = {
  phase: 'idle',
  currentVersion: ''
}

function version(): string {
  return app.getVersion()
}

/** True when this build is one electron-updater can replace in place. */
function updatableBuild(): boolean {
  if (!app.isPackaged) return false
  // The .deb is installed by the package manager, which owns the files; only
  // the AppImage can replace itself. On Windows the NSIS installer updates.
  if (process.platform === 'linux' && !process.env.APPIMAGE) return false
  return true
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.updateChanged, status)
  }
}

function set(patch: Partial<UpdateStatus> & { phase: UpdateStatus['phase'] }): UpdateStatus {
  status = { ...status, ...patch, currentVersion: version() }
  broadcast()
  return status
}

function wire(): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ phase: 'checking', message: undefined }))
  autoUpdater.on('update-available', (info: UpdateInfo) =>
    set({ phase: 'available', version: info.version, percent: 0, message: undefined })
  )
  autoUpdater.on('update-not-available', () =>
    set({ phase: 'up-to-date', version: undefined, percent: undefined, checkedAt: Date.now() })
  )
  autoUpdater.on('download-progress', (progress: ProgressInfo) =>
    set({ phase: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    set({ phase: 'ready', version: info.version, percent: 100, checkedAt: Date.now() })
  )
  autoUpdater.on('error', (error: Error) => {
    logger.warn('Update check failed', error.message)
    set({ phase: 'error', message: error.message })
  })
}

export function updateStatus(): UpdateStatus {
  return { ...status, currentVersion: version() }
}

/** Ask the release page for a newer version, at the user's request. */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return set({
      phase: 'unsupported',
      message: 'Update checks run in an installed build, not in development.'
    })
  }
  if (!updatableBuild()) {
    return set({
      phase: 'unsupported',
      message:
        'This install cannot update itself. Download the new version from the releases page and install it the same way you installed this one.'
    })
  }
  if (isAirgapShield()) {
    return set({
      phase: 'unsupported',
      message: 'Airgap Shield is on, so Klyro does not contact the update server.'
    })
  }

  wire()
  set({ phase: 'checking', message: undefined })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    // A missing publish configuration, a blocked network or a rate limit all
    // land here; the UI shows the reason instead of a silent nothing.
    const message = (error as Error).message || 'The update server could not be reached.'
    logger.warn('Update check failed', message)
    set({ phase: 'error', message })
  }
  return updateStatus()
}

/** Download the version that a check found. Never starts on its own. */
export async function downloadUpdate(): Promise<UpdateStatus> {
  if (status.phase !== 'available' && status.phase !== 'downloading') {
    return updateStatus()
  }
  wire()
  set({ phase: 'downloading', percent: 0 })
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    const message = (error as Error).message || 'The update could not be downloaded.'
    logger.warn('Update download failed', message)
    set({ phase: 'error', message })
  }
  return updateStatus()
}

/** Install the downloaded version and restart. Only after a download. */
export function installUpdate(): void {
  if (status.phase !== 'ready') return
  // `isSilent = false` shows the installer, `isForceRunAfter = true` reopens
  // Klyro when it finishes.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}

/**
 * Called once at startup. It is deliberately late and quiet: a check must not
 * compete with the first paint, and a failure is not worth a notification.
 */
export function startUpdater(): void {
  stopUpdater()
  if (!updatableBuild()) return
  if (isAirgapShield()) return
  if (settingsDomain.get().autoUpdateCheck === false) return
  timer = setTimeout(() => {
    timer = null
    void checkForUpdates()
  }, CHECK_DELAY_MS)
  timer.unref?.()
}

export function stopUpdater(): void {
  if (timer) clearTimeout(timer)
  timer = null
}
