import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The chat error path is where provider failures reach the user, so it is worth
 * testing end-to-end: a stalled stream must not be reported as a cancellation,
 * and a missing key must be explained instead of becoming a 401.
 */

const userData = mkdtempSync(join(tmpdir(), 'klyro-chat-'))

const h = vi.hoisted(() => ({
  events: [] as { channel: string; payload: any }[],
  chat: null as null | ((options: any) => AsyncGenerator<string>),
  apiKey: 'test-key' as string | null,
  settings: {} as any
}))

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload: unknown) => h.events.push({ channel, payload }) }
      }
    ]
  }
}))

vi.mock('../providers', () => ({
  getProvider: () => ({
    id: 'openai',
    chat: (options: any) => h.chat!(options)
  })
}))

vi.mock('./context', () => ({
  buildKnowledgeContext: () => ({ block: '', memories: 0, documents: 0 })
}))

vi.mock('./memory', () => ({
  memory: { extractFromExchange: async () => [] }
}))

vi.mock('./settings', () => ({
  settingsDomain: { get: () => h.settings, apiKey: () => h.apiKey }
}))

const { sendChat, abortChat } = await import('./chat')
const { conversations } = await import('./conversations')

/** A stall-shaped provider: aborting the request rejects the pending read. */
function stalling(): (options: any) => AsyncGenerator<string> {
  return (options) =>
    (async function* () {
      yield 'partial answer'
      await new Promise((_resolve, reject) => {
        const fail = (): void => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        // `fetch` rejects immediately when handed an already-aborted signal.
        if (options.signal?.aborted) return fail()
        options.signal?.addEventListener('abort', fail)
      })
    })()
}

function types(): string[] {
  return h.events.map((event) => event.payload.type)
}

function lastMessage(conversationId: string): { content: string; error?: boolean } {
  return conversations.get(conversationId)!.messages.at(-1) as { content: string; error?: boolean }
}

beforeEach(() => {
  h.events.length = 0
  h.chat = null
  h.apiKey = 'test-key'
  h.settings = {
    activeProvider: 'openai',
    providers: { openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' } },
    systemPrompt: 'You are Klyro.',
    responseStyle: 'balanced',
    memoryAutoExtract: false
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('sendChat', () => {
  it('streams deltas and stores the finished answer', async () => {
    h.chat = async function* () {
      yield 'Hel'
      yield 'lo'
    }
    const conversation = conversations.create()
    await sendChat({ conversationId: conversation.id, content: 'hi' })

    expect(conversations.get(conversation.id)!.messages.at(-1)!.content).toBe('Hello')
    expect(types()).toEqual(['start', 'delta', 'delta', 'done'])
  })

  it('reports a stalled provider as a timeout, not a cancellation', async () => {
    vi.useFakeTimers()
    h.chat = stalling()
    const conversation = conversations.create()

    const pending = sendChat({ conversationId: conversation.id, content: 'hi' })
    await vi.advanceTimersByTimeAsync(90_000)
    await pending

    const error = h.events.find((event) => event.payload.type === 'error')?.payload
    expect(error?.message).toMatch(/stopped responding/)
    expect(types()).not.toContain('done')
    // The partial answer is kept, with the reason appended.
    const stored = conversations.get(conversation.id)!.messages.at(-1)!
    expect(stored.content).toContain('partial answer')
    expect(stored.content).toMatch(/stopped responding/)
    expect(stored.error).toBe(true)
  })

  it('explains a missing API key without calling the provider', async () => {
    h.apiKey = null
    h.chat = () => {
      throw new Error('the provider should not have been called')
    }
    const conversation = conversations.create()
    await sendChat({ conversationId: conversation.id, content: 'hi' })

    const error = h.events.find((event) => event.payload.type === 'error')?.payload
    expect(error?.message).toMatch(/needs an API key/)
    expect(error?.message).toMatch(/Settings/)
    expect(lastMessage(conversation.id).error).toBe(true)
  })

  it('treats a user stop as a cancellation', async () => {
    h.chat = stalling()
    const conversation = conversations.create()

    const pending = sendChat({ conversationId: conversation.id, content: 'hi' })
    await vi.waitFor(() => expect(types()).toContain('start'))
    abortChat()
    await pending

    expect(types()).toContain('done')
    expect(types()).not.toContain('error')
  })

  it('surfaces a classified provider failure with advice', async () => {
    h.chat = function () {
      return (async function* () {
        const { ProviderError } = await import('../providers/errors')
        throw new ProviderError('OpenAI is rate limiting requests right now. Wait a few seconds and try again.', {
          kind: 'rate_limit'
        })
      })()
    }
    const conversation = conversations.create()
    await sendChat({ conversationId: conversation.id, content: 'hi' })

    const error = h.events.find((event) => event.payload.type === 'error')?.payload
    expect(error?.message).toMatch(/rate limiting/)
    expect(lastMessage(conversation.id).content).toMatch(/rate limiting/)
  })
})
