import type { ChatMessage } from '@shared/types'

export interface MessageContext {
  memories: number
  documents: number
}

export function MessageBubble({ message, context }: { message: ChatMessage; context?: MessageContext }) {
  return (
    <div className={`message message--${message.role}${message.error ? ' message--error' : ''}`}>
      <div className="message__role">
        {message.role === 'user' ? 'You' : 'Klyro'}
        {message.role === 'assistant' && message.model ? <span className="message__model"> · {message.model}</span> : null}
        {context && (context.memories > 0 || context.documents > 0) ? (
          <span className="message__context">
            {' '}
            · grounded in {context.memories} memor{context.memories === 1 ? 'y' : 'ies'}
            {context.documents > 0 ? ` + ${context.documents} document excerpt${context.documents === 1 ? '' : 's'}` : ''}
          </span>
        ) : null}
      </div>
      {message.attachments && message.attachments.length > 0 ? (
        <div className="message__attachments">
          {message.attachments.map((attachment, index) => (
            <img key={index} src={attachment.dataUrl} alt={attachment.label ?? 'attachment'} />
          ))}
        </div>
      ) : null}
      <div className="message__body">
        {message.content || (message.role === 'assistant' ? <span className="muted">…</span> : '')}
      </div>
    </div>
  )
}
