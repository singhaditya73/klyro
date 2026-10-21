/**
 * Does the overlay's answer come from the daemon?
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const os = require('node:os')

const lines = []
const log = (...args) => {
  lines.push(args.map(String).join(' '))
  writeFileSync('/tmp/opencode/daemon-answer.txt', lines.join('\n'))
}

app.setPath('userData', `${os.homedir()}/.config/klyro`)

require('../out/main/index.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  await wait(6000)
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

  // Point the app at Ollama, which the daemon can answer for.
  await overlay.webContents.executeJavaScript(`window.klyro.getSettings().then((s) =>
    window.klyro.updateSettings({
      activeProvider: 'ollama',
      providers: { ...s.providers, ollama: { ...s.providers.ollama, baseUrl: 'http://127.0.0.1:11434/v1', model: 'jurisai:latest' } }
    }))`)
  await wait(1500)

  await overlay.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'Name one thing a hammer is for. One short sentence.')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'typed'
  })()`)
  await wait(500)
  await overlay.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find((n) => (n.textContent || '').trim() === 'Ask')
    if (button) button.click()
    return 'asked'
  })()`)

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(2000)
    const state = await overlay.webContents.executeJavaScript(`(() => {
      const answer = document.querySelector('.overlay__answer')
      return (answer ? answer.textContent : '').trim().slice(0, 160)
    })()`)
    if (state && !state.startsWith('Esc to close') && state !== '…') {
      log('answer:', state)
      break
    }
  }
  app.exit(0)
})
