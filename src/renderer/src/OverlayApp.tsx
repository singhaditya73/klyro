import { useEffect, useState } from 'react'

export default function OverlayApp() {
  const [text, setText] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)

  useEffect(() => {
    return window.klyro.onChatStream((event) => {
      if (event.type === 'delta') setAnswer((prev) => prev + event.text)
      else if (event.type === 'done' || event.type === 'error') setBusy(false)
    })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void window.klyro.hideOverlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function submit(): Promise<void> {
    const content = text.trim()
    if (!content || busy) return
    let id = conversationId
    if (!id) {
      const conversation = await window.klyro.createConversation()
      id = conversation.id
      setConversationId(id)
    }
    setAnswer('')
    setBusy(true)
    setText('')
    await window.klyro.sendChat({ conversationId: id, content })
  }

  return (
    <div className="overlay">
      <div className="overlay__bar">
        <span className="overlay__brand">Klyro</span>
        <input
          autoFocus
          value={text}
          placeholder="Ask anything…"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        />
        {busy ? (
          <button className="btn btn--stop" onClick={() => void window.klyro.abortChat()}>
            Stop
          </button>
        ) : (
          <button className="btn btn--primary" onClick={() => void submit()}>
            Ask
          </button>
        )}
      </div>
      <div className="overlay__answer">
        {answer || (busy ? <span className="muted">…</span> : <span className="muted">Esc to close · Enter to ask</span>)}
      </div>
    </div>
  )
}
