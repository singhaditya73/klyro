/**
 * End-to-end smoke check.
 *
 * Boots the real, built app (main + preload + renderer) and inspects the live
 * window: any renderer error, CSP violation, or missing preload bridge fails it.
 *
 * Run after `npm run build`:
 *   npx electron scripts/smoke.cjs
 */
const { app, BrowserWindow } = require('electron')

const problems = []
const consoleMessages = []

// Boot the real application (registers IPC, creates windows, applies CSP).
require('../out/main/index.js')

function record(level, message) {
  consoleMessages.push(`[${level}] ${message}`)
  if (level === 'error' || level === 'warning') problems.push(`${level}: ${message}`)
}

app.whenReady().then(async () => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.on('console-message', (event) => {
      const level = ['debug', 'info', 'warning', 'error'][event.level] ?? String(event.level)
      record(level, event.message)
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      problems.push(`render process gone: ${details.reason}`)
    })
    win.webContents.on('preload-error', (_event, path, error) => {
      problems.push(`preload error in ${path}: ${error.message}`)
    })
  }

  // Give the renderer time to mount and run its startup effects.
  await new Promise((resolve) => setTimeout(resolve, 3000))

  const windows = BrowserWindow.getAllWindows()
  const results = []

  for (const win of windows) {
    const url = win.webContents.getURL()
    let report
    try {
      report = await win.webContents.executeJavaScript(`(() => ({
        hash: location.hash,
        bridge: typeof window.klyro === 'object' && window.klyro !== null,
        bridgeKeys: window.klyro ? Object.keys(window.klyro).length : 0,
        rootChildren: document.getElementById('root')?.children.length ?? 0,
        text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
        styleSheets: document.styleSheets.length,
        buttons: document.querySelectorAll('button').length
      }))()`)
    } catch (error) {
      problems.push(`could not inspect ${url}: ${error.message}`)
      continue
    }
    results.push({ url, ...report })
    if (!report.bridge) problems.push(`${url}: window.klyro bridge is missing`)
    if (report.rootChildren === 0) problems.push(`${url}: the renderer rendered nothing into #root`)
  }

  console.log('--- smoke report ---')
  console.log(JSON.stringify({ windows: results, problems, consoleMessages }, null, 2))
  console.log(problems.length === 0 ? 'SMOKE OK' : `SMOKE FAILED (${problems.length} problem(s))`)

  app.exit(problems.length === 0 ? 0 : 1)
})
