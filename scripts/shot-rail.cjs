/**
 * Focused review shot: the collapsed sidebar rail.
 *
 * Usage: npx electron scripts/shot-rail.cjs
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const outDir = process.env.KLYRO_SHOT_DIR || '/tmp/opencode/shots'
mkdirSync(outDir, { recursive: true })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

require('../out/main/index.js')

app.whenReady().then(async () => {
  await wait(3500)
  const main = BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().includes('overlay'))
  if (!main) {
    app.exit(1)
    return
  }
  main.setMinimumSize(1180, 780)
  main.setSize(1280, 860)
  main.setPosition(0, 0)
  await wait(800)

  const collapse = await main.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('button[aria-label="Collapse sidebar"]')
    if (!button) return 'no-collapse-button'
    button.click()
    return 'clicked'
  })()`)
  console.log('collapse:', collapse)
  await wait(900)

  const image = await main.webContents.capturePage()
  writeFileSync(join(outDir, '12-collapsed-rail.png'), image.toPNG())
  console.log('shot 12-collapsed-rail')

  // Report what the rail contains, so overflow is measurable, not guessed.
  const report = await main.webContents.executeJavaScript(`(() => {
    const rail = document.querySelector('.sidebar--collapsed')
    if (!rail) return { error: 'rail missing' }
    const overflow = [...rail.querySelectorAll('button, a, span')].map((node) => {
      const rect = node.getBoundingClientRect()
      return { label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 24), right: Math.round(rect.right), width: Math.round(rect.width) }
    }).filter((entry) => entry.right > rail.getBoundingClientRect().right + 1)
    return { railWidth: Math.round(rail.getBoundingClientRect().width), overflowing: overflow }
  })()`)
  console.log('rail report:', JSON.stringify(report))
  app.exit(0)
})
