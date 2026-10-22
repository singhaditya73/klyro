/**
 * A live check of an ephemeral session: ask a real question through the app,
 * then read every file Klyro could have written the answer to. The marker
 * strings must not be in any of them.
 */
const { app, BrowserWindow } = require('electron')
const { readFileSync, existsSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const lines = []
const log = (...args) => {
  lines.push(args.map(String).join(' '))
  writeFileSync('/tmp/opencode/ephemeral-check.txt', lines.join('\n'))
}

app.setPath('userData', `${os.homedir()}/.config/klyro`)
require('../out/main/index.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  await wait(6000)
  const wins = BrowserWindow.getAllWindows()
  const main = wins.find((win) => !win.webContents.getURL().includes('overlay')) ?? wins[0]
  const marker = `EPHEMERAL-${Date.now().toString(36).toUpperCase()}`

  const result = await main.webContents.executeJavaScript(`(async () => {
    const marker = ${JSON.stringify(marker)}
    try {
      const settings = await window.klyro.getSettings()
      const models = await window.klyro.providerModels('ollama').catch(() => ({ models: [] }))
      const model = models.models?.[0]?.id ?? 'jurisai:latest'
      await window.klyro.updateSettings({
        activeProvider: 'ollama',
        retentionDays: 0,
        interviewEphemeralDefault: true,
        overlayAnswerCache: true,
        memoryAutoExtract: true,
        providers: {
          ...settings.providers,
          ollama: { ...(settings.providers.ollama ?? {}), baseUrl: 'http://127.0.0.1:11434', model }
        }
      })

      const session = await window.klyro.interviewsStart({ company: marker + '-COMPANY', role: 'Engineer' })
      const conversation = await window.klyro.createConversation()
      const started = Date.now()
      await window.klyro.sendChat({
        conversationId: conversation.id,
        interviewId: session.id,
        content: marker + ' — name one thing a hammer is for.',
        useFastModel: true
      })

      let text = ''
      for (let attempt = 0; attempt < 90; attempt++) {
        await new Promise((r) => setTimeout(r, 1000))
        const conv = await window.klyro.getConversation(conversation.id)
        const messages = conv?.conversation?.messages ?? []
        const last = messages[messages.length - 1]
        if (last && last.role !== 'user' && String(last.content ?? '').trim()) {
          text = String(last.content)
          break
        }
      }

      // The answer must be recorded *in the session* (it is part of the answer
      // the user just saw) but not in any file.
      const listed = await window.klyro.interviewsList({})
      const summary = listed.find((entry) => entry.id === session.id)
      const detail = await window.klyro.interviewsGet(session.id)
      const history = await window.klyro.listConversations()
      return JSON.stringify({
        marker,
        model,
        ms: Date.now() - started,
        answer: text.slice(0, 160),
        ephemeral: summary?.ephemeral,
        listedEphemeral: Boolean(summary?.ephemeral),
        questions: detail?.questions?.length ?? 0,
        transcript: detail?.transcript?.length ?? 0,
        inConversationHistory: history.some((entry) => entry.id === conversation.id),
        conversationId: conversation.id
      })
    } catch (error) {
      return JSON.stringify({ marker, error: error.message })
    }
  })()`)
  log('run:', result)

  const parsed = JSON.parse(result)
  const dir = path.join(os.homedir(), '.config', 'klyro')
  for (const name of ['interviews.json', 'conversations.json', 'answer-cache.json', 'memory.json', 'audit.json', 'usage.json']) {
    const file = path.join(dir, name)
    if (!existsSync(file)) {
      log(`${name}: absent`)
      continue
    }
    const body = readFileSync(file, 'utf8')
    log(`${name}: ${body.includes(parsed.marker) ? 'CONTAINS THE MARKER' : 'clean'} (${body.length} bytes)`)
  }

  app.exit(0)
})
