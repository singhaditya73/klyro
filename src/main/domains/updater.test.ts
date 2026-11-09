import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/ipc'

/**
 * Auto-update must stay a sequence the user drives: check, then download,
 * then restart. These tests pin the three promises that matter — nothing is
 * downloaded by itself, the check does not run on an airgapped machine, and
 * an install that cannot replace itself says so instead of pretending.
 */

const h = vi.hoisted(() => {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {}
  return {
    packaged: true,
    version: '1.0.0',
    airgap: false,
    autoUpdateCheck: true,
    windows: [] as Array<{ isDestroyed: () => boolean; webContents: { send: any } }>,
    listeners,
    emit: (event: string, ...args: any[]) => {
      for (const listener of listeners[event] ?? []) listener(...args)
    },
    checkForUpdates: null as any,
    downloadUpdate: null as any,
    quitAndInstall: null as any
  }
})

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return h.packaged
    },
    getVersion: () => h.version
  },
  BrowserWindow: { getAllWindows: () => h.windows }
}))

vi.mock('./settings', () => ({
  settingsDomain: { get: () => ({ autoUpdateCheck: h.autoUpdateCheck }) }
}))

vi.mock('../providers/request', () => ({ isAirgapShield: () => h.airgap }))

vi.mock('electron-updater', () => {
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on(event: string, listener: (...args: any[]) => void) {
      ;(h.listeners[event] ??= []).push(listener)
      return autoUpdater
    },
    checkForUpdates: (...args: any[]) => h.checkForUpdates(...args),
    downloadUpdate: (...args: any[]) => h.downloadUpdate(...args),
    quitAndInstall: (...args: any[]) => h.quitAndInstall(...args)
  }
  return { autoUpdater }
})

const {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  startUpdater,
  stopUpdater,
  updateStatus
} = await import('./updater')

function fakeWindow() {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } }
}

beforeEach(() => {
  h.packaged = true
  h.airgap = false
  h.autoUpdateCheck = true
  h.windows = [fakeWindow()]
  h.checkForUpdates = vi.fn(async () => {
    h.emit('checking-for-update')
    h.emit('update-available', { version: '2.0.0' })
  })
  h.downloadUpdate = vi.fn(async () => {
    h.emit('download-progress', { percent: 42 })
    h.emit('update-downloaded', { version: '2.0.0' })
  })
  h.quitAndInstall = vi.fn()
  vi.stubEnv('APPIMAGE', '/tmp/Klyro.AppImage')
})

afterEach(() => {
  stopUpdater()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('the updater', () => {
  it('does not contact the release page in development', async () => {
    h.packaged = false
    const status = await checkForUpdates()
    expect(status.phase).toBe('unsupported')
    expect(status.message).toMatch(/installed build/)
    expect(h.checkForUpdates).not.toHaveBeenCalled()
  })

  it('says a .deb must be updated by hand, because the package manager owns it', async () => {
    vi.stubEnv('APPIMAGE', '')
    const status = await checkForUpdates()
    expect(status.phase).toBe('unsupported')
    expect(status.message).toMatch(/releases page/)
    expect(h.checkForUpdates).not.toHaveBeenCalled()
  })

  it('will not reach GitHub while Airgap Shield is on', async () => {
    h.airgap = true
    const status = await checkForUpdates()
    expect(status.phase).toBe('unsupported')
    expect(status.message).toMatch(/Airgap/)
    expect(h.checkForUpdates).not.toHaveBeenCalled()
  })

  it('finds a version and never downloads it without a click', async () => {
    const status = await checkForUpdates()

    expect(status.phase).toBe('available')
    expect(status.version).toBe('2.0.0')
    // The promise: a found update is offered, not fetched in the background.
    expect(h.downloadUpdate).not.toHaveBeenCalled()
  })

  it('downloads on request, reports progress and waits for a restart', async () => {
    await checkForUpdates()
    expect(updateStatus().phase).toBe('available')

    const progress = await downloadUpdate()
    expect(h.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(progress.phase).toBe('ready')
    expect(progress.percent).toBe(100)
    expect(h.quitAndInstall).not.toHaveBeenCalled()

    installUpdate()
    // The installer runs on the next tick so the IPC reply can go out first.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('tells every window when the state changes', async () => {
    await checkForUpdates()
    const send = h.windows[0].webContents.send
    expect(send).toHaveBeenCalled()
    const [channel, payload] = send.mock.calls.at(-1)!
    expect(channel).toBe(IPC.updateChanged)
    expect(payload.phase).toBe('available')
  })

  it('leaves the release page alone when the launch check is turned off', async () => {
    vi.useFakeTimers()
    h.autoUpdateCheck = false
    startUpdater()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.checkForUpdates).not.toHaveBeenCalled()
  })

  it('checks once, late, when the launch check is on', async () => {
    vi.useFakeTimers()
    startUpdater()
    expect(h.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1)
  })
})
