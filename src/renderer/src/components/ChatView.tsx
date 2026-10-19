import { useEffect, useRef, useState } from 'react'
import type { Attachment, ChatMessage } from '@shared/types'
import { Composer } from './Composer'
import { MessageBubble, type MessageContext } from './MessageBubble'
import { Check, ChevronUp, Square } from 'lucide-react'
import KlyroMark from '../assets/logo/klyro-mark.svg'

interface Props {
  messages: ChatMessage[]
  streamingId: string | null
  contexts: Record<string, MessageContext>
  hasMore?: boolean
  onLoadEarlier?: () => void | Promise<void>
  onSend: (content: string, attachments: Attachment[]) => void | Promise<void>
  onStop: () => void
  onNewChat: () => void | Promise<void>
  /** A tool call waiting for an explicit Allow / Deny. */
  pendingTool?: { callId: string; name: string; args: string } | null
  onRespondTool?: (approved: boolean) => void | Promise<void>
}

export function ChatView({
  messages,
  streamingId,
  contexts,
  hasMore = false,
  onLoadEarlier,
  onSend,
  onStop,
  onNewChat,
  pendingTool = null,
  onRespondTool
}: Props) {
  const endRef = useRef<HTMLDivElement | null>(null)
  const previous = useRef<{ first?: string; last?: string }>({})
  const [logoFailed, setLogoFailed] = useState(false)

  useEffect(() => {
    const first = messages[0]?.id
    const last = messages[messages.length - 1]?.id
    const grewAtFront =
      previous.current.first !== undefined && previous.current.first !== first && previous.current.last === last
    previous.current = { first, last }
    if (!grewAtFront) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  return (
    <section className="chat" aria-label="Conversation">
      <div className="chat__messages" role="log" aria-live="polite" aria-relevant="additions text">
        {hasMore && (
          <div className="chat__earlier">
            <button className="btn btn--ghost btn--sm" onClick={() => void onLoadEarlier?.()} aria-label="Load earlier messages">
              <ChevronUp className="icon icon--xs" aria-hidden="true" />
              <span>Load earlier messages</span>
            </button>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="empty-state">
            {logoFailed ? (
              <span className="empty-state__logo icon icon--xl" style={{ color: 'var(--text-muted)', width: 56, height: 56 }} aria-hidden="true">
                &#9679;
              </span>
            ) : (
              <img src={KlyroMark} alt="" className="empty-state__logo" aria-hidden="true" onError={() => setLogoFailed(true)} />
            )}
            <h1 className="empty-state__title">Klyro</h1>
            <p className="empty-state__text">Your AI workspace. Ask a question, share your screen, or use your voice.</p>
            <div className="empty-state__actions">
              <button className="btn btn--primary" onClick={() => void onNewChat()}>
                <span>New chat</span>
              </button>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} context={contexts[message.id]} />
          ))
        )}
        {streamingId && (
          <div className="message message--assistant message--streaming" style={{ maxWidth: '100%' }}>
            <div className="message__header">
              <span className="message__role">Klyro</span>
            </div>
            <div className="message__body">&nbsp;</div>
          </div>
        )}
        {pendingTool && onRespondTool && (
          <div className="tool-approval" role="alertdialog" aria-label="Tool call approval">
            <div className="tool-approval__title">
              <span className="tool-approval__icon" aria-hidden="true">🔧</span>
              <span>
                <strong>{pendingTool.name}</strong> wants to run on a connected MCP server
              </span>
            </div>
            {pendingTool.args.trim() && pendingTool.args.trim() !== '{}' ? (
              <pre className="tool-approval__args">{pendingTool.args}</pre>
            ) : null}
            <div className="tool-approval__actions">
              <button className="btn btn--ghost" onClick={() => void onRespondTool(false)}>
                <Square size={13} aria-hidden="true" />
                <span>Deny</span>
              </button>
              <button className="btn btn--primary" onClick={() => void onRespondTool(true)}>
                <Check size={13} aria-hidden="true" />
                <span>Allow</span>
              </button>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <Composer busy={streamingId !== null} onSend={onSend} onStop={onStop} />
    </section>
  )
}