/**
 * Screenshots of the trimmed app: the control panel and the overlay.
 *
 * Usage: npx electron scripts/shot-trimmed.cjs
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const os = require('node:os')

const outDir = process.env.KLYRO_SHOT_DIR || '/tmp/opencode/shots'
mkdirSync(outDir, { recursive: true })

app.setPath('userData', `${os.homedir()}/.config/klyro`)

require('../out/main/index.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  await wait(5000)
  const windows = BrowserWindow.getAllWindows()
  const main = windows.find((win) => !win.webContents.getURL().includes('overlay')) ?? windows[0]
  const overlay = windows.find((win) => win.webContents.getURL().includes('overlay'))
  if (!main) {
    console.log('NO WINDOW')
    app.exit(1)
    return
  }
  main.setBounds({ x: 0, y: 0, width: 1200, height: 860 })
  await wait(1500)
  writeFileSync(join(outDir, 'trimmed-control-panel.png'), (await main.webContents.capturePage()).toPNG())
  console.log('shot trimmed-control-panel')

  if (overlay) {
    overlay.setBounds({ x: 60, y: 60, width: 700, height: 240 })
    overlay.showInactive()
    await wait(1200)
    writeFileSync(join(outDir, 'trimmed-overlay.png'), (await overlay.webContents.capturePage()).toPNG())
    console.log('shot trimmed-overlay')
  }

  app.exit(0)
})
