import { randomUUID } from 'node:crypto'
import type { ChatMessage, Conversation, ConversationSummary } from '@shared/types'
import { JsonStore } from '../store/json-store'

interface ConversationsFile {
  conversations: Conversation[]
}

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

  list(): ConversationSummary[] {
    return [...this.store.get().conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(toSummary)
  }

  get(id: string): Conversation | null {
    return this.store.get().conversations.find((c) => c.id === id) ?? null
  }

  create(): Conversation {
    const now = Date.now()
    const conversation: Conversation = {
      id: randomUUID(),
      title: 'New chat',
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    this.store.update((draft) => {
      draft.conversations.unshift(conversation)
    })
    return conversation
  }

  addMessage(id: string, message: ChatMessage): Conversation | null {
    let updated: Conversation | null = null
    this.store.update((draft) => {
      const conversation = draft.conversations.find((c) => c.id === id)
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
    this.store.update((draft) => {
      const conversation = draft.conversations.find((c) => c.id === id)
      const message = conversation?.messages.find((m) => m.id === messageId)
      if (!conversation || !message) return
      Object.assign(message, patch)
      conversation.updatedAt = Date.now()
    })
  }

  rename(id: string, title: string): void {
    this.store.update((draft) => {
      const conversation = draft.conversations.find((c) => c.id === id)
      if (conversation) conversation.title = title.trim().slice(0, 120) || 'Untitled'
    })
  }

  remove(id: string): void {
    this.store.update((draft) => {
      draft.conversations = draft.conversations.filter((c) => c.id !== id)
    })
  }

  clear(): void {
    this.store.set({ conversations: [] })
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
