/**
 * Do the local agents answer through the daemon?
 *
 * The question is asked the way the overlay asks one (`useFastModel: true`),
 * so the provider is reached over the daemon's socket rather than in the
 * Electron main process. OpenCode and Claude Code are both tested.
 */
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('node:fs')
const os = require('node:os')

const lines = []
const log = (...args) => {
  lines.push(args.map(String).join(' '))
  writeFileSync('/tmp/opencode/agents-result.txt', lines.join('\n'))
}

app.setPath('userData', `${os.homedir()}/.config/klyro`)

require('../out/main/index.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function askThroughApp(main, providerId, fast) {
  return main.webContents.executeJavaScript(`(async () => {
    try {
      const catalogue = await window.klyro.providerModels('${providerId}')
      const model = catalogue.models?.[0]?.id ?? ''
      const settings = await window.klyro.getSettings()
      await window.klyro.updateSettings({
        activeProvider: '${providerId}',
        providers: {
          ...settings.providers,
          '${providerId}': { ...(settings.providers['${providerId}'] ?? {}), model }
        }
      })
      const conversation = await window.klyro.createConversation()
      const started = Date.now()
      await window.klyro.sendChat({
        conversationId: conversation.id,
        content: 'Name one thing a hammer is for. One short sentence.',
        useFastModel: ${fast}
      })
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const conv = await window.klyro.getConversation(conversation.id)
        const messages = conv?.conversation?.messages ?? []
        const last = messages[messages.length - 1]
        const text = String(last?.content ?? '')
        if (last && last.role !== 'user') {
          return JSON.stringify({ model, role: last.role, ms: Date.now() - started, text: text.slice(0, 160) })
        }
      }
      return JSON.stringify({ model, role: 'none', text: 'no answer within 40s' })
    } catch (error) {
      return 'ERR ' + error.message
    }
  })()`)
}

app.whenReady().then(async () => {
  await wait(6000)
  const windows = BrowserWindow.getAllWindows()
  const main = windows.find((win) => !win.webContents.getURL().includes('overlay')) ?? windows[0]

  // Start an OpenCode server the way the app does.
  const started = await main.webContents.executeJavaScript(
    `window.klyro.localAgentStartOpenCode().then((r) => JSON.stringify(r)).catch((e) => 'ERR ' + e.message)`
  )
  log('opencode started:', started)
  await wait(4000)

  // A cold server: the very first turn after it starts, which is the turn
  // that used to come back empty. Both paths are compared on it.
  log('opencode cold via app:', await askThroughApp(main, 'opencode', false))
  log('opencode cold via daemon:', await askThroughApp(main, 'opencode', true))
  // The same question twice: in the app (the old path) and in the daemon.
  log('opencode via app:', await askThroughApp(main, 'opencode', false))
  log('opencode via daemon:', await askThroughApp(main, 'opencode', true))
  log('claude-code via daemon:', await askThroughApp(main, 'claude-code', true))

  // The agent CLIs: are they installed?
  const clis = await main.webContents.executeJavaScript(
    `window.klyro.localAgentClis().then((c) => JSON.stringify(c.map((x) => ({ id: x.id, installed: x.installed })))).catch((e) => 'ERR ' + e.message)`
  )
  log('agent clis:', clis)

  app.exit(0)
})
