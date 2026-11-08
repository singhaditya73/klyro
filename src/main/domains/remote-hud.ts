import * as http from 'node:http'
import { randomBytes } from 'node:crypto'
import * as os from 'node:os'
import { logger } from '../logger'

let server: http.Server | null = null
let port = 5892
/** Per-session secret: the HUD carries live meeting content over plain LAN HTTP. */
let sessionToken: string | null = null
const sseClients = new Set<http.ServerResponse>()

export interface RemoteHudState {
  transcript: string[]
  question: string
  answer: string
  isStreaming: boolean
  talkRatioPct?: number
}

const currentState: RemoteHudState = {
  transcript: [],
  question: '',
  answer: '',
  isStreaming: false
}

/** Get best non-internal LAN IPv4 address */
export function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

export function getRemoteHudUrl(): string {
  const base = `http://${getLocalIpAddress()}:${port}`
  return sessionToken ? `${base}/?t=${sessionToken}` : base
}

/** Broadcast event to all connected phones / tablets */
export function broadcastRemoteHud(event: { type: string; [key: string]: any }): void {
  if (event.type === 'delta') {
    currentState.answer += event.text || ''
    currentState.isStreaming = true
  } else if (event.type === 'start') {
    currentState.answer = ''
    currentState.question = event.question || currentState.question
    currentState.isStreaming = true
  } else if (event.type === 'done' || event.type === 'error') {
    currentState.isStreaming = false
  } else if (event.type === 'transcript') {
    currentState.transcript.push(event.line)
    if (currentState.transcript.length > 30) currentState.transcript.shift()
  } else if (event.type === 'question') {
    currentState.question = event.question
    currentState.answer = ''
  }

  const payload = `data: ${JSON.stringify(event)}\n\n`
  for (const client of sseClients) {
    try {
      client.write(payload)
    } catch {
      sseClients.delete(client)
    }
  }
}

/** Start the local HTTP HUD server. Resolves once the port is actually bound. */
export function startRemoteHudServer(customPort = 5892): Promise<{ url: string; port: number }> {
  if (server) return Promise.resolve({ url: getRemoteHudUrl(), port })
  port = customPort
  sessionToken = randomBytes(18).toString('hex')
  // A new session starts blank: the previous meeting's answer and transcript
  // must not appear on a phone that connects to this one.
  currentState.transcript = []
  currentState.question = ''
  currentState.answer = ''
  currentState.isStreaming = false

  return new Promise((resolve, reject) => {
    const next = http.createServer((req, res) => {
      const parsed = new URL(req.url || '/', 'http://localhost')

      if (parsed.pathname === '/events') {
        if (!authorized(parsed)) {
          res.writeHead(403, { 'Content-Type': 'text/plain' })
          res.end('Forbidden')
          return
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        })
        res.write(`data: ${JSON.stringify({ type: 'init', state: currentState })}\n\n`)
        sseClients.add(res)
        req.on('close', () => sseClients.delete(res))
        return
      }

      if (parsed.pathname === '/api/status') {
        if (!authorized(parsed)) {
          res.writeHead(403, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Forbidden' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, state: currentState }))
        return
      }

      // The page itself holds no data; every data route above requires the token.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(renderMobileHtml())
    })

    next.once('error', (err) => {
      if (server === next) server = null
      sessionToken = null
      logger.warn('Remote HUD server error:', err)
      reject(err)
    })

    next.listen(port, '0.0.0.0', () => {
      server = next
      logger.info(`Ghost Phone Remote HUD live at ${getRemoteHudUrl()}`)
      resolve({ url: getRemoteHudUrl(), port })
    })
  })
}

function authorized(url: URL): boolean {
  return sessionToken !== null && url.searchParams.get('t') === sessionToken
}

export function stopRemoteHudServer(): void {
  if (server) {
    for (const client of sseClients) {
      try {
        client.end()
      } catch {
        // Ignored
      }
    }
    sseClients.clear()
    server.close()
    server = null
  }
  sessionToken = null
}

export function isRemoteHudRunning(): boolean {
  return server !== null
}

function renderMobileHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Klyro · Ghost Phone HUD</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #050608;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 16px;
      padding-bottom: 40px;
      -webkit-font-smoothing: antialiased;
      line-height: 1.5;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 14px;
      border-bottom: 1px solid #1e293b;
      margin-bottom: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 16px;
      color: #38bdf8;
      letter-spacing: -0.3px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: 9999px;
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
      font-size: 11px;
      font-weight: 600;
    }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #64748b;
      margin-bottom: 8px;
    }
    .card {
      background: #0d1117;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 16px;
    }
    .question {
      font-size: 15px;
      font-weight: 600;
      color: #f1f5f9;
      margin-bottom: 10px;
    }
    .answer {
      font-size: 14px;
      color: #cbd5e1;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.6;
    }
    .answer code {
      background: #1e293b;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 13px;
      color: #38bdf8;
    }
    .transcript-box {
      max-height: 180px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 13px;
    }
    .transcript-line {
      padding: 4px 8px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.03);
      color: #94a3b8;
    }
    .transcript-line strong { color: #38bdf8; font-weight: 600; }
    .status-shimmer {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #38bdf8;
      margin-right: 6px;
      animation: pulse 1s infinite;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v20M2 12h20"/></svg>
      <span>KLYRO HUD</span>
    </div>
    <div class="badge" id="connStatus"><span class="dot"></span>LIVE REMOTE</div>
  </header>

  <div class="section-title">Active Response</div>
  <div class="card" id="answerCard">
    <div class="question" id="activeQuestion">Awaiting meeting question…</div>
    <div class="answer" id="activeAnswer">Listening in stealth mode. Answers and real-time meeting intelligence will stream here instantly.</div>
  </div>

  <div class="section-title">Live Transcript</div>
  <div class="card">
    <div class="transcript-box" id="transcriptBox">
      <div class="transcript-line" style="color: #64748b;">No speech detected yet. Dual loopback active.</div>
    </div>
  </div>

  <script>
    const questionEl = document.getElementById('activeQuestion');
    const answerEl = document.getElementById('activeAnswer');
    const transcriptEl = document.getElementById('transcriptBox');
    const connEl = document.getElementById('connStatus');

    function connectSSE() {
      const src = new EventSource('/events' + location.search);
      src.onopen = () => {
        connEl.innerHTML = '<span class="dot"></span>CONNECTED';
      };
      src.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'init') {
            if (data.state.question) questionEl.textContent = data.state.question;
            if (data.state.answer) answerEl.textContent = data.state.answer;
            if (data.state.transcript && data.state.transcript.length > 0) {
              renderTranscript(data.state.transcript);
            }
          } else if (data.type === 'start') {
            if (data.question) questionEl.textContent = data.question;
            answerEl.textContent = '';
          } else if (data.type === 'delta') {
            answerEl.textContent += data.text || '';
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          } else if (data.type === 'transcript') {
            appendTranscript(data.line);
          } else if (data.type === 'question') {
            questionEl.textContent = data.question;
            answerEl.textContent = '';
          }
        } catch (err) {}
      };
      src.onerror = () => {
        connEl.innerHTML = '<span class="dot" style="background:#ef4444"></span>RECONNECTING';
        src.close();
        setTimeout(connectSSE, 2500);
      };
    }

    function appendTranscript(line) {
      if (!line) return;
      const d = document.createElement('div');
      d.className = 'transcript-line';
      d.textContent = line;
      transcriptEl.appendChild(d);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    function renderTranscript(lines) {
      transcriptEl.innerHTML = '';
      lines.forEach(appendTranscript);
    }

    connectSSE();
  </script>
</body>
</html>`
}
