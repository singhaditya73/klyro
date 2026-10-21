/**
 * Screenshot of the Antigravity card in Integrations.
 *
 * Usage: npx electron scripts/shot-antigravity.cjs
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const outDir = process.env.KLYRO_SHOT_DIR || '/tmp/opencode/shots'
mkdirSync(outDir, { recursive: true })

require('../out/main/index.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  await wait(3500)
  const windows = BrowserWindow.getAllWindows()
  const main = windows.find((win) => !win.webContents.getURL().includes('overlay')) ?? windows[0]
  if (!main) {
    console.log('NO WINDOW')
    app.exit(1)
    return
  }
  main.setBounds({ x: 0, y: 0, width: 1400, height: 900 })

  await main.webContents.executeJavaScript(`(() => {
    const item = [...document.querySelectorAll('a, button, [role="button"]')].find((node) =>
      (node.textContent || '').trim().toLowerCase() === 'integrations')
    if (item) item.click()
    return Boolean(item)
  })()`)
  await wait(9000)

  const found = await main.webContents.executeJavaScript(`(() => {
    const target = [...document.querySelectorAll('.card__title')].find((node) =>
      (node.textContent || '').includes('Antigravity'))
    if (!target) return false
    const card = target.closest('.card')
    if (card) card.scrollIntoView({ block: 'center' })
    return true
  })()`)
  console.log('antigravity card found:', found)
  await wait(1200)

  const image = await main.webContents.capturePage()
  writeFileSync(join(outDir, 'antigravity.png'), image.toPNG())
  console.log('shot antigravity')

  app.exit(0)
})
