import { useState, useEffect } from 'react'
import type { Attachment } from '@shared/types'
import {
  Monitor,
  Bot,
  Search,
  FileText,
  ArrowRight,
  Mic,
  Plus,
  HelpCircle,
  Send,
} from 'lucide-react'
import { timeAgo } from '../lib/format'
import KlyroLogo from '../assets/logo/klyro-logo-dark.svg'
import KlyroMark from '../assets/logo/klyro-mark.svg'
import { useChat } from '../hooks/useChat'

interface Props {
  onNewChat: () => Promise<void>
  onOpenView: (view: string) => void
}

const workspaceStyle: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column' }
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 }
const contentStyle: React.CSSProperties = { flex: 1, overflow: 'auto', padding: '32px 20px', display: 'flex', flexDirection: 'column', maxWidth: '960px', margin: '0 auto', width: '100%' }
const welcomeStyle: React.CSSProperties = { maxWidth: '720px', margin: '0 auto 40px', textAlign: 'center' }
const h1Style: React.CSSProperties = { margin: '0 0 12px', fontSize: '32px', fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--text-primary)' }
const pStyle: React.CSSProperties = { margin: 0, fontSize: '16px', color: 'var(--text-secondary)', lineHeight: 1.6 }
const composerStyle: React.CSSProperties = { maxWidth: '760px', margin: '0 auto 40px' }
const sectionStyle: React.CSSProperties = { maxWidth: '960px', margin: '0 auto 48px' }
const suggestionsGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }
const recentSectionStyle: React.CSSProperties = { maxWidth: '960px', margin: '0 auto' }
const flexBetweenStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
const listStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '8px' }
const cardStyle: React.CSSProperties = { cursor: 'pointer', transition: 'border-color var(--transition-fast), background var(--transition-fast)' }
const cardRowStyle: React.CSSProperties = { alignItems: 'flexStart', flexWrap: 'wrap' }

