import { describe, expect, it } from 'vitest'
import { parseDataUrl, sseJson, trimSlash } from './http'

describe('trimSlash', () => {
  it('removes trailing slashes', () => {
    expect(trimSlash('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
    expect(trimSlash('http://localhost:11434')).toBe('http://localhost:11434')
  })
})

describe('parseDataUrl', () => {
  it('extracts mime type and base64 payload', () => {
    const parsed = parseDataUrl('data:image/png;base64,AAAA')
    expect(parsed.mime).toBe('image/png')
    expect(parsed.base64).toBe('AAAA')
  })

  it('falls back to a binary mime when absent', () => {
    expect(parseDataUrl('data:,raw').mime).toBe('application/octet-stream')
  })
})

describe('sseJson', () => {
  it('yields parsed JSON frames until the done sentinel', async () => {
    const body = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'
    const frames: any[] = []
    for await (const frame of sseJson(new Response(body))) frames.push(frame)
    expect(frames).toHaveLength(1)
    expect(frames[0].choices[0].delta.content).toBe('hi')
  })

  it('ignores non-JSON keepalive frames', async () => {
    const body = ': keepalive\ndata: not-json\ndata: {"ok":true}\n'
    const frames: any[] = []
    for await (const frame of sseJson(new Response(body))) frames.push(frame)
    expect(frames).toEqual([{ ok: true }])
  })
})
