/**
 * Does the listen mode start, watch the room, and stay out of the way?
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const os = require('node:os')

const lines = []
const log = (...args) => {
  lines.push(args.map(String).join(' '))
  writeFileSync('/tmp/opencode/listen-result.txt', lines.join('\n'))
}

app.setPath('userData', `${os.homedir()}/.config/klyro`)

require('../out/main/index.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  await wait(5000)
  const windows = BrowserWindow.getAllWindows()
  const overlay = windows.find((win) => win.webContents.getURL().includes('overlay'))
  if (!overlay) {
    log('NO OVERLAY')
    app.exit(1)
    return
  }
  overlay.setBounds({ x: 60, y: 60, width: 760, height: 320 })
  overlay.showInactive()
  await wait(1000)

  const clicked = await overlay.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) =>
      (node.textContent || '').includes('Listen to meeting'))
    if (!button) return 'no button'
    button.click()
    return 'clicked'
  })()`)
  log('listen button:', clicked)
  await wait(4000)

  const state = await overlay.webContents.executeJavaScript(`(() => {
    const text = document.body.innerText
    return JSON.stringify({
      listening: /Listening|Stop listening|system audio|microphone/i.test(text),
      hasStop: [...document.querySelectorAll('button')].some((n) => (n.textContent || '').includes('Stop listening')),
      text: text.slice(0, 200)
    })
  })()`)
  log('state:', state)

  // Stop it again.
  await overlay.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find((node) =>
      (node.textContent || '').includes('Stop listening'))
    if (button) button.click()
    return Boolean(button)
  })()`)
  await wait(1500)
  const after = await overlay.webContents.executeJavaScript(`(() => {
    const text = document.body.innerText
    return JSON.stringify({ stillListening: /Stop listening/.test(text) })
  })()`)
  log('after stop:', after)

  app.exit(0)
})
