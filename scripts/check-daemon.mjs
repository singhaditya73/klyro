/**
 * Drive the Rust daemon over its socket: say hello, list the models of a
 * local server, and ask a question.
 *
 * Usage: node scripts/check-daemon.mjs <socket> <baseUrl> [model]
 */
import { connect } from 'node:net'

const socketPath = process.argv[2] ?? '/home/aditya/.config/klyro/klyro-core.sock'
const baseUrl = process.argv[3] ?? 'http://127.0.0.1:11434/v1'
const model = process.argv[4] ?? 'jurisai:latest'

const socket = connect(socketPath)
let buffer = ''
const seen = []

socket.on('connect', () => {
  console.log('connected to', socketPath)
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
      if (message.kind === 'hello') {
        // Configure the provider, then ask.
        socket.write(
          JSON.stringify({
            kind: 'configure',
            providers: [{ id: 'ollama', base_url: baseUrl, model, api_key: null }]
          }) + '\n'
        )
        socket.write(JSON.stringify({ kind: 'models', provider: 'ollama' }) + '\n')
        socket.write(
          JSON.stringify({
            kind: 'ask',
            provider: 'ollama',
            model,
            base_url: baseUrl,
            api_key: null,
            prompt: 'Name one thing a hammer is for. One short sentence.'
          }) + '\n'
        )
      }
      if (message.kind === 'done') {
        socket.end()
      }
    }
    index = buffer.indexOf('\n')
  }
})

socket.on('close', () => {
  const answer = seen
    .filter((message) => message.kind === 'delta')
    .map((message) => message.text)
    .join('')
  const models = seen.find((message) => message.kind === 'models')
  console.log('\nmodels:', models ? models.models.length : 'none')
  console.log('answer:', answer || '(none)')
  process.exit(0)
})

setTimeout(() => {
  console.log('timed out')
  process.exit(1)
}, 120000)
