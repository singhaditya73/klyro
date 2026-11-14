import * as http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import * as os from 'node:os'
import { logger } from '../logger'

/**
 * The Ghost Phone HUD.
 *
 * The phone and the laptop are on the same network, so the page must assume
 * someone else can reach it. Two rules follow from that:
 *
 * 1. The page itself carries no secret and no data. A URL that leaks (history,
 *    a screenshot, a shared link) reveals nothing.
 * 2. A device proves who it is once, with a short code shown on the laptop,
 *    and then presents a bearer token. The token never appears in a URL, so it
 *    cannot end up in a browser history or a proxy log.
 *
 * The pairing code lives for ten minutes and is used once. Pairing attempts
 * are rate-limited per address, so six digits cannot be brute-forced.
 */

let server: http.Server | null = null
let port = 5892
/** Loopback by default; only an explicit opt-in binds the LAN interface. */
let bindHost = '127.0.0.1'

const CODE_LIFETIME_MS = 10 * 60_000
const TOKEN_LIFETIME_MS = 12 * 60 * 60_000
const PAIR_ATTEMPT_LIMIT = 8
const PAIR_ATTEMPT_WINDOW_MS = 60_000

let pairingCode: string | null = null
let pairingExpiresAt = 0
/** Issued session tokens and their expiry. A phone keeps its own token. */
const sessions = new Map<string, number>()
/** Pairing attempts per remote address, reset every minute. */
const pairAttempts = new Map<string, { count: number; resetAt: number }>()

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

/** The address to type on the phone. Deliberately contains no token. */
export function getRemoteHudUrl(): string {
  const host = bindHost === '0.0.0.0' ? getLocalIpAddress() : '127.0.0.1'
  return `http://${host}:${port}`
}

function sixDigits(): string {
  // Uniform among 000000–999999; a code is guessable only 8 times a minute.
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0')
}

function issuePairingCode(): { code: string; expiresAt: number } {
  pairingCode = sixDigits()
  pairingExpiresAt = Date.now() + CODE_LIFETIME_MS
  return { code: pairingCode, expiresAt: pairingExpiresAt }
}

/**
 * What the laptop shows. If the code expired, a fresh one is issued here so
 * opening the panel again always gives the user something that works.
 */
export function getRemoteHudPairing(): { url: string; code: string; expiresAt: number } {
  if (!pairingCode || pairingExpiresAt <= Date.now()) issuePairingCode()
  return { url: getRemoteHudUrl(), code: pairingCode!, expiresAt: pairingExpiresAt }
}

/** Rotate the code without restarting the server (a second phone, or a leak). */
export function rotatePairingCode(): { code: string; expiresAt: number } {
  return issuePairingCode()
}

/**
 * The page is self-contained, so it needs no remote origins. `connect-src
 * 'self'` still allows the HUD's own fetch and event stream.
 */
