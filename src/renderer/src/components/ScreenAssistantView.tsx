import { useState, useEffect } from 'react'
import type { CaptureSource, Attachment, SendChatRequest } from '@shared/types'
import { Monitor, ArrowRight, X, AlertCircle } from 'lucide-react'
import KlyroMark from '../assets/logo/klyro-mark.svg'

interface Props {}

export function ScreenAssistantView({}: Props) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null)
  const [selectedSource, setSelectedSource] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permissionStatus, setPermissionStatus] = useState<'unknown' | 'granted' | 'denied'>('unknown')

  useEffect(() => {
    checkPermissions()
  }, [])

  async function checkPermissions() {
    try {
      const status = await window.klyro.checkPermissions()
      setPermissionStatus(status.screen)
    } catch {}
  }

  async function openSources() {
    setError(null)
    try {
      const srcs = await window.klyro.listCaptureSources()
      setSources(srcs)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  async function chooseSource(id?: string) {
    setSources(null)
    setError(null)
    try {
      const shot = await window.klyro.grabScreen(id)
      setPreview(shot.dataUrl)
      setSelectedSource(shot.name)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  async function ask() {
    if (!question.trim() && !preview) return
    setStreaming(true)
    setAnswer(null)
    try {
      const attachments: Attachment[] = preview ? [{ kind: 'image', mime: 'image/png', dataUrl: preview, label: selectedSource || 'screen' }] : []
      const request: SendChatRequest = {
        conversationId: '',
        content: question,
        attachments
      }
      await window.klyro.sendChat(request)
      // The answer will come through the chat stream
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setStreaming(false)
    }
  }

  function clearPreview() {
    setPreview(null)
    setSelectedSource(null)
  }

  const workspaceStyle: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column' }
  const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 }
  const logoStyle: React.CSSProperties = { width: 32, height: 32 }
  const titleStyle: React.CSSProperties = { margin: '2px 0 0', fontSize: '13px', color: 'var(--text-muted)' }
  const sectionStyle: React.CSSProperties = { marginBottom: 32 }
  const h2Style: React.CSSProperties = { margin: '0 0 16px', fontSize: '16px', fontWeight: 600 }

  return (
    <div className="workspace" style={workspaceStyle}>
      <header className="workspace-header">
        <div style={headerStyle}>
          <img src={KlyroMark} alt="" style={logoStyle} aria-hidden="true" />
          <div>
            <h1 className="workspace-header__title">Screen Assistant</h1>
            <p style={titleStyle}>Ask questions about what&apos;s on your screen</p>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: '32px 20px', display: 'flex', flexDirection: 'column', maxWidth: '960px', margin: '0 auto', width: '100%' }}>
        <div className={`notice${permissionStatus === 'granted' ? '' : ' notice--warning'}`} style={{ marginBottom: 24 }}>
          <AlertCircle className="icon icon--md notice__icon" aria-hidden="true" />
          <div>
            {permissionStatus === 'granted' ? (
              <>
                <strong>Screen capture available</strong>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Klyro can capture your screen when you explicitly request it.
                </p>
              </>
            ) : (
              <>
                <strong>Screen capture permission required</strong>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Grant screen recording permission in System Settings → Privacy & Security → Screen Recording.
                </p>
              </>
            )}
          </div>
        </div>

        <section style={sectionStyle}>
          <h2 style={h2Style}>Capture your screen</h2>
          
          {preview ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ position: 'relative', borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border-subtle)', background: 'var(--surface-base)' }}>
                <img src={preview} alt="Screen preview" style={{ width: '100%', maxHeight: 400, objectFit: 'contain', display: 'block' }} />
                <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', gap: '8px' }}>
                  <button className="btn btn--icon btn--icon-sm btn--ghost" onClick={clearPreview} aria-label="Clear preview">
                    <X className="icon icon--sm" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Captured: <strong>{selectedSource}</strong></span>
                <button className="btn btn--primary" onClick={() => void chooseSource()}>
                  <Monitor className="icon icon--sm" aria-hidden="true" />
                  <span>Recapture</span>
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button className="btn btn--primary" onClick={openSources} disabled={permissionStatus !== 'granted'}>
                <Monitor className="icon icon--sm" aria-hidden="true" />
                <span>Capture screen</span>
              </button>
              {sources && (
                <>
                  <button className="btn btn--ghost" onClick={() => void chooseSource()}>
                    <Monitor className="icon icon--sm" aria-hidden="true" />
                    <span>Primary screen</span>
                  </button>
                  {sources.map((source) => (
                    <button key={source.id} className="btn btn--ghost" onClick={() => void chooseSource(source.id)} style={{ maxWidth: 200 }}>
                      <img src={source.thumbnail} alt={source.name} style={{ width: 18, height: 18, borderRadius: 4, marginRight: 8 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source.name}</span>
                    </button>
                  ))}
                  <button className="btn btn--ghost btn--sm" onClick={() => setSources(null)}>
                    <X className="icon icon--xs" aria-hidden="true" />
                    <span>Cancel</span>
                  </button>
                </>
              )}
            </div>
          )}

        </section>

        <section style={sectionStyle}>
          <h2 style={h2Style}>Your question</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What would you like to know about your screen?"
              rows={3}
              className="field"
              style={{ borderRadius: 'var(--radius-lg)', padding: '14px 16px', fontSize: '14px' }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                className="btn btn--primary"
                onClick={ask}
                disabled={streaming || (!question.trim() && !preview)}
                style={{ padding: '12px 24px', fontSize: '14px' }}
              >
                {streaming ? (
                  <>
                    <span className="icon icon--sm" style={{ animation: 'blink 1s infinite' }} aria-hidden="true">●</span>
                    <span>Analyzing…</span>
                  </>
                ) : (
                  <>
                    <ArrowRight className="icon icon--sm" aria-hidden="true" />
                    <span>Ask</span>
                  </>
                )}
              </button>
              {preview && (
                <button className="btn btn--ghost" onClick={clearPreview}>
                  <X className="icon icon--sm" aria-hidden="true" />
                  <span>Clear screen</span>
                </button>
              )}
            </div>
            {error && <div className="notice notice--error" style={{ marginTop: 8 }}><AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />{error}</div>}
          </div>
        </section>

        {answer && (
          <section>
            <h2 style={h2Style}>Answer</h2>
            <div className="card" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65, color: 'var(--text-primary)' }}>{answer}</div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

