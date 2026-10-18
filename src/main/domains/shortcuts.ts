import { globalShortcut } from 'electron'
import { logger } from '../logger'
import { settingsDomain } from './settings'
import { toggleOverlay } from './windows'

const DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+Space'

export function registerShortcuts(): void {
  unregisterShortcuts()
  const accelerator = settingsDomain.get().toggleShortcut || DEFAULT_ACCELERATOR
  try {
    const ok = globalShortcut.register(accelerator, () => toggleOverlay())
    if (!ok) logger.warn(`Global shortcut unavailable (already in use?): ${accelerator}`)
  } catch (error) {
    logger.warn('Failed to register global shortcut', accelerator, error)
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
