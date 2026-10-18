import type { ChatMessage } from '@shared/types'

export function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`message message--${message.role}${message.error ? ' message--error' : ''}`}>
      <div className="message__role">
        {message.role === 'user' ? 'You' : 'Klyro'}
        {message.role === 'assistant' && message.model ? <span className="message__model"> · {message.model}</span> : null}
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
