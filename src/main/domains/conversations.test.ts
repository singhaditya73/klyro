import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * An ephemeral interview must not leave a conversation behind either: a title,
 * a preview or a single answer would defeat the point. The file is checked
 * directly.
 */

let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('../security/secrets', () => ({
  secrets: {
    get: () => null,
    set: () => undefined,
    remove: () => undefined,
    count: () => 0,
    setPlaintextPolicy: () => undefined
  }
}))

type Conversations = typeof import('./conversations')['conversations']
let conversations: Conversations

const text = (): string => {
  const file = join(userData, 'conversations.json')
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'klyro-conversations-'))
  conversations = (await import('./conversations')).conversations
})

describe('an ephemeral conversation', () => {
  it('stays out of the file, the history and search', () => {
    const conversation = conversations.create({ ephemeral: true })
    conversations.addMessage(conversation.id, {
      id: 'm1',
      role: 'user',
      content: 'a confidential question about the acquisition',
      createdAt: Date.now()
    })
    conversations.addMessage(conversation.id, {
      id: 'm2',
      role: 'assistant',
      content: 'a confidential answer',
      createdAt: Date.now()
    })

    expect(conversations.get(conversation.id)?.messages).toHaveLength(2)
    expect(conversations.list().some((entry) => entry.id === conversation.id)).toBe(false)
    expect(conversations.search('confidential')).toHaveLength(0)
    expect(text()).not.toContain('confidential')
  })

  it('can still be read while it lives', () => {
    const conversation = conversations.create({ ephemeral: true })
    conversations.addMessage(conversation.id, { id: 'm', role: 'user', content: 'hello', createdAt: Date.now() })
    const window = conversations.window(conversation.id)
    expect(window?.conversation.messages[0]?.content).toBe('hello')
  })

  it('takes an existing conversation off the disk when it is made ephemeral', () => {
    const conversation = conversations.create()
    conversations.addMessage(conversation.id, {
      id: 'm1',
      role: 'user',
      content: 'a question that was written down before',
      createdAt: Date.now()
    })
    expect(text()).toContain('written down before')

    conversations.makeEphemeral(conversation.id)

    expect(text()).not.toContain('written down before')
    expect(conversations.get(conversation.id)?.messages).toHaveLength(1)
    expect(conversations.list().some((entry) => entry.id === conversation.id)).toBe(false)
  })

  it('is forgotten when it falls outside the retention window', async () => {
    const settings = (await import('./settings')).settingsDomain
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T09:00:00Z'))
    const old = conversations.create()
    conversations.addMessage(old.id, {
      id: 'm',
      role: 'user',
      content: 'a chat from January',
      createdAt: Date.now()
    })

    vi.setSystemTime(new Date('2026-06-01T09:00:00Z'))
    const recent = conversations.create()

    settings.update({ retentionDays: 30 })
    expect(conversations.prune()).toBeGreaterThan(0)

    expect(conversations.get(old.id)).toBeNull()
    expect(conversations.get(recent.id)).not.toBeNull()
    expect(text()).not.toContain('a chat from January')

    vi.useRealTimers()
    settings.update({ retentionDays: 0 })
  })

  it('is gone after a clear, memory and disk alike', () => {
    const conversation = conversations.create({ ephemeral: true })
    conversations.clear()
    expect(conversations.get(conversation.id)).toBeNull()
    expect(conversations.ephemeralCount()).toBe(0)
  })
})
