import { app, BrowserWindow } from 'electron'
import { logger } from '../logger'

/**
 * Quiet presence while a meeting is being recorded.
 *
 * Klyro produces no toasts today, but a recording must stay silent even when
 * that changes: no badge, no taskbar flash, and no audio output that the
 * meeting's own microphone or system-audio loop could pick up. The app cannot
 * silence *other* applications' notifications — that is the operating
 * system's job — but it can guarantee its own are not the leak.
 *
 * Everything here is best-effort: a platform that refuses one part must not
 * leave the others undone, and the microphone must never be muted by this.
 */

let quiet = false

function liveWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed())
}

function clearAttention(): void {
  try {
    if (process.platform === 'darwin') {
      app.dock?.setBadge('')
    } else {
      app.setBadgeCount(0)
    }
  } catch (error) {
    logger.debug('Badge could not be cleared', error)
  }
  for (const win of liveWindows()) {
    try {
      // A flash on the taskbar is visible to anyone watching the screen.
      win.flashFrame(false)
    } catch {
      // Best effort.
    }
  }
}

/** Mute Klyro's own playback so it cannot be captured through a loopback. */
function muteOwnAudio(muted: boolean): void {
  for (const win of liveWindows()) {
    try {
      win.webContents.setAudioMuted(muted)
    } catch {
      // Best effort.
    }
  }
}

/** Called when recording starts (true) and stops (false). Idempotent. */
export function setQuietPresence(active: boolean): boolean {
  if (quiet === active) return quiet
  quiet = active
  if (active) {
    clearAttention()
    muteOwnAudio(true)
    logger.debug('Quiet presence on: no badge, no flash, no Klyro audio')
  } else {
    muteOwnAudio(false)
    logger.debug('Quiet presence off')
  }
  return quiet
}

export function quietPresenceActive(): boolean {
  return quiet
}