function getTimeOfDay(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

export function HomeView({ onNewChat, onOpenView }: Props) {
  const chat = useChat()
  const [suggestions] = useState([
    { id: '1', label: 'Ask about my screen', icon: Monitor, action: () => onOpenView('screen') },
    { id: '2', label: 'Summarize a document', icon: FileText, action: () => onOpenView('memory') },
    { id: '3', label: 'Research a topic', icon: Search, action: () => onOpenView('chat') },
    { id: '4', label: 'Start a desktop task', icon: Bot, action: () => onOpenView('agent') },
  ])

  return (
    <div className="workspace" style={workspaceStyle}>
      <header className="workspace-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={KlyroLogo} alt="Klyro" style={{ width: 180, height: 43 }} />
        </div>
        <div className="workspace-header__actions">
          <button className="btn btn--primary" onClick={onNewChat} aria-label="New conversation">
            <Plus className="icon icon--sm" aria-hidden="true" />
            <span>New chat</span>
          </button>
        </div>
      </header>

      <div style={contentStyle}>
        <section style={welcomeStyle}>
          <h1 style={h1Style}>Good {getTimeOfDay()}.</h1>
          <p style={pStyle}>What would you like to get done?</p>
        </section>

        <section style={composerStyle}>
          <HomeComposer onSend={handleHomeSend} onOpenView={onOpenView} />
        </section>

        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Quick actions
            </h2>
          </div>
          <div style={suggestionsGridStyle}>
            {suggestions.map((s) => (
              <button
                key={s.id}
                className="btn btn--ghost"
                onClick={s.action}
                style={{ padding: '16px', justifyContent: 'flex-start', textAlign: 'left', minHeight: '64px', borderRadius: 'var(--radius-lg)' }}
              >
                <span className="icon icon--lg" style={{ color: 'var(--text-muted)' }} aria-hidden="true">
                  <s.icon />
                </span>
                <span style={{ marginLeft: '12px', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>{s.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section style={recentSectionStyle}>
          <div style={flexBetweenStyle}>
            <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Recent conversations
            </h2>
            {chat.summaries.length > 5 && (
              <button className="btn btn--ghost btn--sm" onClick={() => onOpenView('chat')}>
                View all
                <ArrowRight className="icon icon--xs" aria-hidden="true" />
              </button>
            )}
          </div>
          {chat.summaries.length === 0 ? (
            <div className="empty-content" style={{ padding: '48px 24px' }}>
              <HelpCircle className="empty-content__icon" aria-hidden="true" />
              <h3 className="empty-content__title">No conversations yet</h3>
              <p className="empty-content__text">Start a new chat to begin working with Klyro.</p>
              <div className="empty-content__actions">
                <button className="btn btn--primary" onClick={onNewChat}>
                  <Plus className="icon icon--sm" aria-hidden="true" />
                  <span>New chat</span>
                </button>
              </div>
            </div>
          ) : (
            <div style={listStyle}>
              {chat.summaries.slice(0, 8).map((summary) => (
                <div
                  key={summary.id}
                  className="card"
                  onClick={() => { chat.openConversation(summary.id); onOpenView('chat'); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chat.openConversation(summary.id); onOpenView('chat'); } }}
                  style={cardStyle}
                >
                  <div className="card__row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="card__title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {summary.title || 'New chat'}
                      </div>
                      <div className="card__subtitle" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {summary.preview || `${summary.messageCount} messages`}
                      </div>
                    </div>
                    <time style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {timeAgo(summary.updatedAt)}
                    </time>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function HomeComposer({ onSend, onOpenView }: { onSend: (content: string, attachments: Attachment[]) => Promise<void>; onOpenView: (view: string) => void }) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sources, setSources] = useState<any[] | null>(null)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  async function submit() {
    const content = text.trim()
    if (!content && attachments.length === 0) return
    await onSend(content, attachments)
    setText('')
    setAttachments([])
  }

  async function openSources() {
    setError(null)
    try {
      setSources(await window.klyro.listCaptureSources())
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  async function chooseSource(id?: string) {
    setSources(null)
    try {
      const shot = await window.klyro.grabScreen(id)
      setAttachments((prev) => [...prev, { kind: 'image', mime: 'image/png', dataUrl: shot.dataUrl, label: shot.name }])
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data) }
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

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }

  const composerStyle: React.CSSProperties = { borderTop: 'none', background: 'transparent', padding: 0, maxWidth: '760px', margin: '0 auto', width: '100%' }
  const buttonGroupStyle: React.CSSProperties = { gap: '10px' }
  const textareaStyle: React.CSSProperties = { borderRadius: 'var(--radius-xl)', padding: '16px 20px', fontSize: '15px' }

  return (
    <div className="composer" style={composerStyle}>
      {attachments.length > 0 && (
        <div className="composer__attachments">
          {attachments.map((attachment, index) => (
            <div key={index} className="attachment-chip">
              <img src={attachment.dataUrl} alt={attachment.label ?? 'screen'} />
              <span>{attachment.label ?? 'screen'}</span>
              <button aria-label="Remove attachment" onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}>X</button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="composer__error">{error}</div>}

      <textarea
        className="composer__textarea"
        value={text}
        placeholder="Ask Klyro anything\u2026   (Enter to send \u00B7 Shift+Enter for new line)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
        rows={3}
        style={textareaStyle}
      />

      <div className="composer__actions" style={buttonGroupStyle}>
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
              <span className="icon icon--sm" style={{ animation: 'blink 1s infinite' }} aria-hidden="true">\u25CF</span>
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
        <button className="btn btn--primary" onClick={submit} disabled={!text.trim() && attachments.length === 0} style={{ padding: '10px 24px', fontSize: '14px' }}>
          <Send className="icon icon--sm" aria-hidden="true" />
          <span>Send</span>
        </button>
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

import { useRef } from 'react'
