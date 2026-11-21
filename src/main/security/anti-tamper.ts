/**
 * Anti-Debugging, Anti-Inspection & Binary Tampering Defenses (Layer 4)
 *
 * Hardens Klyro against automated reverse engineering agents (e.g. REA / Ghidra / IDA Pro)
 * by blocking unauthorized debug hooks, runtime node switches, and DevTools injection in production.
 */

import { app, BrowserWindow } from 'electron'
import { logger } from '../logger'

/** Prohibited command-line arguments that allow process inspection or memory injection */
export const PROHIBITED_INSPECT_FLAGS = [
  '--inspect',
  '--inspect-brk',
  '--remote-debugging-port',
  '--remote-debugging-targets',
  '--remote-allow-origins',
  '--enable-source-maps'
]

/**
 * Checks whether any prohibited reverse-engineering flags are present in command-line arguments.
 */
export function containsProhibitedFlags(args: string[]): boolean {
  for (const arg of args) {
    const lower = arg.toLowerCase()
    for (const flag of PROHIBITED_INSPECT_FLAGS) {
      if (lower.startsWith(flag)) {
        return true
      }
    }
  }
  return false
}

/**
 * Checks whether the environment is attempting an unauthorized node runtime switch.
 */
export function hasUnauthorizedNodeSwitch(env: NodeJS.ProcessEnv): boolean {
  return env.ELECTRON_RUN_AS_NODE === '1' || env.ELECTRON_RUN_AS_NODE === 'true'
}

/**
 * Enforces production anti-tampering guards. Terminate process immediately if tampering is detected.
 */
export function enforceAntiTamperPolicy(appInstance: typeof app = app): void {
  // Only enforce strict termination when running in packaged production build
  if (!appInstance.isPackaged) {
    return
  }

  // 1. Guard against ELECTRON_RUN_AS_NODE runtime hijack
  if (hasUnauthorizedNodeSwitch(process.env)) {
    logger.warn('Anti-Tamper: Unauthorized ELECTRON_RUN_AS_NODE detected. Terminating.')
    delete process.env.ELECTRON_RUN_AS_NODE
    process.exit(1)
  }

  // 2. Guard against command-line debugging & inspection flags
  if (containsProhibitedFlags(process.argv)) {
    logger.warn('Anti-Tamper: Prohibited debugger arguments detected in production build. Terminating.')
    process.exit(1)
  }
}

/**
 * Locks down DevTools and inspection shortcuts on production windows.
 */
export function protectWindowFromDevTools(window: BrowserWindow): void {
  if (!app.isPackaged) {
    return
  }

  // Auto-close DevTools if forcefully opened
  window.webContents.on('devtools-opened', () => {
    logger.warn('Anti-Tamper: DevTools opened in packaged mode. Forcing close.')
    window.webContents.closeDevTools()
  })

  // Prevent keyboard shortcuts (F12, Ctrl+Shift+I, Cmd+Option+I)
  window.webContents.on('before-input-event', (event, input) => {
    if (
      input.key === 'F12' ||
      ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i')
    ) {
      event.preventDefault()
    }
  })
}

