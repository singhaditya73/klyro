/**
 * Live check: the overlay's model chip lists every connected provider.
 *
 * It opens the overlay, clicks the chip and waits for the grouped menu, then
 * reports what the renderer actually drew. It is read-only: no model is picked,
 * so the settings file is not touched.
 *
 * The app (including `electron-vite dev`) must not be running: Electron's
 * single-instance lock makes a second instance quit at once. To check against
 * a scratch profile instead:
 *
 *   mkdir -p /tmp/klyro-check && cp ~/.config/klyro/settings.json /tmp/klyro-check/
 *   KLYRO_PROFILE=/tmp/klyro-check npx electron scripts/check-overlay-catalogue.cjs
 */
const { app, BrowserWindow } = require('electron')
const os = require('node:os')
const path = require('node:path')

const profile = process.env.KLYRO_PROFILE || `${os.homedir()}/.config/klyro`
app.setPath('userData', profile)
require('../out/main/index.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  await wait(5000)
  const overlay = BrowserWindow.getAllWindows().find((win) =>
    win.webContents.getURL().includes('overlay')
  )
  if (!overlay) {
    console.error('no overlay window')
    app.exit(1)
    return
  }
  overlay.show()
  overlay.focus()
  await wait(1500)

  const result = await overlay.webContents.executeJavaScript(`(async () => {
    const chip = document.querySelector('.model-picker__chip')
    if (!chip) return { error: 'the overlay has no model chip' }
    const before = chip.textContent.trim()
    chip.click()
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const groups = [...document.querySelectorAll('.model-picker__group-head')]
        .map((element) => element.textContent.trim())
      if (groups.length > 0) {
        return {
          chip: before,
          groups,
          firstModels: [...document.querySelectorAll('.model-picker__option-name')]
            .slice(0, 6)
            .map((element) => element.textContent.trim())
        }
      }
    }
    return { chip: before, groups: [], text: document.body.innerText.slice(-400) }
  })()`)

  console.log(JSON.stringify(result, null, 2))
  // Give stdout a moment: exiting immediately can drop the last write.
  setTimeout(() => app.exit(result.groups && result.groups.length > 0 ? 0 : 1), 100)
})
