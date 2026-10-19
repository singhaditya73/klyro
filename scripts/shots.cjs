/**
 * Screenshot helper for design review.
 *
 * Boots the built app, drives the renderer through its main views, and writes
 * a PNG of each one to the directory given in KLYRO_SHOT_DIR.
 *
 * Usage: npx electron scripts/shots.cjs
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
  const overlay = windows.find((win) => win.webContents.getURL().includes('overlay'))
  if (!main) {
    console.log('NO WINDOW')
    app.exit(1)
    return
  }
  // Emulate a normal desktop window even when the virtual display is small.
  main.setSize(1280, 860)
  main.setPosition(0, 0)

  const shot = async (name, win) => {
    if (win === main) {
      win.setBounds({ x: 0, y: 0, width: 1280, height: 860 })
      await wait(250)
    }
    const image = await win.webContents.capturePage()
    writeFileSync(join(outDir, `${name}.png`), image.toPNG())
    console.log('shot', name)
  }

  const clickByLabel = async (label) => {
    await main.webContents.executeJavaScript(`(() => {
      const nodes = [...document.querySelectorAll('.nav-item, button')]
      const match = nodes.find((node) => (node.getAttribute('aria-label') || '').toLowerCase() === ${JSON.stringify(label.toLowerCase())})
        || nodes.find((node) => (node.textContent || '').trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())})
      if (match) { match.click(); return true }
      return false
    })()`)
  }

  const openConversation = async (title) => {
    await main.webContents.executeJavaScript(`(() => {
      const item = [...document.querySelectorAll('.conversation-item')].find((node) =>
        (node.textContent || '').toLowerCase().includes(${JSON.stringify(title.toLowerCase())}))
      if (item) { item.click(); return true }
      return false
    })()`)
  }

  const shots = [
    ['01-home', null],
    ['02-chat', 'chat'],
    ['03-workflows', 'workflows'],
    ['04-integrations', 'integrations'],
    ['05-screen', 'screen']
  ]

  for (const [name, view] of shots) {
    if (view) {
      await clickByLabel(view)
      await wait(1200)
    }
    await shot(name, main)
  }

  // A conversation with real content, to review the chat surface.
  await openConversation('What can Klyro do')
  await wait(1400)
  await shot('07-chat-content', main)

  // The quick-ask overlay (signature surface).
  const overlayWindow = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('overlay'))
  if (overlayWindow) {
    overlayWindow.setBounds({ x: 60, y: 60, width: 640, height: 208 })
    overlayWindow.showInactive()
    await wait(900)
    const image = await overlayWindow.webContents.capturePage()
    writeFileSync(join(outDir, '08-overlay.png'), image.toPNG())
    console.log('shot 08-overlay')
  }

  // Settings panel
  await clickByLabel('settings')
  await wait(1500)
  await shot('06-settings', main)

  // The panels share the modal surface; review the two biggest ones.
  await clickByLabel('agent')
  await wait(1400)
  await shot('10-agent-panel', main)
  await main.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
  await wait(600)
  await clickByLabel('memory')
  await wait(1400)
  await shot('11-knowledge-panel', main)
  await main.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
  await wait(400)

  // Light theme: the same surfaces, flipped.
  await main.webContents.executeJavaScript("document.documentElement.dataset.theme = 'light'")
  await wait(600)
  await shot('09-light-home', main)
  await main.webContents.executeJavaScript("document.documentElement.dataset.theme = 'dark'")

  if (overlay) {
    await main.webContents.executeJavaScript("window.klyro?.hideOverlay?.()")
    await wait(300)
  }

  app.exit(0)
})
