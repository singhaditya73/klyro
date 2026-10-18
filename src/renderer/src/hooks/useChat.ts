import { useCallback, useEffect, useRef, useState } from 'react'
import type { Attachment, ChatMessage, ConversationSummary } from '@shared/types'

export interface ChatController {
  summaries: ConversationSummary[]
  activeId: string | null
  messages: ChatMessage[]
  streamingId: string | null
  contexts: Record<string, { memories: number; documents: number }>
  search: string
  /** True when older messages exist above what is loaded. */
  hasMore: boolean
  setSearch: (value: string) => void
  openConversation: (id: string) => Promise<void>
  loadEarlier: () => Promise<void>
  newConversation: () => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  send: (content: string, attachments: Attachment[]) => Promise<void>
  stop: () => void
}

/** Messages loaded at a time; "Load earlier" grows the window. */
const PAGE = 80

export function useChat(): ChatController {
  const [summaries, setSummaries] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [contexts, setContexts] = useState<Record<string, { memories: number; documents: number }>>({})
  const [search, setSearch] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const activeIdRef = useRef<string | null>(null)
  // How much of the open conversation is loaded, so refreshes do not shrink it.
  const windowRef = useRef(PAGE)

  const refreshList = useCallback(async (query = ''): Promise<void> => {
    setSummaries(query ? await window.klyro.searchConversations(query) : await window.klyro.listConversations())
  }, [])

  const openConversation = useCallback(async (id: string): Promise<void> => {
    windowRef.current = PAGE
    const page = await window.klyro.getConversation(id, { limit: PAGE })
    if (!page) return
    activeIdRef.current = page.conversation.id
    setActiveId(page.conversation.id)
    setMessages(page.conversation.messages)
    setHasMore(page.hasMore)
  }, [])

  /** Pull in the next slice of older messages, keeping the ones already shown. */
  const loadEarlier = useCallback(async (): Promise<void> => {
    const id = activeIdRef.current
    if (!id) return
    windowRef.current += PAGE
    const page = await window.klyro.getConversation(id, { limit: windowRef.current })
    if (!page) return
    setMessages(page.conversation.messages)
    setHasMore(page.hasMore)
  }, [])

  const newConversation = useCallback(async (): Promise<void> => {
    const conversation = await window.klyro.createConversation()
    windowRef.current = PAGE
    activeIdRef.current = conversation.id
    setActiveId(conversation.id)
    setMessages([])
    setHasMore(false)
    await refreshList()
  }, [refreshList])

  const refreshActive = useCallback(async (): Promise<void> => {
    const id = activeIdRef.current
    if (!id) return
    const page = await window.klyro.getConversation(id, { limit: windowRef.current })
    if (!page) return
    setMessages(page.conversation.messages)
    setHasMore(page.hasMore)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await window.klyro.listConversations()
      if (cancelled) return
      if (list.length === 0) {
        const conversation = await window.klyro.createConversation()
        if (cancelled) return
        activeIdRef.current = conversation.id
        setActiveId(conversation.id)
        setSummaries(await window.klyro.listConversations())
      } else {
        setSummaries(list)
        await openConversation(list[0].id)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [openConversation])

  useEffect(() => {
    if (!search) {
      void refreshList()
      return
    }
    const timer = setTimeout(() => void refreshList(search), 200)
    return () => clearTimeout(timer)
  }, [search, refreshList])

  useEffect(() => {
    return window.klyro.onChatStream((event) => {
      switch (event.type) {
        case 'start':
          setStreamingId(event.messageId)
          setMessages((prev) =>
            prev.some((m) => m.id === event.messageId)
              ? prev
              : [
                  ...prev,
                  {
                    id: event.messageId,
                    role: 'assistant',
                    content: '',
                    createdAt: Date.now(),
                    model: event.model
                  }
                ]
          )
          break
        case 'context':
          setContexts((prev) => ({ ...prev, [event.messageId]: { memories: event.memories, documents: event.documents } }))
          break
        case 'delta':
          setMessages((prev) =>
            prev.map((m) => (m.id === event.messageId ? { ...m, content: m.content + event.text } : m))
          )
          break
        case 'done':
        case 'error':
          setStreamingId((current) => (current === event.messageId ? null : current))
          void refreshActive()
          void refreshList()
          break
      }
    })
  }, [refreshActive, refreshList])

  const send = useCallback(async (content: string, attachments: Attachment[]): Promise<void> => {
    let conversationId = activeIdRef.current
    if (!conversationId) {
      const conversation = await window.klyro.createConversation()
      conversationId = conversation.id
      activeIdRef.current = conversationId
      setActiveId(conversationId)
    }
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: 'user', content, attachments, createdAt: Date.now() }
    ])
    await window.klyro.sendChat({ conversationId, content, attachments })
  }, [])

  const stop = useCallback((): void => {
    void window.klyro.abortChat()
  }, [])

  const deleteConversation = useCallback(
    async (id: string): Promise<void> => {
      await window.klyro.deleteConversation(id)
      const list = await window.klyro.listConversations()
      setSummaries(list)
      if (activeIdRef.current === id) {
        if (list.length > 0) await openConversation(list[0].id)
        else await newConversation()
      }
    },
    [openConversation, newConversation]
  )

  return {
    summaries,
    activeId,
    messages,
    streamingId,
    contexts,
    search,
    hasMore,
    setSearch,
    openConversation,
    loadEarlier,
    newConversation,
    deleteConversation,
    send,
    stop
  }
}
