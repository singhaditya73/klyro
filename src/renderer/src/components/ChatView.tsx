import { useEffect, useRef } from 'react'
import type { Attachment, ChatMessage } from '@shared/types'
import { Composer } from './Composer'
import { MessageBubble, type MessageContext } from './MessageBubble'

interface Props {
  messages: ChatMessage[]
  streamingId: string | null
  contexts: Record<string, MessageContext>
  /** True when older messages exist above the loaded window. */
  hasMore?: boolean
  onLoadEarlier?: () => void | Promise<void>
  onSend: (content: string, attachments: Attachment[]) => void | Promise<void>
  onStop: () => void
}

export function ChatView({
  messages,
  streamingId,
  contexts,
  hasMore = false,
  onLoadEarlier,
  onSend,
  onStop
}: Props) {
  const endRef = useRef<HTMLDivElement | null>(null)
  const previous = useRef<{ first?: string; last?: string }>({})

  useEffect(() => {
    const first = messages[0]?.id
    const last = messages[messages.length - 1]?.id
    // Loading older messages changes the first id but not the last: scrolling to
    // the bottom then would yank the reader away from what they are reading.
    const grewAtFront =
      previous.current.first !== undefined && previous.current.first !== first && previous.current.last === last
    previous.current = { first, last }
    if (!grewAtFront) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  return (
    <section className="chat" aria-label="Conversation">
      <div className="chat__messages" role="log" aria-live="polite" aria-relevant="additions text">
        {hasMore ? (
          <div className="chat__earlier">
            <button className="btn btn--ghost" onClick={() => void onLoadEarlier?.()}>
              Load earlier messages
            </button>
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className="empty">
            <div className="empty__logo" aria-hidden="true" />
            <h1>Klyro</h1>
            <p>Your AI. Your entire computer.</p>
            <p className="muted">Ask a question, share your screen, or use your voice.</p>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} context={contexts[message.id]} />
          ))
        )}
        <div ref={endRef} />
      </div>
      <Composer busy={streamingId !== null} onSend={onSend} onStop={onStop} />
    </section>
  )
}
