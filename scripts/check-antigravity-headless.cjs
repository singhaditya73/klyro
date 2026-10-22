/**
 * With the saved session and the IDE closed: can Klyro start Antigravity's own
 * service and get an answer from it?
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const os = require('node:os')

const lines = []
const log = (...args) => {
  lines.push(args.map(String).join(' '))
  writeFileSync('/tmp/opencode/ag-headless.txt', lines.join('\n'))
}

app.setPath('userData', `${os.homedir()}/.config/klyro`)
require('../out/main/index.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  await wait(6000)
  const wins = BrowserWindow.getAllWindows()
  const main = wins.find((win) => !win.webContents.getURL().includes('overlay')) ?? wins[0]

  const started = await main.webContents.executeJavaScript(
    `window.klyro.antigravityStartService().then((r) => JSON.stringify(r)).catch((e) => 'ERR ' + e.message)`
  )
  log('startService:', started)

  const status = await main.webContents.executeJavaScript(
    `window.klyro.antigravityStatus().then((s) => JSON.stringify({ running: s.running, plan: s.plan, account: s.account, service: s.service, error: s.error, models: (s.models ?? []).map((m) => ({ id: m.id, name: m.name, quota: m.quota })) })).catch((e) => 'ERR ' + e.message)`
  )
  log('status:', status)

  const asked = await main.webContents.executeJavaScript(`(async () => {
    try {
      const settings = await window.klyro.getSettings()
      const catalogue = await window.klyro.providerModels('antigravity')
      window.__models = (catalogue.models ?? []).map((m) => ({ id: m.id, name: m.name }))
      console.log('MODELS', JSON.stringify(window.__models))
      const model = catalogue.models?.[0]?.id ?? ''
      await window.klyro.updateSettings({
        activeProvider: 'antigravity',
        providers: {
          ...settings.providers,
          antigravity: { ...(settings.providers.antigravity ?? {}), model }
        }
      })
      const conversation = await window.klyro.createConversation()
      const started = Date.now()
      await window.klyro.sendChat({
        conversationId: conversation.id,
        content: 'Name one thing a hammer is for. One short sentence.',
        useFastModel: false
      })
      for (let attempt = 0; attempt < 45; attempt++) {
        await new Promise((r) => setTimeout(r, 1000))
        const conv = await window.klyro.getConversation(conversation.id)
        const messages = conv?.conversation?.messages ?? []
        const last = messages[messages.length - 1]
        if (last && last.role !== 'user') {
          return JSON.stringify({ model, ms: Date.now() - started, text: String(last.content ?? '').slice(0, 200) })
        }
      }
      return JSON.stringify({ model, text: 'no answer within 45s' })
    } catch (error) {
      return 'ERR ' + error.message
    }
  })()`)
  log('answer:', asked)

  // The same question through the daemon: the Rust Connect-RPC client, with
  // the port and token the app hands it.
  const askedFast = await main.webContents.executeJavaScript(`(async () => {
    try {
      const settings = await window.klyro.getSettings()
      const catalogue = await window.klyro.providerModels('antigravity')
      const model = settings.providers.antigravity?.model || catalogue.models?.[0]?.id || ''
      const conversation = await window.klyro.createConversation()
      const started = Date.now()
      await window.klyro.sendChat({
        conversationId: conversation.id,
        content: 'Name one thing a hammer is for. One short sentence.',
        useFastModel: true
      })
      for (let attempt = 0; attempt < 45; attempt++) {
        await new Promise((r) => setTimeout(r, 1000))
        const conv = await window.klyro.getConversation(conversation.id)
        const messages = conv?.conversation?.messages ?? []
        const last = messages[messages.length - 1]
        if (last && last.role !== 'user') {
          return JSON.stringify({ model, ms: Date.now() - started, text: String(last.content ?? '').slice(0, 200) })
        }
      }
      return JSON.stringify({ model, text: 'no answer within 45s' })
    } catch (error) {
      return 'ERR ' + error.message
    }
  })()`)
  log('answer via daemon:', askedFast)

  app.exit(0)
})
