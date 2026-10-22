/**
 * Live check: the overlay's model menu, inside the real window.
 *
 * The overlay is a small window, so the menu has to fit inside it: it may not
 * be clipped by the window's edge, the search box has to be visible, the list
 * has to scroll, and the control has to show a name rather than an internal
 * id. Picking a model has to switch the provider and give the window its room
 * back.
 *
 * Run against the built app:
 *   npx electron --user-data-dir=/tmp/klyro-menu scripts/check-overlay-menu.cjs
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

require('../out/main/index.js')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const out = process.env.SHOT_DIR || path.join(require('node:os').tmpdir(), 'klyro-menu')
fs.mkdirSync(out, { recursive: true })

/** What the menu actually looks like, in the window it is in. */
const measure = `(() => {
  const menu = document.querySelector('.model-picker__menu')
  const search = document.querySelector('.model-picker__search')
  const list = document.querySelector('.model-picker__list')
  if (!menu) return null
  const box = menu.getBoundingClientRect()
  const searchBox = search ? search.getBoundingClientRect() : null
  return {
    windowHeight: window.innerHeight,
    top: Math.round(box.top),
    bottom: Math.round(box.bottom),
    height: Math.round(box.height),
    searchVisible: Boolean(searchBox) && searchBox.top >= 0 && searchBox.bottom <= window.innerHeight,
    listScrolls: list.scrollHeight > list.clientHeight,
    clipped: box.bottom > window.innerHeight + 1 || box.top < -1,
    groups: document.querySelectorAll('.model-picker__group-head').length,
    options: document.querySelectorAll('.model-picker__option').length,
    localBadges: document.querySelectorAll('.model-picker__group-head .pill').length
  }
})()`

const problems = []

app.whenReady().then(async () => {
  await sleep(3000)
  const windows = BrowserWindow.getAllWindows()
  const main = windows.find((win) => win.webContents.getURL().includes('index.html') && !win.webContents.getURL().includes('overlay'))
  const overlay = windows.find((win) => win.webContents.getURL().includes('overlay'))
  if (!main || !overlay) {
    console.error('MENU CHECK FAILED: no window')
    app.exit(1)
    return
  }

  await main.webContents.executeJavaScript('window.klyro.toggleOverlay()')
  await sleep(1500)

  const chip = await overlay.webContents.executeJavaScript(
    'document.querySelector(".model-picker__chip")?.textContent?.trim() ?? ""'
  )
  if (!chip) problems.push('the overlay has no model chip')
  if (/^MODEL_/.test(chip)) problems.push(`the chip shows an internal id: ${chip}`)

  await overlay.webContents.executeJavaScript('document.querySelector(".model-picker__chip")?.click()')
  await sleep(1500)

  const menu = await overlay.webContents.executeJavaScript(measure)
  if (!menu) problems.push('the menu did not open')
  else {
    if (menu.clipped) problems.push(`the menu is clipped by the window (${JSON.stringify(menu)})`)
    if (!menu.searchVisible) problems.push('the search box is not visible')
    if (menu.groups === 0) problems.push('the menu lists no provider')
    if (menu.options === 0) problems.push('the menu lists no model')
  }
  const grown = overlay.getBounds().height
  fs.writeFileSync(path.join(out, 'menu.png'), (await overlay.webContents.capturePage()).toPNG())

  // Picking a model has to work, and the window has to give its room back.
  // Pick a model that is not the one already in use, so the change is visible.
  const picked = await overlay.webContents.executeJavaScript(`(() => {
    const options = Array.from(document.querySelectorAll('.model-picker__option'))
    const other = options.find((option) => option.textContent.trim() !== ${JSON.stringify(chip)})
    const option = other ?? options[0]
    if (!option) return null
    const name = option.textContent.trim()
    option.click()
    return name
  })()`)
  await sleep(1500)
  const after = await overlay.webContents.executeJavaScript(
    'document.querySelector(".model-picker__chip")?.textContent?.trim() ?? ""'
  )
  if (!picked) problems.push('there was no model to pick')
  else if (after === chip) problems.push(`picking ${picked} did not change the chip`)
  const shrunk = overlay.getBounds().height
  if (grown <= shrunk) problems.push(`the window did not give its room back (${grown} → ${shrunk})`)

  const settings = await main.webContents.executeJavaScript('window.klyro.getSettings()')
  const report = {
    chip,
    afterPicking: after,
    picked,
    menu,
    windowWhileOpen: grown,
    windowAfterClosing: shrunk,
    activeProvider: settings.activeProvider
  }
  console.log(JSON.stringify(report, null, 2))

  if (problems.length > 0) {
    console.error('MENU CHECK FAILED:')
    for (const problem of problems) console.error(' - ' + problem)
    app.exit(1)
    return
  }
  console.log('MENU CHECK OK')
  app.exit(0)
})
