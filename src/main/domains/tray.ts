import { Menu, Tray, app, nativeImage } from 'electron'
import { KLYRO_ICON_DATA_URL } from '../assets'
import { logger } from '../logger'
import { settingsDomain } from './settings'
import { createMainWindow, hideEverything, showMainWindow, toggleOverlay } from './windows'

let tray: Tray | null = null

/**
 * Create the tray icon, or remove it, to match the setting.
 *
 * Called at launch and whenever the setting changes. Turning it off means
 * there is no visible sign of Klyro in the tray; the quick-ask shortcut and
 * launching Klyro again still reach it.
 */
export function applyTrayVisibility(): void {
  let wanted = true
  try {
    wanted = settingsDomain.get().showTray !== false
  } catch {
    // A settings file that cannot be read still gets the normal tray.
  }
  if (!wanted) {
    destroyTray()
    return
  }
  createTray()
}

/** Remove the tray icon for good, until it is asked for again. */
export function destroyTray(): void {
  if (!tray) return
  try {
    tray.destroy()
  } catch (error) {
    logger.warn('Could not remove the tray icon', error)
  }
  tray = null
}

export function createTray(): void {
  if (tray) return
  try {
    const image = nativeImage.createFromDataURL(KLYRO_ICON_DATA_URL)
    if (process.platform === 'darwin') image.setTemplateImage(true)
    tray = new Tray(image)
    tray.setToolTip('Klyro — Your AI. Your entire computer.')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Klyro', click: () => showMainWindow() },
        { label: 'Quick ask  (Ctrl/Cmd+Shift+Space)', click: () => toggleOverlay() },
        { label: 'Hide everything', click: () => hideEverything() },
        { type: 'separator' },
        { label: 'Quit Klyro', click: () => app.quit() }
      ])
    )
    tray.on('click', () => {
      if (process.platform === 'darwin') toggleOverlay()
      else createMainWindow().show()
    })
  } catch (error) {
    logger.warn('Tray unavailable on this system', error)
  }
}
