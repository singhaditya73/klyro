import { useEffect, useRef } from 'react'
import type { Attachment, ChatMessage } from '@shared/types'
import { Composer } from './Composer'
import { MessageBubble, type MessageContext } from './MessageBubble'

interface Props {
  messages: ChatMessage[]
  streamingId: string | null
  contexts: Record<string, MessageContext>
  onSend: (content: string, attachments: Attachment[]) => void | Promise<void>
  onStop: () => void
}

export function ChatView({ messages, streamingId, contexts, onSend, onStop }: Props) {
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  return (
    <section className="chat" aria-label="Conversation">
      <div className="chat__messages" role="log" aria-live="polite" aria-relevant="additions text">
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
