/** Small HTTP/SSE helpers shared by provider adapters. */

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Yields raw lines from a streaming response body. */
export async function* rawLines(res: Response): AsyncGenerator<string> {
  const reader = res.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index: number
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      if (line) yield line
    }
  }
  const rest = buffer.replace(/\r$/, '')
  if (rest) yield rest
}

/** Yields the payload of each `data:` line from an SSE stream. */
export async function* sseData(res: Response): AsyncGenerator<string> {
  for await (const line of rawLines(res)) {
    if (line.startsWith(':')) continue
    if (line.startsWith('data:')) yield line.slice(5).trim()
  }
}

/** Yields parsed JSON objects from an SSE stream, stopping at `[DONE]`. */
export async function* sseJson(res: Response): AsyncGenerator<any> {
  for await (const data of sseData(res)) {
    if (data === '[DONE]') return
    try {
      yield JSON.parse(data)
    } catch {
      // ignore non-JSON keepalive frames
    }
  }
}

export async function errorText(res: Response): Promise<string> {
  try {
    const body = await res.text()
    return `${res.status} ${res.statusText}: ${body.slice(0, 600)}`
  } catch {
    return `${res.status} ${res.statusText}`
  }
}

export function parseDataUrl(dataUrl: string): { mime: string; base64: string } {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) return { mime: 'application/octet-stream', base64: '' }
  return { mime: match[1] || 'application/octet-stream', base64: match[3] ?? '' }
}
