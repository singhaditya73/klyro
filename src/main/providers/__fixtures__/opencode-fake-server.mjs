// Test fixture: a minimal stand-in for `opencode serve` (v2 API shape).
//
// It implements the routes Klyro's OpenCode provider uses:
//   GET  /api/model                        → the model catalogue
//   POST /api/session                      → create a session
//   POST /api/session/{id}/model           → choose the model
//   POST /api/session/{id}/prompt          → queue a message
//   GET  /api/session/{id}/message         → read the answer back
//
// It answers the way the real server does, which is the point:
//   - the message list comes back newest first;
//   - the end of a turn is marked with an `idle` entry;
//   - one turn can be several messages (a progress line, a tool call, then
//     the answer), so reading the wrong end of the list loses the answer.
//
// The prompt decides the scenario:
//   'What is on this screen?' → one answer, written in two steps
//   'multi'                   → a progress line, then the answer, separately
//   'tool'                    → a tool call first, the answer after it
//   'silent'                  → the turn ends without a word
//   'broken'                  → the turn fails, with a reason
//
// A chosen model whose id contains 'silent', 'broken' or 'stalled' has the
// same effect, which is how the connect-time model probe is tested.
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

function assistant(id, content, created) {
  return {
    id,
    type: 'assistant',
    time: { created },
    agent: 'build',
    model: { id: 'test-model', providerID: 'openrouter' },
    content
  }
}

const server = createServer((request, response) => {
  void handle(request, response)
})

async function handle(request, response) {
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
    const body = await readBody(request)
    const session = sessions.get(sessionId)
    if (session) {
      session.model = {
        id: body.model?.id ?? 'test-model',
        providerID: body.model?.providerID ?? 'openrouter'
      }
    }
    json(response, 200, { data: session ?? {} })
    return
  }

  const promptMatch = path.match(/^\/api\/session\/([^/]+)\/prompt$/)
  if (promptMatch && request.method === 'POST') {
    const sessionId = promptMatch[1]
    const body = await readBody(request)
    const prompt = body.text ?? ''
    const files = Array.isArray(body.files) ? body.files : []
    const list = messages.get(sessionId) || []
    list.push({ id: 'msg_user', type: 'user', time: { created: Date.now() }, text: prompt, files })
    messages.set(sessionId, list)

    const chosen = sessions.get(sessionId)?.model?.id ?? ''
    if (chosen.includes('stalled')) {
      // The model never starts a turn: no assistant message, no idle. This is
      // what a signed-out provider looks like from the outside.
    } else if (chosen.includes('silent')) {
      setTimeout(() => {
        const current = messages.get(sessionId) || []
        current.push({ id: 'msg_idle', type: 'idle', outcome: 'succeeded', time: { created: Date.now() } })
        messages.set(sessionId, current)
      }, 300)
    } else if (chosen.includes('broken')) {
      setTimeout(() => {
        const current = messages.get(sessionId) || []
        current.push({
          id: 'msg_idle',
          type: 'idle',
          outcome: 'failed',
          error: { type: 'ProviderError', message: 'the model is not available' },
          time: { created: Date.now() }
        })
        messages.set(sessionId, current)
      }, 300)
    } else if (prompt.includes('multi')) {
      // A progress line, then the real answer, in a second message.
      setTimeout(() => {
        const current = messages.get(sessionId) || []
        current.push(assistant('msg_progress', [{ type: 'text', text: 'Looking. ' }], Date.now()))
        messages.set(sessionId, current)
      }, 300)
      setTimeout(() => {
        const current = messages.get(sessionId) || []
        current.push(assistant('msg_answer', [{ type: 'text', text: 'All done.' }], Date.now()))
        current.push({ id: 'msg_idle', type: 'idle', outcome: 'succeeded', time: { created: Date.now() } })
        messages.set(sessionId, current)
      }, 900)
    } else if (prompt.includes('tool')) {
      // A tool call first: a message with no text in it at all.
      setTimeout(() => {
        const current = messages.get(sessionId) || []
        current.push(
          assistant(
            'msg_tool',
            [
              { type: 'reasoning', text: 'I need a tool for this.' },
              { type: 'tool', tool: 'read', state: { status: 'completed' } }
            ],
            Date.now()
          )
        )
        messages.set(sessionId, current)
      }, 300)
      setTimeout(() => {
        const current = messages.get(sessionId) || []
        current.push(assistant('msg_answer', [{ type: 'text', text: 'Here is the answer.' }], Date.now()))
        current.push({ id: 'msg_idle', type: 'idle', outcome: 'succeeded', time: { created: Date.now() } })
        messages.set(sessionId, current)
      }, 900)
    } else if (prompt.includes('silent')) {
      // The turn ends without a word — the case that used to leave the user
      // staring at an empty bubble.
      setTimeout(() => {
        const current = messages.get(sessionId) || []
        current.push({ id: 'msg_idle', type: 'idle', outcome: 'succeeded', time: { created: Date.now() } })
        messages.set(sessionId, current)
      }, 300)
    } else if (prompt.includes('broken')) {
      // The turn fails, and the server says why.
      setTimeout(() => {
        const current = messages.get(sessionId) || []
        current.push({
          id: 'msg_idle',
          type: 'idle',
          outcome: 'failed',
          error: { type: 'ProviderError', message: 'the model is not available' },
          time: { created: Date.now() }
        })
        messages.set(sessionId, current)
      }, 300)
    } else {
      // The answer arrives a moment later, in two pieces. When the prompt
      // carried a picture, the answer says how many it got — that is what the
      // test for image delivery looks at.
      const seen = files.length > 0 ? `I can see ${files.length} image${files.length === 1 ? '' : 's'}. ` : ''
      setTimeout(() => {
        const current = messages.get(sessionId) || []
        current.push(assistant('msg_assistant', [{ type: 'text', text: `Klyro ${seen}` }], Date.now()))
        messages.set(sessionId, current)
      }, 300)
      setTimeout(() => {
        const current = messages.get(sessionId) || []
        const found = current.find((m) => m.id === 'msg_assistant')
        if (found) {
          found.content = [
            { type: 'text', text: 'Klyro ' },
            { type: 'text', text: 'works.' }
          ]
          found.time = { ...found.time, completed: Date.now() }
        }
        current.push({ id: 'msg_idle', type: 'idle', outcome: 'succeeded', time: { created: Date.now() } })
        messages.set(sessionId, current)
      }, 900)
    }

    json(response, 200, { data: { id: 'msg_user', sessionID: sessionId, type: 'user' } })
    return
  }

  const sessionMatch = path.match(/^\/api\/session\/([^/]+)$/)
  if (sessionMatch && request.method === 'DELETE') {
    sessions.delete(sessionMatch[1])
    messages.delete(sessionMatch[1])
    json(response, 200, { data: { id: sessionMatch[1] } })
    return
  }

  const messagesMatch = path.match(/^\/api\/session\/([^/]+)\/message$/)
  if (messagesMatch && request.method === 'GET') {
    // The real server lists a session newest first.
    const list = [...(messages.get(messagesMatch[1]) || [])].reverse()
    json(response, 200, { data: list, cursor: { previous: null, next: null } })
    return
  }

  json(response, 404, { _tag: 'NotFoundError', message: 'not found' })
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        resolve({ text: '' })
      }
    })
  })
}

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`opencode fixture listening on ${port}\n`)
})
