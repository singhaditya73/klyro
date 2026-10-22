/**
 * Capture an Antigravity session from the running IDE, then read the account
 * through it. Used to prove the capture side of "connect once".
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const os = require('node:os')

const lines = []
const log = (...args) => {
  lines.push(args.map(String).join(' '))
  writeFileSync('/tmp/opencode/ag-check.txt', lines.join('\n'))
}

app.setPath('userData', `${os.homedir()}/.config/klyro`)
require('../out/main/index.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  await wait(6000)
  const wins = BrowserWindow.getAllWindows()
  const main = wins.find((win) => !win.webContents.getURL().includes('overlay')) ?? wins[0]

  try {
    const connected = await main.webContents.executeJavaScript(
      `window.klyro.antigravityConnect().then((r) => JSON.stringify(r)).catch((e) => 'ERR ' + e.message)`
    )
    log('connect:', connected)
  } catch (error) {
    log('connect threw:', error.message)
  }

  await wait(1500)
  const status = await main.webContents.executeJavaScript(
    `window.klyro.antigravityStatus().then((s) => JSON.stringify({ running: s.running, plan: s.plan, account: s.account, models: (s.models ?? []).length, service: s.service, connected: s.connected, error: s.error })).catch((e) => 'ERR ' + e.message)`
  )
  log('status:', status)

  app.exit(0)
})
