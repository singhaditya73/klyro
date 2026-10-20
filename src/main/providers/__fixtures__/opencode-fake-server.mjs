// Test fixture: a minimal stand-in for `opencode serve` (v2 API shape).
//
// It implements the routes Klyro's OpenCode provider uses:
//   GET  /api/model                        → the model catalogue
//   POST /api/session                      → create a session
//   POST /api/session/{id}/model           → choose the model
//   POST /api/session/{id}/prompt          → queue a message
//   GET  /api/session/{id}/message         → read the answer back
import { createServer } from 'node:http'

const port = Number(process.env.PORT || 41877)
const password = process.env.OPENCODE_SERVER_PASSWORD || ''
const sessions = new Map()
const messages = new Map()

function json(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(payload)
}

const server = createServer((request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`)
  const path = url.pathname

  if (password) {
    const header = request.headers.authorization || ''
    const expected = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
    if (header !== expected) {
      json(response, 401, { _tag: 'UnauthorizedError', message: 'Authentication required' })
      return
    }
  }

  if (path === '/api/model') {
    json(response, 200, {
      location: { directory: '/tmp/klyro-test' },
      data: [
        {
          id: 'minimax/minimax-m3.1-flash:free',
          modelID: 'minimax/minimax-m3.1-flash:free',
          providerID: 'openrouter',
          name: 'MiniMax M3.1 Flash (free)',
          free: true
        },
        {
          id: 'deepseek/deepseek-v4.1-flash',
          modelID: 'deepseek/deepseek-v4.1-flash',
          providerID: 'openrouter',
          name: 'DeepSeek V4.1 Flash'
        }
      ]
    })
    return
  }

  if (path === '/api/session' && request.method === 'POST') {
    const id = `ses_${sessions.size + 1}`
    sessions.set(id, { id, title: 'Klyro' })
    messages.set(id, [])
    json(response, 200, { data: { id, title: 'Klyro' } })
    return
  }

  const modelMatch = path.match(/^\/api\/session\/([^/]+)\/model$/)
  if (modelMatch && request.method === 'POST') {
    const sessionId = modelMatch[1]
    const session = sessions.get(sessionId)
    if (session) session.model = { id: 'test-model', providerID: 'openrouter' }
    json(response, 200, { data: session ?? {} })
    return
  }

  const promptMatch = path.match(/^\/api\/session\/([^/]+)\/prompt$/)
  if (promptMatch && request.method === 'POST') {
    const sessionId = promptMatch[1]
    const list = messages.get(sessionId) || []
    list.push({ id: 'msg_user', type: 'user', time: { created: Date.now() }, text: 'question' })
    messages.set(sessionId, list)
    // The answer arrives a moment later, in two pieces.
    setTimeout(() => {
      const current = messages.get(sessionId) || []
      current.push({
        id: 'msg_assistant',
        type: 'assistant',
        time: { created: Date.now() },
        model: { id: 'test-model', providerID: 'openrouter' },
        content: [{ type: 'text', text: 'Klyro ' }]
      })
      messages.set(sessionId, current)
    }, 300)
    setTimeout(() => {
      const current = messages.get(sessionId) || []
      const assistant = current.find((m) => m.id === 'msg_assistant')
      if (assistant) {
        assistant.content = [
          { type: 'text', text: 'Klyro ' },
          { type: 'text', text: 'works.' }
        ]
        assistant.time = { ...assistant.time, completed: Date.now() }
      }
    }, 900)
    json(response, 200, { data: { id: 'msg_user', sessionID: sessionId, type: 'user' } })
    return
  }

  const messagesMatch = path.match(/^\/api\/session\/([^/]+)\/message$/)
  if (messagesMatch && request.method === 'GET') {
    json(response, 200, { data: messages.get(messagesMatch[1]) || [], cursor: { previous: null, next: null } })
    return
  }

  json(response, 404, { _tag: 'NotFoundError', message: 'not found' })
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`opencode fixture listening on ${port}\n`)
})
