import { useEffect, useRef, useState } from 'react'
import type { Attachment } from '@shared/types'
import { Loader2, Mic, Monitor, X, Send, StopCircle } from 'lucide-react'

interface Props {
  busy: boolean
  onSend: (content: string, attachments: Attachment[]) => void | Promise<void>
  onStop: () => void
  /** `hero` = borderless variant embedded in larger pages (Home). */
  variant?: 'inline' | 'hero'
  /** Open the screen-source picker as soon as the composer mounts. */
  captureArmed?: boolean
  /** Called once the armed capture has been handled (picker opened). */
  onCaptureHandled?: () => void
}

export function Composer({
  busy,
  onSend,
  onStop,
  variant = 'inline',
  captureArmed = false,
  onCaptureHandled
}: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sources, setSources] = useState<any[] | null>(null)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  /** Grow the input with its content, up to the CSS max-height. */
  function resizeTextarea(): void {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }

  useEffect(() => {
    resizeTextarea()
  }, [text])

  // "Ask about my screen" opens chat with the picker ready.
  useEffect(() => {
    if (!captureArmed) return
    onCaptureHandled?.()
    void openSources()
  }, [captureArmed, onCaptureHandled])

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
    setCapturing(true)
    try {
      // Instant capture (the default): one click captures what is below the
      // overlay — no picker, no extra question. With it off, the user picks
      // which screen or window to share.
      const settings = await window.klyro.getSettings()
      if (settings?.screenAutoCapture !== false) {
        const shot = await window.klyro.grabScreen()
        setAttachments((prev) => [
          ...prev,
          { kind: 'image', mime: 'image/png', dataUrl: shot.dataUrl, label: shot.name }
        ])
        return
      }
      setSources(await window.klyro.listCaptureSources())
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setCapturing(false)
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
    <div className={`composer${variant === 'hero' ? ' composer--hero' : ''}`}>
      {attachments.length > 0 && (
        <div className="composer__attachments">
          {attachments.map((attachment, index) => (
            <div key={index} className="attachment-chip">
              <img src={attachment.dataUrl} alt={attachment.label ?? 'screen'} />
              <span>{attachment.label ?? 'screen'}</span>
              <button
                className="btn btn--icon btn--icon-sm btn--ghost"
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
        ref={textareaRef}
        className="composer__textarea"
        value={text}
        aria-label="Message Klyro"
        placeholder="Ask Klyro anything…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
        }}
        rows={1}
      />

      <div className="composer__actions">
        <button
          className="btn btn--icon btn--ghost"
          onClick={openSources}
          disabled={capturing}
          title="Attach what is on your screen"
          aria-label="Attach a screen capture"
        >
          {capturing ? (
            <Loader2 className="icon icon--md spin" aria-hidden="true" />
          ) : (
            <Monitor className="icon icon--md" aria-hidden="true" />
          )}
        </button>
        <button
          className={`btn btn--ghost${recording ? ' btn--danger' : ''}`}
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
        <span className="composer__hint" aria-hidden="true">Enter to send · Shift+Enter for a new line</span>
        {busy ? (
          <button className="btn btn--danger btn--stop" onClick={onStop} aria-label="Stop generation">
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
          <p className="source-picker__hint">
            Klyro attaches the picture to your next message and a vision model reads it. Nothing is captured
            until you pick a source, and the capture is never stored.
          </p>
          <div className="source-picker__grid">
            {sources.map((source) => (
              <button key={source.id} className="source-card" onClick={() => void chooseSource(source.id)}>
                <img src={source.thumbnail} alt={source.name} />
                <span>{source.name}</span>
              </button>
            ))}
          </div>
          <div className="source-picker__examples">
            <span className="muted">Try:</span>
            {['What error is this?', 'Summarise this page', 'What does this button do?', 'Extract the numbers'].map((example) => (
              <button key={example} className="btn btn--ghost btn--sm" onClick={() => setText(example)}>
                <span>{example}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}