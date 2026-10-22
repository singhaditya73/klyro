/**
 * A live check of an ephemeral session, in two shapes:
 *
 * 1. A conversation created for the session (it moves into memory).
 * 2. A conversation that already holds history (the session gets a stand-in;
 *    the history stays on disk).
 *
 * Afterwards every file Klyro could have written the answer to is read, and the
 * marker strings must be exactly where they belong.
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
  const stamp = Date.now().toString(36).toUpperCase()
  const fresh = `EPHEMERAL-${stamp}`
  const earlier = `EARLIER-${stamp}`
  const borrowed = `EPHEMERAL-BORROWED-${stamp}`

  const result = await main.webContents.executeJavaScript(`(async () => {
    const fresh = ${JSON.stringify(fresh)}
    const earlier = ${JSON.stringify(earlier)}
    const borrowed = ${JSON.stringify(borrowed)}
    const ask = async (conversationId, content, interviewId) => {
      const started = Date.now()
      await window.klyro.sendChat({ conversationId, content, interviewId, useFastModel: true })
      let text = ''
      for (let attempt = 0; attempt < 90; attempt++) {
        await new Promise((r) => setTimeout(r, 1000))
        const conv = await window.klyro.getConversation(conversationId)
        const messages = conv?.conversation?.messages ?? []
        const last = messages[messages.length - 1]
        if (last && last.role !== 'user' && String(last.content ?? '').trim()) {
          text = String(last.content)
          break
        }
      }
      return { ms: Date.now() - started, answer: text.slice(0, 120) }
    }

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

      // 1. A conversation that exists only for this session.
      const session = await window.klyro.interviewsStart({ company: fresh + '-COMPANY', role: 'Engineer' })
      const own = await window.klyro.createConversation()
      const first = await ask(own.id, fresh + ' — name one thing a hammer is for.', session.id)
      const ownedSummary = (await window.klyro.interviewsList({})).find((entry) => entry.id === session.id)
      const ownedDetail = await window.klyro.interviewsGet(session.id)
      const historyBefore = await window.klyro.listConversations()

      // 2. A conversation that already has history, borrowed for a session.
      const old = await window.klyro.createConversation()
      const oldAnswer = await ask(old.id, earlier + ' — say one word.')
      const session2 = await window.klyro.interviewsStart({ company: borrowed + '-COMPANY' })
      const second = await ask(old.id, borrowed + ' — name one thing a hammer is for.', session2.id)
      const borrowedSummary = (await window.klyro.interviewsList({})).find((entry) => entry.id === session2.id)
      const history = await window.klyro.listConversations()
      // The one conversation this check legitimately wrote down is its own;
      // put the user's history back the way it was found.
      await window.klyro.deleteConversation(old.id)

      return JSON.stringify({
        fresh,
        earlier,
        borrowed,
        model,
        first,
        second,
        oldAnswer,
        ownedEphemeral: ownedSummary?.ephemeral,
        ownedQuestions: ownedDetail?.questions?.length ?? 0,
        ownedTranscript: ownedDetail?.transcript?.length ?? 0,
        ownedInHistory: historyBefore.some((entry) => entry.id === own.id),
        oldConversationId: old.id,
        borrowedEphemeral: borrowedSummary?.ephemeral,
        borrowedInHistory: history.some((entry) => entry.id === old.id)
      })
    } catch (error) {
      return JSON.stringify({ stamp, error: error.message })
    }
  })()`)
  log('run:', result)

  const parsed = JSON.parse(result)
  const dir = path.join(os.homedir(), '.config', 'klyro')
  for (const name of ['interviews.json', 'conversations.json', 'answer-cache.json', 'memory.json', 'audit.json']) {
    const file = path.join(dir, name)
    if (!existsSync(file)) {
      log(`${name}: absent`)
      continue
    }
    const body = readFileSync(file, 'utf8')
    const leaked = body.includes(parsed.fresh) || body.includes(parsed.borrowed)
    if (name === 'conversations.json') {
      log(`${name}: ${leaked ? 'LEAKED THE SESSION' : 'no session text'} · earlier history ${body.includes(parsed.earlier) ? 'kept' : 'MISSING'}`)
    } else {
      log(`${name}: ${leaked ? 'LEAKED THE SESSION' : 'no session text'}`)
    }
  }

  app.exit(0)
})
