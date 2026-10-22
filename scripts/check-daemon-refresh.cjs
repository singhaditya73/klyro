/**
 * Live check: a daemon left over from another build is replaced on launch.
 *
 * The daemon outlives the app that started it, so after an update the old
 * process would keep owning the hot path and a Rust fix would never be used.
 * This boots the real, built app against a throwaway state directory whose
 * state file points at a fake daemon that reports an older version, and then
 * checks that the fake was stopped and the matching daemon took its place.
 *
 * Run after `npm run build`:
 *   npx electron --user-data-dir=/tmp/klyro-refresh-profile \
 *     scripts/check-daemon-refresh.cjs
 */
const { app } = require('electron')
const { spawn } = require('node:child_process')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const net = require('node:net')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const appVersion = require('../package.json').version
const stateDir = mkdtempSync(join(tmpdir(), 'klyro-daemon-refresh-'))
process.env.KLYRO_STATE_DIR = stateDir
const token = 'refresh-check-token'
const port = 43000 + Math.floor(Math.random() * 900)

const fakeDaemon = spawn(
  process.env.KLYRO_NODE || 'node',
  [
    '-e',
    `
    const net = require('node:net')
    const server = net.createServer((socket) => {
      socket.on('data', () => {
        socket.write(JSON.stringify({ kind: 'hello', version: '0.1.0', pid: process.pid }) + '\\n')
      })
    })
    server.listen(Number(process.env.PORT), '127.0.0.1')
    `.trim()
  ],
  { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' }
)

const statePath = join(stateDir, 'klyro-core.json')
writeFileSync(
  statePath,
  JSON.stringify({ port, token, pid: fakeDaemon.pid, version: '0.1.0' }),
  { mode: 0o600 }
)

const waitFor = async (predicate, timeoutMs) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

const fail = (message) => {
  console.error(`DAEMON REFRESH FAILED: ${message}`)
  try {
    fakeDaemon.kill()
  } catch {
    // Already gone.
  }
  app.exit(1)
}

const listening = () =>
  new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })

app.whenReady().then(async () => {
  // The fake must be listening before the app looks.
  let up = false
  for (let attempt = 0; attempt < 40 && !up; attempt += 1) {
    up = await listening()
    if (!up) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!up) return fail('the fake daemon did not start')

  // Boot the real app: it starts the daemon, which notices the old version.
  require('../out/main/index.js')

  const alive = () => {
    try {
      process.kill(fakeDaemon.pid, 0)
      return true
    } catch {
      return false
    }
  }
  const replaced = await waitFor(() => !alive(), 6000)
  if (!replaced) return fail('the old daemon was not stopped')

  const read = () => {
    try {
      return JSON.parse(readFileSync(statePath, 'utf8'))
    } catch {
      return null
    }
  }
  const current = await waitFor(() => {
    const state = read()
    return state && state.pid !== fakeDaemon.pid && state.version === appVersion
  }, 8000)
  if (!current) {
    const state = read()
    return fail(
      `the replacement daemon did not take over (state ${JSON.stringify(state)}, binary ${appVersion})`
    )
  }

  const state = read()
  const answers = await new Promise((resolve) => {
    const socket = net.connect(state.port, '127.0.0.1')
    let buffer = ''
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({ kind: 'auth', token: state.token })}\n`)
    })
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      if (buffer.includes('"hello"')) {
        socket.destroy()
        resolve(true)
      }
    })
    socket.once('error', () => resolve(false))
  })
  if (!answers) return fail('the replacement daemon did not answer')

  console.log(
    JSON.stringify(
      {
        verdict: 'replaced',
        oldVersion: '0.1.0',
        newVersion: state.version,
        oldPid: fakeDaemon.pid,
        newPid: state.pid,
        stateDir
      },
      null,
      2
    )
  )
  console.log('DAEMON REFRESH OK')
  app.exit(0)
})