function securityHeaders(): http.OutgoingHttpHeaders {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
  }
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
export function startRemoteHudServer(
  customPort = 5892,
  options: { lan?: boolean } = {}
): Promise<{ url: string; port: number; pairingCode: string; expiresAt: number }> {
  if (server) {
    const pairing = getRemoteHudPairing()
    return Promise.resolve({ url: pairing.url, port, pairingCode: pairing.code, expiresAt: pairing.expiresAt })
  }
  port = customPort
  bindHost = options.lan ? '0.0.0.0' : '127.0.0.1'
  sessions.clear()
  pairAttempts.clear()
  const pairing = issuePairingCode()
  // A new session starts blank: the previous meeting's answer and transcript
  // must not appear on a phone that connects to this one.
  currentState.transcript = []
  currentState.question = ''
  currentState.answer = ''
  currentState.isStreaming = false

  return new Promise((resolve, reject) => {
    const next = http.createServer((req, res) => {
      const parsed = new URL(req.url || '/', 'http://localhost')

      if (parsed.pathname === '/api/pair') {
        void pairDevice(req, res)
        return
      }

      if (parsed.pathname === '/events') {
        if (!authorized(req)) {
          res.writeHead(403, { 'Content-Type': 'text/plain', ...securityHeaders() })
          res.end('Forbidden')
          return
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          ...securityHeaders()
        })
        res.write(`data: ${JSON.stringify({ type: 'init', state: currentState })}\n\n`)
        sseClients.add(res)
        req.on('close', () => sseClients.delete(res))
        return
      }

      if (parsed.pathname === '/api/status') {
        if (!authorized(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json', ...securityHeaders() })
          res.end(JSON.stringify({ ok: false, error: 'Forbidden' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json', ...securityHeaders() })
        res.end(JSON.stringify({ ok: true, state: currentState }))
        return
      }

      // The page itself holds no data and no secret.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...securityHeaders() })
      res.end(renderMobileHtml())
    })

    next.once('error', (err) => {
      if (server === next) server = null
      logger.warn('Remote HUD server error:', err)
      reject(err)
    })

    next.listen(port, bindHost, () => {
      server = next
      // `listen(0)` asks the OS for a free port; record the one it chose.
      const address = next.address()
      if (address && typeof address === 'object') port = address.port
      const scope = bindHost === '0.0.0.0' ? 'local network' : 'loopback only'
      logger.info(`Ghost Phone Remote HUD live (${scope}) at ${getRemoteHudUrl()}`)
      resolve({ url: getRemoteHudUrl(), port, pairingCode: pairing.code, expiresAt: pairing.expiresAt })
    })
  })
}

/** Reads the bearer token from the header — never from the URL. */
function bearer(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization
  if (typeof header !== 'string') return null
  const match = /^Bearer ([0-9a-f]{48})$/.exec(header)
  return match ? match[1] : null
}

function authorized(req: http.IncomingMessage): boolean {
  const token = bearer(req)
  if (!token) return false
  const expiresAt = sessions.get(token)
  if (!expiresAt) return false
  if (expiresAt <= Date.now()) {
    sessions.delete(token)
    return false
  }
  return true
}

function rateLimited(remote: string): boolean {
  const now = Date.now()
  const entry = pairAttempts.get(remote)
  if (!entry || entry.resetAt <= now) {
    pairAttempts.set(remote, { count: 1, resetAt: now + PAIR_ATTEMPT_WINDOW_MS })
    return false
  }
  entry.count += 1
  return entry.count > PAIR_ATTEMPT_LIMIT
}

function sameCode(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** One POST, eight tries a minute, one success per code. */
async function pairDevice(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const remote = req.socket.remoteAddress ?? 'unknown'
  const refuse = (status: number, error: string): void => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...securityHeaders() })
    res.end(JSON.stringify({ ok: false, error }))
  }

  if (req.method !== 'POST') return refuse(405, 'Use POST.')
  if (rateLimited(remote)) return refuse(429, 'Too many attempts. Wait a minute and try again.')

  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 512) return refuse(413, 'Request too large.')
  }
  let supplied = ''
  try {
    const parsed = JSON.parse(body) as { code?: unknown }
    supplied = typeof parsed.code === 'string' ? parsed.code.trim() : ''
  } catch {
    return refuse(400, 'Expected {"code":"123456"}.')
  }

  if (!pairingCode || pairingExpiresAt <= Date.now()) return refuse(403, 'The pairing code expired. Show a new one.')
  if (!/^\d{6}$/.test(supplied) || !sameCode(supplied, pairingCode)) {
    return refuse(403, 'That code is not right.')
  }

  // One code, one device. A second phone needs a new code from the laptop.
  pairingCode = null
  pairingExpiresAt = 0
  const token = randomBytes(24).toString('hex')
  const expiresAt = Date.now() + TOKEN_LIFETIME_MS
  sessions.set(token, expiresAt)
  logger.info('Ghost Phone paired a device')
  res.writeHead(200, { 'Content-Type': 'application/json', ...securityHeaders() })
  res.end(JSON.stringify({ ok: true, token, expiresAt }))
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
  sessions.clear()
  pairAttempts.clear()
  pairingCode = null
  pairingExpiresAt = 0
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
    /* Pairing is the only thing on screen until the device is trusted. */
    .pair { display: none; }
    .pair input {
      width: 100%;
      margin: 10px 0;
      padding: 14px;
      border-radius: 10px;
      border: 1px solid #334155;
      background: #0b0f14;
      color: #f8fafc;
      font-size: 26px;
      letter-spacing: 10px;
      text-align: center;
      font-family: ui-monospace, monospace;
    }
    .pair button {
      width: 100%;
      padding: 13px;
      border: 0;
      border-radius: 10px;
      background: #38bdf8;
      color: #04121c;
      font-size: 15px;
      font-weight: 700;
    }
    .pair .err { color: #f87171; font-size: 13px; margin-top: 8px; min-height: 18px; }
    .hidden { display: none; }
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

  <div class="card pair" id="pairPanel">
    <div class="question">Pair this device</div>
    <div style="font-size: 13px; color: #94a3b8;">
      Enter the six-digit code shown on the laptop. It expires after ten minutes.
    </div>
    <form id="pairForm">
      <input id="pairCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="Pairing code">
      <button type="submit">Pair</button>
    </form>
    <div class="err" id="pairError" role="alert"></div>
  </div>

  <div id="live">
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
  </div>

  <script>
    var questionEl = document.getElementById('activeQuestion');
    var answerEl = document.getElementById('activeAnswer');
    var transcriptEl = document.getElementById('transcriptBox');
    var connEl = document.getElementById('connStatus');
    var pairPanel = document.getElementById('pairPanel');
    var pairForm = document.getElementById('pairForm');
    var pairCode = document.getElementById('pairCode');
    var pairError = document.getElementById('pairError');
    var live = document.getElementById('live');

    var TOKEN_KEY = 'klyro-hud-token';
    var token = sessionStorage.getItem(TOKEN_KEY) || '';

    // The QR carries the code in the fragment: it is never sent to the server,
    // and it is stripped from the address bar before the first paint.
    var hash = location.hash ? location.hash.slice(1) : '';
    var invite = '';
    if (hash.indexOf('p=') === 0) {
      invite = hash.slice(2);
      history.replaceState(null, '', location.pathname);
    }

    function showPairing(message) {
      live.className = 'hidden';
      pairPanel.className = 'card pair';
      pairPanel.style.display = 'block';
      pairError.textContent = message || '';
      pairCode.focus();
    }

    function showLive() {
      pairPanel.className = 'card pair hidden';
      pairPanel.style.display = 'none';
      live.className = '';
    }

    async function pair(code) {
      var res = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.token) throw new Error(data.error || 'Pairing failed.');
      token = data.token;
      sessionStorage.setItem(TOKEN_KEY, token);
    }

    function handleChunk(chunk) {
      var line = chunk.indexOf('data: ') === 0 ? chunk.slice(6) : null;
      if (!line) return;
      var data;
      try { data = JSON.parse(line); } catch (err) { return; }
      if (data.type === 'init') {
        if (data.state.question) questionEl.textContent = data.state.question;
        if (data.state.answer) answerEl.textContent = data.state.answer;
        if (data.state.transcript && data.state.transcript.length > 0) renderTranscript(data.state.transcript);
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
    }

    function appendTranscript(line) {
      if (!line) return;
      var d = document.createElement('div');
      d.className = 'transcript-line';
      d.textContent = line;
      transcriptEl.appendChild(d);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    function renderTranscript(lines) {
      transcriptEl.innerHTML = '';
      lines.forEach(appendTranscript);
    }

    // EventSource cannot send an Authorization header, so the stream is read
    // with fetch and the token stays in a header, never in a URL.
    async function connect() {
      if (!token) { showPairing(''); return; }
      try {
        var res = await fetch('/events', { headers: { authorization: 'Bearer ' + token } });
        if (res.status === 403 || res.status === 401) {
          token = '';
          sessionStorage.removeItem(TOKEN_KEY);
          showPairing('This device is not paired any more. Enter a new code.');
          return;
        }
        if (!res.ok || !res.body) throw new Error('stream failed');
        showLive();
        connEl.innerHTML = '<span class="dot"></span>CONNECTED';
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        for (;;) {
          var step = await reader.read();
          if (step.done) break;
          buffer += decoder.decode(step.value, { stream: true });
          var cut = buffer.indexOf(String.fromCharCode(10) + String.fromCharCode(10));
          while (cut >= 0) {
            var chunk = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            handleChunk(chunk);
            cut = buffer.indexOf(String.fromCharCode(10) + String.fromCharCode(10));
          }
        }
      } catch (err) {
        connEl.innerHTML = '<span class="dot" style="background:#ef4444"></span>RECONNECTING';
      }
      setTimeout(connect, 2500);
    }

    pairForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      pairError.textContent = '';
      try {
        await pair(pairCode.value.trim());
        pairCode.value = '';
        connect();
      } catch (err) {
        pairError.textContent = err.message || 'Pairing failed.';
      }
    });

    (async function start() {
      if (invite) {
        try {
          await pair(invite);
        } catch (err) {
          showPairing(err.message || 'The code is not right.');
          return;
        }
      }
      connect();
    })();
  </script>
</body>
</html>`
}
