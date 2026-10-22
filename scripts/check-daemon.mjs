/**
 * Drive the Rust daemon over its loopback socket: authenticate, configure a
 * provider, list its models, and ask a question.
 *
 * The daemon writes where it is listening, and the token to use, to
 * `$KLYRO_STATE_DIR/klyro-core.json` (or `~/.config/klyro`). This script
 * starts the daemon itself when nothing is answering, so it can be run on a
 * clean machine.
 *
 * Usage: node scripts/check-daemon.mjs [baseUrl] [model]
 *        node scripts/check-daemon.mjs --provider opencode --model qwen3
 */
import { connect } from 'node:net'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const stateDir = process.env.KLYRO_STATE_DIR ?? join(homedir(), '.config', 'klyro')
const statePath = join(stateDir, 'klyro-core.json')
const binary =
  process.env.KLYRO_CORE ??
  join(import.meta.dirname, '..', 'crates', 'klyro-core', 'target', 'release', 'klyro-core')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const provider = flag('provider', 'ollama')
const baseUrl =
  flag('baseUrl', args.find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:11434/v1')
const model = flag('model', args.find((arg) => !arg.startsWith('--') && !arg.startsWith('http')) ?? '')
const binaryPath = flag('binary', '')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Read the state file, starting the daemon first if nothing is answering. */
async function locate() {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (existsSync(statePath)) {
      try {
        const state = JSON.parse(readFileSync(statePath, 'utf8'))
        if (state.port && state.token) return state
      } catch {
        // A half-written file is rewritten by the daemon on its own.
      }
    }
    if (attempt === 0) {
      if (!existsSync(binary)) {
        console.error(`The daemon is not built: ${binary}`)
        console.error('Build it with: cargo build --release --manifest-path crates/klyro-core/Cargo.toml')
        process.exit(1)
      }
      mkdirSync(stateDir, { recursive: true })
      rmSync(statePath, { force: true })
      const child = spawn(binary, { stdio: 'ignore', detached: true })
      child.unref()
      console.log('started the daemon')
    }
    await wait(150)
  }
  console.error(`No daemon answered; expected its state in ${statePath}`)
  process.exit(1)
}

const state = await locate()
console.log('the daemon is on port', state.port)

const socket = connect({ host: '127.0.0.1', port: state.port })
let buffer = ''
const seen = []
let asked = false

socket.on('connect', () => {
  // The token is the first line, before anything else.
  socket.write(JSON.stringify({ kind: 'auth', token: state.token }) + '\n')
})

socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  let index = buffer.indexOf('\n')
  while (index !== -1) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim()) {
      const message = JSON.parse(line)
      seen.push(message)
      console.log('<-', JSON.stringify(message).slice(0, 220))
      if (message.kind === 'hello' || message.kind === 'ready') {
        // Configure the provider, then ask for its catalogue: without a model
        // named on the command line, the first one it serves is used.
        const configuration = {
          id: provider,
          base_url: baseUrl,
          model,
          api_key: null
        }
        socket.write(JSON.stringify({ kind: 'configure', providers: [configuration] }) + '\n')
        socket.write(JSON.stringify({ kind: 'models', provider }) + '\n')
      }
      if (message.kind === 'models' && !asked) {
        asked = true
        const chosen = model || message.models?.[0]?.id || ''
        if (!chosen) {
          console.log('the provider serves no models')
          socket.end()
          return
        }
        console.log('asking', provider, 'with', chosen)
        socket.write(
          JSON.stringify({
            kind: 'ask',
            provider,
            model: chosen,
            base_url: baseUrl,
            api_key: null,
            binary: binaryPath,
            prompt: 'Name one thing a hammer is for. One short sentence.'
          }) + '\n'
        )
      }
      if (message.kind === 'done' || message.kind === 'error') {
        socket.end()
      }
    }
    index = buffer.indexOf('\n')
  }
})

socket.on('error', (error) => {
  console.error('the daemon refused the connection:', error.message)
  process.exit(1)
})

socket.on('close', () => {
  const answer = seen
    .filter((message) => message.kind === 'delta')
    .map((message) => message.text)
    .join('')
  const models = seen.find((message) => message.kind === 'models')
  const failure = seen.find((message) => message.kind === 'error')
  console.log('\nmodels:', models ? models.models.length : 'none')
  console.log('answer:', answer || '(none)')
  if (failure) console.log('error:', failure.message)
  process.exit(answer && !failure ? 0 : 1)
})

setTimeout(() => {
  console.log('timed out')
  process.exit(1)
}, 120000)
