import { useRef, useState } from 'react'
import type { Attachment, CaptureSource } from '@shared/types'

interface Props {
  busy: boolean
  onSend: (content: string, attachments: Attachment[]) => void | Promise<void>
  onStop: () => void
}

export function Composer({ busy, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
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
      {attachments.length > 0 ? (
        <div className="composer__attachments">
          {attachments.map((attachment, index) => (
            <div key={index} className="chip">
              <img src={attachment.dataUrl} alt={attachment.label ?? 'screen'} />
              <span>{attachment.label ?? 'screen'}</span>
              <button
                aria-label="Remove attachment"
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <div className="composer__error">{error}</div> : null}

      <textarea
        value={text}
        placeholder="Ask Klyro anything…   (Enter to send · Shift+Enter for a new line)"
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
        <button className="btn" onClick={() => void openSources()} title="Share your screen">
          🖥️ Screen
        </button>
        <button
          className={`btn${recording ? ' btn--recording' : ''}`}
          onClick={() => (recording ? stopRecording() : void startRecording())}
          title="Voice input"
        >
          {recording ? '■ Stop recording' : '🎙️ Voice'}
        </button>
        <div className="spacer" />
        {busy ? (
          <button className="btn btn--stop" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button className="btn btn--primary" onClick={() => void submit()}>
            Send
          </button>
        )}
      </div>

      {sources ? (
        <div className="source-picker">
          <div className="source-picker__head">
            <strong>Choose what to share</strong>
            <button className="btn btn--ghost" onClick={() => void chooseSource()}>
              Primary screen
            </button>
            <button className="btn btn--ghost" onClick={() => setSources(null)}>
              Cancel
            </button>
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
      ) : null}
    </div>
  )
}
