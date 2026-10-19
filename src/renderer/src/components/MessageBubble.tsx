import type { ChatMessage } from '@shared/types'
import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { formatClock } from '../lib/format'

export interface MessageContext {
  memories: number
  documents: number
}

export function MessageBubble({ message, context }: { message: ChatMessage; context?: MessageContext }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`message message--${message.role}${message.error ? ' message--error' : ''}`}>
      <div className="message__header">
        <span className="message__role">{message.role === 'user' ? 'You' : 'Klyro'}</span>
        <time className="message__model" dateTime={new Date(message.createdAt).toISOString()}>{formatClock(message.createdAt)}</time>
        {message.role === 'assistant' && message.model && (
          <span className="message__model">&#183; {message.model}</span>
        )}
        {context && (context.memories > 0 || context.documents > 0) && (
          <span className="message__context">
            {' '}
            &#183; grounded in {context.memories} memor{context.memories === 1 ? 'y' : 'ies'}
            {context.documents > 0 ? ` + ${context.documents} document excerpt${context.documents === 1 ? '' : 's'}` : ''}
          </span>
        )}
        {!message.error && message.content && (
          <button
            className="btn btn--icon btn--icon-sm btn--ghost message__copy"
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy message'}
            title={copied ? 'Copied' : 'Copy'}
          >
            {copied ? <Check className="icon icon--xs" style={{ color: 'var(--success)' }} aria-hidden="true" /> : <Copy className="icon icon--xs" aria-hidden="true" />}
          </button>
        )}
      </div>
      {message.attachments && message.attachments.length > 0 && (
        <div className="message__attachments">
          {message.attachments.map((attachment, index) => (
            <img key={index} src={attachment.dataUrl} alt={attachment.label ?? 'attachment'} />
          ))}
        </div>
      )}
      <div className="message__body message__body--md">
        {message.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        ) : message.role === 'assistant' ? (
          <span className="muted">&#8230;</span>
        ) : (
          ''
        )}
      </div>
    </div>
  )
}