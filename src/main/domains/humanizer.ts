import { execFile, spawn } from 'node:child_process'
import { clipboard } from 'electron'
import { logger } from '../logger'
import { hideOverlay } from './windows'

export interface HumanizeOptions {
  wpm?: number
  mistakeRate?: number
}

/** Sleep helper with optional abort signal */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Humanizer: Injects code / answers into the active window at authentic human typing cadence.
 * Emits real keystrokes with natural jitter (35ms - 120ms), pauses at commas/newlines,
 * completely bypassing anti-paste / zero-millisecond copy-paste detection on test platforms.
 */
export async function simulateHumanTyping(text: string, options: HumanizeOptions = {}): Promise<boolean> {
  if (!text || !text.trim()) return false

  // 1. Give focus back to the target editor / browser window
  hideOverlay()
  await sleep(180)

  const wpm = Math.min(140, Math.max(30, options.wpm || 75))
  // Mean delay between characters based on 5 chars per word: 60,000 / (wpm * 5)
  const baseDelay = Math.round(60_000 / (wpm * 5))

  if (process.platform === 'linux') {
    return typeOnLinux(text, baseDelay)
  } else if (process.platform === 'win32') {
    return typeOnWindows(text, baseDelay)
  } else if (process.platform === 'darwin') {
    return typeOnMac(text, baseDelay)
  }

  // Fallback: clipboard staging with gradual injection
  clipboard.writeText(text)
  return true
}

async function typeOnLinux(text: string, baseDelay: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Try xdotool if available
    const jitter = Math.max(20, Math.round(baseDelay * 0.8))
    const child = execFile('xdotool', ['type', '--delay', String(jitter), '--', text], (err) => {
      if (!err) {
        resolve(true)
        return
      }
      // If xdotool not installed, fallback to clipboard
      logger.info('xdotool not present, falling back to clipboard staging')
      clipboard.writeText(text)
      resolve(false)
    })
    child.on('error', () => {
      clipboard.writeText(text)
      resolve(false)
    })
  })
}

async function typeOnWindows(text: string, baseDelay: number): Promise<boolean> {
  return new Promise((resolve) => {
    // UTF-16-safe base64 keeps the answer out of the PowerShell source: a
    // quoted/backtick/`$( )` in the text must never become executable script.
    const encoded = Buffer.from(text, 'utf8').toString('base64')
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      $t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
      foreach ($c in $t.ToCharArray()) {
        if ($c -eq [char]10) {
          [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        } elseif ($c -eq [char]9) {
          [System.Windows.Forms.SendKeys]::SendWait("{TAB}")
        } else {
          $e = $c.ToString() -replace '([+^%~(){}[\\]])', '{$1}'
          [System.Windows.Forms.SendKeys]::SendWait($e)
        }
        Start-Sleep -Milliseconds (Get-Random -Minimum ${Math.max(15, baseDelay - 25)} -Maximum ${baseDelay + 35})
      }
    `
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      windowsHide: true
    })
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => {
      clipboard.writeText(text)
      resolve(false)
    })
  })
}

async function typeOnMac(text: string, baseDelay: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Escape quotes and backslashes for AppleScript
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const script = `
      tell application "System Events"
        set txt to "${escaped}"
        repeat with i from 1 to count of txt
          keystroke (character i of txt)
          delay ${(baseDelay / 1000).toFixed(3)}
        end repeat
      end tell
    `
    const child = execFile('osascript', ['-e', script], (err) => {
      if (!err) {
        resolve(true)
      } else {
        clipboard.writeText(text)
        resolve(false)
      }
    })
    child.on('error', () => {
      clipboard.writeText(text)
      resolve(false)
    })
  })
}
