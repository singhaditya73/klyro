/**
 * Screenshot of the model picker in the chat composer.
 *
 * Usage: npx electron scripts/shot-model-picker.cjs
 */
const { app, BrowserWindow } = require('electron')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const os = require('node:os')

const outDir = process.env.KLYRO_SHOT_DIR || '/tmp/opencode/shots'
mkdirSync(outDir, { recursive: true })

// Use the real user-data folder, so the saved keys and session are in play.
app.setPath('userData', `${os.homedir()}/.config/klyro`)

require('../out/main/index.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  await wait(5000)
  const windows = BrowserWindow.getAllWindows()
  const main = windows.find((win) => !win.webContents.getURL().includes('overlay')) ?? windows[0]
  main.webContents.on('console-message', (_e, _l, message) => console.log('[renderer]', message))
  if (!main) {
    console.log('NO WINDOW')
    app.exit(1)
    return
  }
  main.setBounds({ x: 0, y: 0, width: 1400, height: 900 })

  // Settings → Providers → the Antigravity card.
  await main.webContents.executeJavaScript(`(() => {
    const item = [...document.querySelectorAll('a, button, [role="button"]')].find((node) =>
      (node.textContent || '').trim().toLowerCase() === 'settings')
    if (item) item.click()
    return Boolean(item)
  })()`)
  await wait(2500)
  await main.webContents.executeJavaScript(`(() => {
    const card = [...document.querySelectorAll('.provider-card')].find((node) =>
      (node.textContent || '').includes('Antigravity'))
    if (!card) return false
    card.scrollIntoView({ block: 'center' })
    const button = card.querySelector('.model-picker__button')
    if (button) button.click()
    return true
  })()`)
  await wait(4000)
  writeFileSync(join(outDir, 'model-picker-settings.png'), (await main.webContents.capturePage()).toPNG())
  console.log('shot model-picker-settings')

  // Close the settings and open the chat, where the composer chip lives.
  await main.webContents.executeJavaScript(`(() => {
    document.querySelector('.modal__head button, .modal button[aria-label="Close"]')?.click()
    const item = [...document.querySelectorAll('a, button, [role="button"]')].find((node) =>
      (node.textContent || '').trim().toLowerCase() === 'chat')
    if (item) item.click()
    return true
  })()`)
  await wait(3000)
  const chip = await main.webContents.executeJavaScript(`(() => {
    const chips = [...document.querySelectorAll('.model-picker__chip')]
    if (!chips.length) return 'no chip'
    const info = chips.map((c) => ({ provider: c.closest('.model-picker')?.dataset.provider, text: c.textContent.trim() }))
    chips[0].click()
    return JSON.stringify(info)
  })()`)
  console.log('chip:', chip)
  await wait(2500)
  writeFileSync(join(outDir, 'model-picker-composer.png'), (await main.webContents.capturePage()).toPNG())
  console.log('shot model-picker-composer')

  const options = await main.webContents.executeJavaScript(`(() => {
    const menus = [...document.querySelectorAll('.model-picker__menu')].map((m) => ({
      count: m.querySelectorAll('.model-picker__option').length,
      first: (m.querySelector('.model-picker__option') || {}).textContent
    }))
    const menu = document.querySelector('.model-picker__menu')
    const direct = window.klyro.providerModels('antigravity').then((r) => r.models.length)
    return JSON.stringify({
      menuCount: menu ? menu.querySelectorAll('.model-picker__option').length : -1,
      allMenus: menus,
      menuProvider: menu ? menu.dataset.provider : null,
      menuFirst: menu ? (menu.querySelector('.model-picker__option') || {}).textContent : null,
      directAntigravity: null
    })
  })()`)
  const direct = await main.webContents.executeJavaScript(
    `window.klyro.providerModels('antigravity').then((r) => JSON.stringify({ count: r.models.length, first: r.models[0]?.id }))`
  )
  console.log('direct antigravity:', direct)
  console.log('options:', options)

  app.exit(0)
})
