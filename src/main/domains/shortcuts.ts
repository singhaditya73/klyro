import { globalShortcut } from 'electron'
import { logger } from '../logger'
import { settingsDomain } from './settings'
import { panicKillswitch, toggleOverlay, toggleOverlayGhostMode } from './windows'

const DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+Space'

export type ShortcutKind = 'toggle' | 'hide' | 'ghost'

export interface ShortcutBinding {
  kind: ShortcutKind
  accelerator: string
}

/**
 * Which global shortcuts to register, and what each one does.
 */
export function shortcutBindings(settings: {
  toggleShortcut?: string
  panicShortcut?: string
  ghostShortcut?: string
}): ShortcutBinding[] {
  const toggle = (settings.toggleShortcut || '').trim() || DEFAULT_ACCELERATOR
  const bindings: ShortcutBinding[] = [{ kind: 'toggle', accelerator: toggle }]
  const hide = (settings.panicShortcut || '').trim()
  if (hide && hide !== toggle) bindings.push({ kind: 'hide', accelerator: hide })
  const ghost = (settings.ghostShortcut || '').trim()
  if (ghost && ghost !== toggle && ghost !== hide) bindings.push({ kind: 'ghost', accelerator: ghost })
  return bindings
}

/** What this app holds right now, for the settings page to show honestly. */
export function shortcutStatus(): Array<ShortcutBinding & { registered: boolean }> {
  return shortcutBindings(settingsDomain.get()).map((binding) => ({
    ...binding,
    registered: globalShortcut.isRegistered(binding.accelerator)
  }))
}

export function registerShortcuts(): void {
  unregisterShortcuts()
  for (const binding of shortcutBindings(settingsDomain.get())) {
    try {
      const ok = globalShortcut.register(binding.accelerator, () => {
        if (binding.kind === 'toggle') toggleOverlay()
        else if (binding.kind === 'ghost') toggleOverlayGhostMode()
        else panicKillswitch()
      })
      if (!ok) {
        logger.warn(
          `${binding.kind} shortcut unavailable (already in use?): ${binding.accelerator}`
        )
      }
    } catch (error) {
      logger.warn(`Failed to register ${binding.kind} shortcut`, binding.accelerator, error)
    }
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
