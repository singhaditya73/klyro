import { useRef, useEffect, useState } from 'react'
import type { Attachment, ChatMessage } from '@shared/types'
import { Mic, Monitor, X, Send, StopCircle, Loader2 } from 'lucide-react'

interface Props {
  busy: boolean
  onSend: (content: string, attachments: Attachment[]) => void | Promise<void>
  onStop: () => void
}

export function Composer({ busy, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sources, setSources] = useState<any[] | null>(null)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function submit(): Promise<void> {
    if (busy) return
    const content = text.trim()
    if (!content && attachments.length === 0) return
    await onSend(content, attachments)
    setText('')
    setAttachments([])
  }

  async function openSources(): Promise<void> {
    setError(null)
    try {
      setSources(await window.klyro.listCaptureSources())
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  async function chooseSource(id?: string): Promise<void> {
    setSources(null)
    try {
      const shot = await window.klyro.grabScreen(id)
      setAttachments((prev) => [
        ...prev,
        { kind: 'image', mime: 'image/png', dataUrl: shot.dataUrl, label: shot.name }
      ])
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  async function startRecording(): Promise<void> {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        chunksRef.current = []
        try {
          const result = await window.klyro.transcribe(await blob.arrayBuffer(), blob.type)
          setText((prev) => (prev ? `${prev} ${result.text}` : result.text))
        } catch (caught) {
          setError((caught as Error).message)
        }
      }
      recorder.start()
      recorderRef.current = recorder
      setRecording(true)
    } catch (caught) {
      setError(`Microphone unavailable: ${(caught as Error).message}`)
    }
  }

  function stopRecording(): void {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }

  return (
    <div className="composer">
      {attachments.length > 0 && (
        <div className="composer__attachments">
          {attachments.map((attachment, index) => (
            <div key={index} className="attachment-chip">
              <img src={attachment.dataUrl} alt={attachment.label ?? 'screen'} />
              <span>{attachment.label ?? 'screen'}</span>
              <button
                aria-label="Remove attachment"
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
              >
                <X className="icon icon--xs" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="composer__error">{error}</div>}

      <textarea
        className="composer__textarea"
        value={text}
        placeholder="Ask Klyro anything&hellip;   (Enter to send &middot; Shift+Enter for new line)"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
        }}
        rows={3}
      />

      <div className="composer__actions">
        <button className="btn" onClick={openSources} title="Share your screen" aria-label="Share screen">
          <Monitor className="icon icon--md" aria-hidden="true" />
        </button>
        <button
          className={`btn${recording ? ' btn--danger' : ''}`}
          onClick={() => recording ? stopRecording() : void startRecording()}
          title={recording ? 'Stop recording' : 'Voice input'}
          aria-label={recording ? 'Stop recording' : 'Voice input'}
        >
          {recording ? (
            <>
              <span className="icon icon--sm" style={{ animation: 'blink 1s infinite' }} aria-hidden="true">&#9679;</span>
              <span>Stop recording</span>
            </>
          ) : (
            <>
              <Mic className="icon icon--md" aria-hidden="true" />
              <span>Voice</span>
            </>
          )}
        </button>
        <div className="spacer" />
        {busy ? (
          <button className="btn btn--danger" onClick={onStop} aria-label="Stop generation">
            <StopCircle className="icon icon--sm" aria-hidden="true" />
            <span>Stop</span>
          </button>
        ) : (
          <button className="btn btn--primary" onClick={() => void submit()} disabled={!text.trim() && attachments.length === 0} aria-label="Send message">
            <Send className="icon icon--sm" aria-hidden="true" />
            <span>Send</span>
          </button>
        )}
      </div>

      {sources && (
        <div className="source-picker">
          <div className="source-picker__head">
            <strong>Choose what to share</strong>
            <button className="btn btn--ghost btn--sm" onClick={() => void chooseSource()}>Primary screen</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setSources(null)}>Cancel</button>
          </div>
          <div className="source-picker__grid">
            {sources.map((source) => (
              <button key={source.id} className="source-card" onClick={() => void chooseSource(source.id)}>
                <img src={source.thumbnail} alt={source.name} />
                <span>{source.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}