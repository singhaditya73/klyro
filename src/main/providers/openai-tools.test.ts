import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAICompatible } from './openai'

afterEach(() => {
  vi.unstubAllGlobals()
})

function sseResponse(frames: unknown[]): Response {
  const body = frames
    .map((frame) => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`)
    .join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const request = { captures: [] as Array<Record<string, unknown>> }
vi.stubGlobal(
  'fetch',
  vi.fn(async (_url: string, init?: RequestInit) => {
    request.captures.push(JSON.parse(String(init?.body)))
    return sseResponse([
      {
        choices: [
          {
            delta: {
              content: '',
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'github__search_issues', arguments: '{"query' } }
              ]
            }
          }
        ]
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: '":"parking lot"}' } }] },
            finish_reason: 'tool_calls'
          }
        ]
      }
    ])
  })
)

describe('chatWithTools', () => {
  it('streams text, reassembles tool-call fragments, and sends tools in the request', async () => {
    const generator = openAICompatible.chatWithTools
    const chunks = []
    for await (const chunk of generator!({
      model: 'llama-3.3-70b',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      turns: [
        { role: 'user', text: 'search the parking lot issues' },
        { role: 'assistant', text: '', toolCalls: [{ id: 'call_0', name: 'f', argsJson: '{}' }] },
        { role: 'tool', text: 'result', toolCallId: 'call_0' }
      ],
      tools: [{ name: 'github__search_issues', description: 'Search issues', parameters: { type: 'object', properties: {} } }]
    })) {
      chunks.push(chunk)
    }

    // The request includes the tool schema and the serialized tool turns.
    const body = request.captures[request.captures.length - 1]
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'github__search_issues', description: 'Search issues', parameters: { type: 'object', properties: {} } } }
    ])
    const messages = body.messages as Array<Record<string, unknown>>
    expect(messages[1]).toMatchObject({ role: 'assistant', tool_calls: [{ type: 'function', id: 'call_0' }] })
    expect(messages[2]).toEqual({ role: 'tool', tool_call_id: 'call_0', content: 'result' })

    // The stream produced no text and one resolved tool call with the args glued.
    expect(chunks).toEqual([
      { kind: 'tool_calls', calls: [{ id: 'call_1', name: 'github__search_issues', argsJson: '{"query":"parking lot"}' }] }
    ])
  })
})
