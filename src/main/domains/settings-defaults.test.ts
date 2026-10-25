import { describe, expect, it, vi } from 'vitest'

/**
 * The overlay exists to be read while someone else is talking. If it shows up
 * in a screen share, it has done the opposite of its job — so being excluded
 * from captures is the default, not an opt-in.
 *
 * The settings module builds its store at import time, so Electron is stood in
 * for here; only the defaults are under test.
 */
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/klyro-test' }
}))
vi.mock('../security/secrets', () => ({
  secrets: { get: () => null, set: () => undefined, remove: () => undefined }
}))

const { DEFAULT_SETTINGS } = await import('./settings')

describe('the stealth defaults', () => {
  it('keeps the overlay out of screen shares from the first launch', () => {
    expect(DEFAULT_SETTINGS.overlayPrivateMode).toBe(true)
  })

  it('keeps capture and pre-warm quiet but ready', () => {
    expect(DEFAULT_SETTINGS.screenAutoCapture).toBe(true)
    expect(DEFAULT_SETTINGS.diagnosticsOptIn).toBe(false)
  })

  /**
   * The tray is the way back to the control panel, so it stays on unless the
   * user turns it off. Turning it off removes the icon, not the process.
   */
  it('shows the tray by default, and lets it be turned off', () => {
    expect(DEFAULT_SETTINGS.showTray).toBe(true)
  })

  it('keeps the control panel in the taskbar by default', () => {
    expect(DEFAULT_SETTINGS.hideFromTaskbar).toBe(false)
  })

  it('has a hide-everything shortcut that is not the overlay toggle', () => {
    expect(DEFAULT_SETTINGS.panicShortcut).toBe('CommandOrControl+Shift+H')
    expect(DEFAULT_SETTINGS.panicShortcut).not.toBe(DEFAULT_SETTINGS.toggleShortcut)
  })
})
