/**
 * Screenshot helper for the first-run tour.
 *
 * Usage: npx electron scripts/shot-onboarding.cjs
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
  await wait(600)

  // Start from a clean first-run state.
  await main.webContents.executeJavaScript(
    `(async () => { await window.klyro.updateSettings({ onboardingComplete: false }) })()`
  )
  await wait(200)
  await main.webContents.reload()
  await wait(2500)

  const shot = async (name) => {
    const image = await main.webContents.capturePage()
    writeFileSync(join(outDir, `${name}.png`), image.toPNG())
    console.log('shot', name)
  }

  await shot('15-onboarding-welcome')

  // Step two: the "try it" screen.
  await main.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) => ['Show me', 'Try anyway'].includes((node.textContent || '').trim()))
    if (button) button.click()
  })()`)
  await wait(900)
  await shot('16-onboarding-try')

  app.exit(0)
})
