import { randomUUID } from 'node:crypto'
import type { ChatMessage, Conversation, ConversationQuery, ConversationSummary, ConversationWindow } from '@shared/types'
import { JsonStore } from '../store/json-store'
import { configuredCutoff } from './retention'

interface ConversationsFile {
  conversations: Conversation[]
}

/** How much of a conversation is sent to the renderer in one go. */
export const CONVERSATION_PAGE = 80

function toSummary(conversation: Conversation): ConversationSummary {
  const last = conversation.messages[conversation.messages.length - 1]
  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    preview: (last?.content ?? '').replace(/\s+/g, ' ').slice(0, 80)
  }
}

class ConversationsDomain {
  private readonly store = new JsonStore<ConversationsFile>('conversations.json', { conversations: [] })

  /**
   * Conversations that must never be written down.
   *
   * They are held for the length of the process and are absent from the
   * history list and from search: a session that is not kept should not leave
   * a title, a preview or a single word behind.
   */
  private readonly live = new Map<string, Conversation>()

  /**
   * A live conversation that stands in for a stored one.
   *
   * The overlay keeps one conversation for as long as its window exists, and an
   * interview can begin part-way through it. When that happens the earlier
   * messages are not the session's to destroy: the session gets a stand-in in
   * memory that answers to the same id from then on, and the stored
   * conversation is left untouched.
   */
  private readonly standIns = new Map<string, string>()

  /** Where an id really lives, once a stand-in has taken it over. */
  private resolve(id: string): string {
    return this.standIns.get(id) ?? id
  }

  list(): ConversationSummary[] {
    return [...this.store.get().conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(toSummary)
  }

  get(id: string): Conversation | null {
    const real = this.resolve(id)
    return this.live.get(real) ?? this.store.get().conversations.find((c) => c.id === real) ?? null
  }

  /** How many conversations are held in memory only. */
  ephemeralCount(): number {
    return this.live.size
  }

  /**
   * Move a conversation out of the file and into memory.
   *
   * This is what makes an existing conversation safe when the user turns a
   * session ephemeral: what was already written is removed, and from then on
   * it lives only here.
   */
  makeEphemeral(id: string): Conversation | null {
    const real = this.resolve(id)
    const stored = this.store.get().conversations.find((c) => c.id === real)
    if (!stored) return this.live.get(real) ?? null
    this.live.set(real, stored)
    this.store.update((draft) => {
      draft.conversations = draft.conversations.filter((c) => c.id !== real)
    })
    return stored
  }

  /**
   * The conversation an ephemeral session writes to.
   *
   * - Already in memory: that one.
   * - On disk but empty: it moves into memory, keeping its id.
   * - On disk with history: a stand-in takes over, and the history stays where
   *   it is. Destroying earlier, unrelated messages is not what the user asked
   *   for when they asked not to keep *this* session.
   */
  forEphemeral(id: string): Conversation {
    const existingStandIn = this.standIns.get(id)
    if (existingStandIn) return this.live.get(existingStandIn) as Conversation
    const live = this.live.get(id)
    if (live) return live
    const stored = this.store.get().conversations.find((c) => c.id === id)
    if (!stored) return this.create({ ephemeral: true })
    if (stored.messages.length === 0) return this.makeEphemeral(id) ?? stored

    const now = Date.now()
    const standIn: Conversation = { id: randomUUID(), title: 'New chat', createdAt: now, updatedAt: now, messages: [] }
    this.live.set(standIn.id, standIn)
    this.standIns.set(id, standIn.id)
    return standIn
  }

  /**
   * The newest `limit` messages of a conversation. Paging from the end means the
   * window never drifts when new messages arrive while the user is reading.
   */
  window(id: string, query: ConversationQuery = {}): ConversationWindow | null {
    const conversation = this.get(id)
    if (!conversation) return null

    const requested = Math.floor(query.limit ?? CONVERSATION_PAGE)
    const limit = Math.min(Math.max(requested, 1), 1000)
    const total = conversation.messages.length
    const messages = total > limit ? conversation.messages.slice(total - limit) : conversation.messages

    return {
      conversation: { ...conversation, messages },
      totalMessages: total,
      hasMore: total > messages.length
    }
  }

  create(options: { ephemeral?: boolean } = {}): Conversation {
    const now = Date.now()
    const conversation: Conversation = {
      id: randomUUID(),
      title: 'New chat',
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    if (options.ephemeral) {
      this.live.set(conversation.id, conversation)
      return conversation
    }
    this.store.update((draft) => {
      draft.conversations.unshift(conversation)
    })
    return conversation
  }

  addMessage(id: string, message: ChatMessage): Conversation | null {
    const real = this.resolve(id)
    const live = this.live.get(real)
    if (live) {
      live.messages.push(message)
      live.updatedAt = message.createdAt
      if (live.title === 'New chat' && message.role === 'user' && message.content.trim()) {
        live.title = message.content.trim().slice(0, 60)
      }
      return live
    }

    let updated: Conversation | null = null
    this.store.update((draft) => {
      const conversation = draft.conversations.find((c) => c.id === real)
      if (!conversation) return
      conversation.messages.push(message)
      conversation.updatedAt = message.createdAt
      if (conversation.title === 'New chat' && message.role === 'user' && message.content.trim()) {
        conversation.title = message.content.trim().slice(0, 60)
      }
      updated = conversation
    })
    return updated
  }

  updateMessage(id: string, messageId: string, patch: Partial<ChatMessage>): void {
    const real = this.resolve(id)
    const live = this.live.get(real)
    if (live) {
      const message = live.messages.find((m) => m.id === messageId)
      if (!message) return
      Object.assign(message, patch)
      live.updatedAt = Date.now()
      return
    }
    this.store.update((draft) => {
      const conversation = draft.conversations.find((c) => c.id === real)
      const message = conversation?.messages.find((m) => m.id === messageId)
      if (!conversation || !message) return
      Object.assign(message, patch)
      conversation.updatedAt = Date.now()
    })
  }

  rename(id: string, title: string): void {
    const real = this.resolve(id)
    const live = this.live.get(real)
    if (live) {
      live.title = title.trim().slice(0, 120) || 'Untitled'
      return
    }
    this.store.update((draft) => {
      const conversation = draft.conversations.find((c) => c.id === real)
      if (conversation) conversation.title = title.trim().slice(0, 120) || 'Untitled'
    })
  }

  remove(id: string): void {
    const real = this.resolve(id)
    this.standIns.delete(id)
    this.live.delete(real)
    this.store.update((draft) => {
      draft.conversations = draft.conversations.filter((c) => c.id !== real)
    })
  }

  clear(): void {
    this.live.clear()
    this.standIns.clear()
    this.store.set({ conversations: [] })
  }

  /**
   * Delete the conversations that have not been touched within the policy.
   * Returns how many were deleted.
   */
  prune(now = Date.now()): number {
    const cutoff = configuredCutoff(now)
    if (cutoff === null) return 0
    let removed = 0
    this.store.update((draft) => {
      const kept = draft.conversations.filter((conversation) => conversation.updatedAt >= cutoff)
      removed = draft.conversations.length - kept.length
      draft.conversations = kept
    })
    return removed
  }

  search(query: string): ConversationSummary[] {
    const needle = query.trim().toLowerCase()
    if (!needle) return this.list()
    return this.store
      .get()
      .conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(needle) ||
          c.messages.some((m) => m.content.toLowerCase().includes(needle))
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toSummary)
  }
}

export const conversations = new ConversationsDomain()
