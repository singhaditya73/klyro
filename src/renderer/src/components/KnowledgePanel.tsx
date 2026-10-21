import { useState } from 'react'
import type { KnowledgeHit } from '@shared/types'
import { useKnowledge } from '../hooks/useKnowledge'
import { useModal } from '../hooks/useModal'
import { timeAgo } from '../lib/format'
import { Brain, FileText, Search, Loader2, Plus, Trash2, Pin, PinOff, Edit2, AlertCircle, MessageSquare, Info, X } from 'lucide-react'
import KlyroMark from '../assets/logo/klyro-mark.svg'

interface Props {
  onClose: () => void
}

type Tab = 'memories' | 'documents'

export function KnowledgePanel({ onClose }: Props) {
  const knowledge = useKnowledge()
  const panelRef = useModal(onClose)
  const [tab, setTab] = useState<Tab>('memories')
  const [memoryText, setMemoryText] = useState('')
  const [memoryTags, setMemoryTags] = useState('')
  const [filter, setFilter] = useState('')
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null)
  // Two-step destructive confirm: first click arms the button, second click runs it.
  const [confirmClear, setConfirmClear] = useState<'memories' | 'documents' | null>(null)

  // Ask-with-pinned-document: send one chat message grounded in a whole document.
  const [askDocId, setAskDocId] = useState<string | null>(null)
  const [askQuestion, setAskQuestion] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [askNote, setAskNote] = useState<string | null>(null)

  async function askDocument(documentId: string): Promise<void> {
    const question = askQuestion.trim()
    if (!question || askBusy) return
    setAskBusy(true)
    setAskNote(null)
    // The box empties as soon as the question is sent: the answer streams in
    // the chat history, so the text has no reason to stay on screen.
    setAskQuestion('')
    try {
      const conversation = await window.klyro.createConversation()
      await window.klyro.sendChat({ conversationId: conversation.id, content: question, pinnedDocumentId: documentId })
      setAskNote('Sent — the answer is streaming in your chat history.')
    } catch (error) {
      setAskQuestion(question)
      setAskNote((error as Error).message)
    } finally {
      setAskBusy(false)
    }
  }

  const shownMemories = filter
    ? knowledge.memories.filter((record) => record.text.toLowerCase().includes(filter.toLowerCase()))
    : knowledge.memories

  async function runSearch(value: string): Promise<void> {
    setFilter(value)
    if (!value.trim()) {
      setHits(null)
      return
    }
    setHits(await window.klyro.knowledgeSearch(value))
  }

  const h3Style: React.CSSProperties = { margin: '0 0 16px', fontSize: '14px', fontWeight: 600 }

  return (
    <div className="modal">
      <div className="modal__panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="Knowledge" tabIndex={-1}>
        <div className="modal__head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={KlyroMark} alt="" style={{ width: 24, height: 24 }} aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Knowledge</h2>
          </div>
          <button className="btn btn--icon btn--icon-sm btn--ghost" aria-label="Close the knowledge panel" onClick={onClose}>
            <X className="icon icon--sm" aria-hidden="true" />
          </button>
        </div>

        <div className="tabs" role="tablist" aria-label="Knowledge sections">
          <button className={tab === 'memories' ? 'tab tab--active' : 'tab'} role="tab" aria-selected={tab === 'memories'} onClick={() => setTab('memories')}>
            <Brain className="icon icon--sm" aria-hidden="true" />
            <span style={{ marginLeft: 6 }}>Memory ({knowledge.memories.length})</span>
          </button>
          <button className={tab === 'documents' ? 'tab tab--active' : 'tab'} role="tab" aria-selected={tab === 'documents'} onClick={() => setTab('documents')}>
            <FileText className="icon icon--sm" aria-hidden="true" />
            <span style={{ marginLeft: 6 }}>Documents ({knowledge.documents.length})</span>
          </button>
        </div>

        <div className="modal__body">
          {knowledge.error && <div className="notice notice--error" style={{ marginBottom: 16 }}><AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />{knowledge.error}</div>}
          {knowledge.notice && <div className="notice notice--info" style={{ marginBottom: 16 }}><span className="icon icon--sm notice__icon" aria-hidden="true"><Info /></span>{knowledge.notice}</div>}

          <label className="field" style={{ marginBottom: 20 }}>
            <span className="field__label">Search everything Klyro knows</span>
            <div style={{ position: 'relative' }}>
              <Search className="icon icon--md" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} aria-hidden="true" />
              <input
                placeholder="e.g. deployment preferences"
                value={filter}
                onChange={(e) => void runSearch(e.target.value)}
                style={{ paddingLeft: 44, borderRadius: 'var(--radius-lg)', fontSize: 14 }}
              />
            </div>
          </label>

          {hits !== null && (
            <div className="hits" style={{ marginBottom: 24 }}>
              {hits.length === 0 ? (
                <div className="muted" style={{ padding: 16, textAlign: 'center' }}>No matches.</div>
              ) : (
                hits.map((hit) => (
                  <div key={hit.kind + ':' + hit.id} className="hit">
                    <span className={hit.kind === 'memory' ? 'pill pill--ok' : 'pill'}> {hit.kind} </span>
                    <div className="hit__body">
                      <div className="hit__title">{hit.title}</div>
                      {hit.snippet && <div className="hit__snippet">{hit.snippet}</div>}
                    </div>
                    <span className="muted">{hit.score}</span>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'memories' && (
            <section>
              <h3 style={h3Style}>Add a memory</h3>
              <label className="field" style={{ marginBottom: 12 }}>
                <span className="field__label">What should Klyro remember?</span>
                <textarea
                  rows={2}
                  value={memoryText}
                  onChange={(event) => setMemoryText(event.target.value)}
                  placeholder="e.g. I deploy from the main branch and prefer squash merges"
                  className="field"
                />
              </label>
              <label className="field" style={{ marginBottom: 16 }}>
                <span className="field__label">Tags (comma separated)</span>
                <input value={memoryTags} onChange={(event) => setMemoryTags(event.target.value)} placeholder="work, git" className="field" />
              </label>
              <div className="provider__actions" style={{ gap: 10 }}>
                <button
                  className="btn btn--primary"
                  disabled={!memoryText.trim() || knowledge.importing}
                  onClick={() => {
                    void knowledge.addMemory(memoryText, memoryTags)
                    setMemoryText('')
                    setMemoryTags('')
                  }}
                >
                  {knowledge.importing ? (
                    <>
                      <Loader2 className="icon icon--sm" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
                      <span>Remembering…</span>
                    </>
                  ) : (
                    <>
                      <Plus className="icon icon--sm" aria-hidden="true" />
                      <span>Remember</span>
                    </>
                  )}
                </button>
                {confirmClear === 'memories' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--danger)' }}>Delete all memories?</span>
                    <button className="btn btn--danger btn--sm" onClick={() => { void knowledge.clearMemories(); setConfirmClear(null) }}>
                      <span>Yes, clear all</span>
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => setConfirmClear(null)}>
                      <span>Keep</span>
                    </button>
                  </div>
                ) : (
                  <button className="btn btn--ghost btn--sm" onClick={() => setConfirmClear('memories')} aria-label="Clear all memories">
                    <Trash2 className="icon icon--sm" aria-hidden="true" />
                    <span>Clear all</span>
                  </button>
                )}
              </div>

              <h3 style={{ ...h3Style, marginTop: 24 }}>Remembered ({shownMemories.length})</h3>
              {shownMemories.length === 0 ? (
                <div className="empty-content">
                  <Brain className="empty-content__icon" aria-hidden="true" />
                  <h4 className="empty-content__title">Nothing remembered yet</h4>
                  <p className="empty-content__text">
                    Tell Klyro a fact above — preferences, context, conventions — and it gets cited
                    automatically in future answers. <code>Learn durable facts from conversations</code> in
                    Settings adds to this list for you.
                  </p>
                </div>
              ) : (
                shownMemories.map((record) => (
                  <div key={record.id} className="card">
                    <div className="card__row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <button
                        className="btn btn--icon btn--icon-sm btn--ghost"
                        title={record.pinned ? 'Unpin (always included)' : 'Pin (always included)'}
                        onClick={() => void knowledge.togglePinned(record)}
                        style={{ color: record.pinned ? 'var(--action-primary-bg)' : 'var(--text-muted)' }}
                      >
                        {record.pinned ? <Pin className="icon icon--sm" aria-hidden="true" /> : <PinOff className="icon icon--sm" aria-hidden="true" />}
                      </button>
                      <span className="pill">{record.source}</span>
                      {record.tags.map((tag) => (
                        <span key={tag} className="pill"># {tag} </span>
                      ))}
                      <span className="muted card__spacer" style={{ fontSize: 11 }}>{timeAgo(record.updatedAt)}</span>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                          const next = window.prompt('Edit memory', record.text)
                          if (next && next.trim()) void knowledge.updateMemory(record.id, next)
                        }}
                      >
                        <Edit2 className="icon icon--xs" aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      <button
                        className="btn btn--icon btn--icon-sm btn--ghost conv__delete"
                        aria-label={'Forget memory ' + record.text.slice(0, 40)}
                        onClick={() => void knowledge.deleteMemory(record.id)}
                      >
                        <Trash2 className="icon icon--xs" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="card__text">{record.text}</div>
                  </div>
                ))
              )}
            </section>
          )}

          {tab === 'documents' && (
            <section>
              <h3 style={h3Style}>Local documents</h3>
              <p className="muted" style={{ margin: '0 0 16px', fontSize: 12, lineHeight: 1.5 }}>
                Text, Markdown, code, CSV/JSON, HTML, and Office/PDF files (with <code>pdftotext</code> / <code>unzip</code> available).
                Files stay on this device and are only searchable by you.
              </p>
              <div className="provider__actions" style={{ marginBottom: 16, gap: 10 }}>
                <button className="btn btn--primary" disabled={knowledge.importing} onClick={() => void knowledge.importDocuments()}>
                  {knowledge.importing ? (
                    <>
                      <Loader2 className="icon icon--sm" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
                      <span>Importing…</span>
                    </>
                  ) : (
                    <>
                      <Plus className="icon icon--sm" aria-hidden="true" />
                      <span>Add documents…</span>
                    </>
                  )}
                </button>
                {confirmClear === 'documents' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--danger)' }}>Remove all indexed documents?</span>
                    <button className="btn btn--danger btn--sm" onClick={() => { void knowledge.clearDocuments(); setConfirmClear(null) }}>
                      <span>Yes, clear all</span>
                    </button>
                    <button className="btn btn--ghost btn--sm" onClick={() => setConfirmClear(null)}>
                      <span>Keep</span>
                    </button>
                  </div>
                ) : (
                  <button className="btn btn--ghost btn--sm" onClick={() => setConfirmClear('documents')} aria-label="Clear all documents">
                    <Trash2 className="icon icon--sm" aria-hidden="true" />
                    <span>Clear all</span>
                  </button>
                )}
              </div>
              {knowledge.documents.length === 0 ? (
                <div className="empty-content">
                  <FileText className="empty-content__icon" aria-hidden="true" />
                  <h4 className="empty-content__title">No documents indexed</h4>
                  <p className="empty-content__text">
                    Import files once; their excerpts are then cited in answers when relevant. Imported
                    text stays on this device.
                  </p>
                  <div className="empty-content__actions">
                    <button className="btn btn--sm" onClick={() => void knowledge.importDocuments()}>
                      <Plus className="icon icon--xs" aria-hidden="true" />
                      <span>Add documents…</span>
                    </button>
                  </div>
                </div>
              ) : (
                knowledge.documents.map((document) => (
                  <div key={document.id} className="card">
                    <div className="card__row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{document.name}</strong>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                          <span className="pill">{document.kind}</span>
                          <span className="muted" style={{ fontSize: 11 }}>{document.chunkCount} chunks</span>
                          <span className="muted card__spacer" style={{ fontSize: 11 }}>{timeAgo(document.addedAt)}</span>
                        </div>
                      </div>
                      <button
                        className="btn btn--icon btn--icon-sm btn--ghost conv__delete"
                        aria-label={'Remove document ' + document.name}
                        onClick={() => void knowledge.deleteDocument(document.id)}
                      >
                        <Trash2 className="icon icon--xs" aria-hidden="true" />
                      </button>
                    </div>
                    {askDocId === document.id ? (
                      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <textarea
                          className="field"
                          rows={2}
                          autoFocus
                          placeholder={`Ask anything about ${document.name} — the whole document is attached`}
                          value={askQuestion}
                          onChange={(event) => setAskQuestion(event.target.value)}
                        />
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button className="btn btn--ghost btn--sm" onClick={() => setAskDocId(null)}>
                            <span>Cancel</span>
                          </button>
                          <button
                            className="btn btn--primary btn--sm"
                            disabled={!askQuestion.trim() || askBusy}
                            onClick={() => void askDocument(document.id)}
                          >
                            {askBusy ? <Loader2 className="icon icon--xs spin" aria-hidden="true" /> : <MessageSquare className="icon icon--xs" aria-hidden="true" />}
                            <span>Ask in chat</span>
                          </button>
                        </div>
                        {askNote && <div className="muted" style={{ fontSize: 11 }}>{askNote}</div>}
                      </div>
                    ) : (
                      <button className="btn btn--ghost btn--sm" style={{ marginTop: 10 }} onClick={() => { setAskDocId(document.id); setAskQuestion(''); setAskNote(null) }}>
                        <MessageSquare className="icon icon--xs" aria-hidden="true" />
                        <span>Ask about this</span>
                      </button>
                    )}
                    <div className="card__text muted">{document.excerpt}</div>
                  </div>
                ))
              )}
            </section>
          )}

        </div>
      </div>
    </div>
  )
}

