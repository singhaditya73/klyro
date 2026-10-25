/**
 * Live check: the quiet controls, in the real app.
 *
 * What this verifies:
 *   - the tray is on by default and can be turned off without taking the app
 *     down (the shortcut and a second launch are still the way back);
 *   - the control panel can be kept out of the taskbar;
 *   - the hide-everything shortcut is registered and is not the overlay toggle;
 *   - hiding the overlay actually hides its window.
 *
 * What it cannot verify, and does not claim: that the process is hidden. It is
 * not — that is the operating system's process list, and this app does not
 * touch it.
 *
 * Run against the built app:
 *   npx electron --user-data-dir=/tmp/klyro-stealth scripts/check-stealth.cjs
 */
const { app, BrowserWindow, globalShortcut } = require('electron')

require('../out/main/index.js')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const problems = []

app.whenReady().then(async () => {
  await sleep(3000)
  const windows = BrowserWindow.getAllWindows()
  const main = windows.find((win) => win.webContents.getURL().includes('index.html') && !win.webContents.getURL().includes('overlay'))
  const overlay = windows.find((win) => win.webContents.getURL().includes('overlay'))
  if (!main || !overlay) {
    console.error('STEALTH CHECK FAILED: no window')
    app.exit(1)
    return
  }

  const read = () => main.webContents.executeJavaScript('window.klyro.getSettings()')
  const write = (patch) =>
    main.webContents.executeJavaScript(`window.klyro.updateSettings(${JSON.stringify(patch)})`)

  const before = await read()
  if (before.showTray !== true) problems.push('the tray is not on by default')
  if (before.hideFromTaskbar !== false) problems.push('the control panel is out of the taskbar by default')
  const panic = before.panicShortcut
  if (!panic) problems.push('there is no hide-everything shortcut by default')
  if (panic === before.toggleShortcut) problems.push('the hide shortcut collides with the overlay toggle')

  // Both accelerators have to be live, otherwise the setting is only a string.
  // Test-only combinations are used because a running Klyro (for example a dev
  // instance) already holds the defaults: a second app cannot register the same
  // global shortcut, and the failure would say nothing about this build.
  //
  // A headless/CI session has no global-shortcut seat at all, so first check
  // whether *any* accelerator can be registered. If none can, that is the
  // environment, not the wiring, and the check says so instead of failing.
  const probe = 'CommandOrControl+Alt+Shift+F8'
  const shortcutsTestable = globalShortcut.register(probe, () => undefined)
  if (shortcutsTestable) globalShortcut.unregister(probe)

  const testToggle = 'CommandOrControl+Alt+Shift+F9'
  const testPanic = 'CommandOrControl+Alt+Shift+F10'
  await write({ toggleShortcut: testToggle, panicShortcut: testPanic, showTray: false })
  await sleep(600)
  if (shortcutsTestable && !globalShortcut.isRegistered(testToggle)) {
    problems.push(`the quick-ask shortcut is not registered: ${testToggle}`)
  }
  if (shortcutsTestable && !globalShortcut.isRegistered(testPanic)) {
    problems.push(`the hide shortcut is not registered: ${testPanic}`)
  }

  // Whether or not the OS grants the accelerator, the app must have *tried*
  // with the values from settings and report them back honestly.
  const status = await main.webContents.executeJavaScript('window.klyro.shortcutStatus()')
  const planned = status.map((entry) => `${entry.kind}:${entry.accelerator}`)
  if (!planned.includes(`toggle:${testToggle}`)) problems.push('the quick-ask accelerator was not passed to the registrar')
  if (!planned.includes(`hide:${testPanic}`)) problems.push('the hide accelerator was not passed to the registrar')

  // The tray can go away without the app going with it.
  await sleep(200)
  const withoutTray = await read()
  if (withoutTray.showTray !== false) problems.push('turning the tray off did not reach the settings')
  const aliveAfterTray = await main.webContents.executeJavaScript('1 + 1')
  if (aliveAfterTray !== 2) problems.push('the app stopped responding after the tray was removed')

  // The control panel can leave the taskbar.
  await write({ hideFromTaskbar: true })
  await sleep(400)
  const withoutTaskbar = await read()
  if (withoutTaskbar.hideFromTaskbar !== true) problems.push('turning the taskbar button off did not reach the settings')

  // Hiding the overlay actually hides the window (the panic shortcut does the
  // same thing, plus the control panel).
  await main.webContents.executeJavaScript('window.klyro.toggleOverlay()')
  await sleep(1200)
  const shown = overlay.isVisible()
  await main.webContents.executeJavaScript('window.klyro.hideOverlay()')
  await sleep(1200)
  const hidden = overlay.isVisible()
  if (!shown) problems.push('the overlay never became visible, so hiding it proved nothing')
  if (hidden) problems.push('the overlay is still visible after being hidden')

  // Put the profile back the way it was; this is a test profile, but the check
  // should leave no surprises if it is run against a real one.
  await write({
    showTray: before.showTray,
    hideFromTaskbar: before.hideFromTaskbar,
    toggleShortcut: before.toggleShortcut,
    panicShortcut: before.panicShortcut
  })
  await sleep(400)

  const report = {
    tray: { before: before.showTray, off: withoutTray.showTray, backOn: (await read()).showTray },
    taskbar: { before: before.hideFromTaskbar, off: withoutTaskbar.hideFromTaskbar, backOn: (await read()).hideFromTaskbar },
    shortcuts: {
      testableHere: shortcutsTestable,
      planned,
      quickAsk: testToggle,
      quickAskRegistered: shortcutsTestable ? globalShortcut.isRegistered(testToggle) : null,
      hideEverything: testPanic,
      hideEverythingRegistered: shortcutsTestable ? globalShortcut.isRegistered(testPanic) : null,
      note: shortcutsTestable ? null : 'no global-shortcut seat in this session (headless); wiring still exercised'
    },
    overlay: { shown, hiddenAfterHide: !hidden },
    processList: 'not touched — Klyro is still a normal process'
  }
  console.log(JSON.stringify(report, null, 2))

  if (problems.length > 0) {
    console.error('STEALTH CHECK FAILED:')
    for (const problem of problems) console.error(' - ' + problem)
    app.exit(1)
    return
  }
  console.log('STEALTH CHECK OK')
  app.exit(0)
})
