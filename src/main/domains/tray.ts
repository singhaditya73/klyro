import { Menu, Tray, app, nativeImage } from 'electron'
import { KLYRO_ICON_DATA_URL } from '../assets'
import { logger } from '../logger'
import { createMainWindow, showMainWindow, toggleOverlay } from './windows'

let tray: Tray | null = null

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
