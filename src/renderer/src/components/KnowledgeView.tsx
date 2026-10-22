import { useState } from 'react'
import type { KnowledgeHit } from '@shared/types'
import { useKnowledge } from '../hooks/useKnowledge'
import { timeAgo } from '../lib/format'
import { AlertCircle, Brain, FileText, Info, Loader2, MessageSquare, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react'
import { Badge, EmptyState, Group, PageHeader } from './ui'

/**
 * What Klyro knows.
 *
 * Two kinds of thing live here: memories (facts you asked it to keep) and
 * documents (files it indexed). Both stay on this machine and both are added
 * to an answer only when they are relevant — so the list says where each
 * thing came from.
 */

type Tab = 'memories' | 'documents'

export function KnowledgeView(): React.ReactNode {
  const knowledge = useKnowledge()
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

  return (
    <>
      <PageHeader
        title="Knowledge"
        description="Facts and files that ground an answer. Everything here stays on this device, and something is used only when it is relevant to the question."
        icon={Brain}
      />

      {knowledge.error && (
        <div className="notice notice--error" style={{ marginBottom: 16 }}>
          <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
          {knowledge.error}
        </div>
      )}
      {knowledge.notice && (
        <div className="notice notice--info" style={{ marginBottom: 16 }}>
          <Info className="icon icon--sm notice__icon" aria-hidden="true" />
          {knowledge.notice}
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Knowledge sections" style={{ marginBottom: 16 }}>
        <button
          className={tab === 'memories' ? 'tab tab--active' : 'tab'}
          role="tab"
          aria-selected={tab === 'memories'}
          onClick={() => setTab('memories')}
        >
          <Brain className="icon icon--sm" aria-hidden="true" />
          <span style={{ marginLeft: 6 }}>Memory ({knowledge.memories.length})</span>
        </button>
        <button
          className={tab === 'documents' ? 'tab tab--active' : 'tab'}
          role="tab"
          aria-selected={tab === 'documents'}
          onClick={() => setTab('documents')}
        >
          <FileText className="icon icon--sm" aria-hidden="true" />
          <span style={{ marginLeft: 6 }}>Documents ({knowledge.documents.length})</span>
        </button>
      </div>

      <Group title="Search everything Klyro knows">
        <label className="field">
          <div style={{ position: 'relative' }}>
            <Search
              className="icon icon--md"
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
              aria-hidden="true"
            />
            <input
              placeholder="e.g. deployment preferences"
              value={filter}
              onChange={(event) => void runSearch(event.target.value)}
              style={{ paddingLeft: 44 }}
            />
          </div>
        </label>

        {hits !== null && (
          <div className="hits" style={{ marginTop: 16 }}>
            {hits.length === 0 ? (
              <div className="hint">No matches.</div>
            ) : (
              hits.map((hit) => (
                <div key={hit.kind + ':' + hit.id} className="hit">
                  <Badge tone={hit.kind === 'memory' ? 'ok' : 'neutral'}>{hit.kind}</Badge>
                  <div className="hit__body">
                    <div className="hit__title">{hit.title}</div>
                    {hit.snippet && <div className="hit__snippet">{hit.snippet}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </Group>

      {tab === 'memories' && (
        <Group
          title="Memories"
          description="Facts you asked it to remember. A pinned memory is always included; the rest are recalled when they are relevant."
          icon={Brain}
        >
          <label className="field" style={{ marginBottom: 12 }}>
            <span className="field__label">What should Klyro remember?</span>
            <textarea
              rows={2}
              value={memoryText}
              onChange={(event) => setMemoryText(event.target.value)}
              placeholder="e.g. I deploy from the main branch and prefer squash merges"
            />
          </label>
          <label className="field" style={{ marginBottom: 16 }}>
            <span className="field__label">Tags (comma separated)</span>
            <input value={memoryTags} onChange={(event) => setMemoryTags(event.target.value)} placeholder="work, git" />
          </label>
          <div className="row" style={{ gap: 10 }}>
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
                  <Loader2 className="icon icon--sm spin" aria-hidden="true" />
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
              <div className="confirm">
                <span>Delete all memories?</span>
                <span className="confirm__actions">
                  <button className="btn btn--danger btn--sm" onClick={() => { void knowledge.clearMemories(); setConfirmClear(null) }}>
                    <span>Yes, clear all</span>
                  </button>
                  <button className="btn btn--quiet btn--sm" onClick={() => setConfirmClear(null)}>
                    <span>Keep</span>
                  </button>
                </span>
              </div>
            ) : (
              <button className="btn btn--danger-quiet btn--sm" onClick={() => setConfirmClear('memories')} aria-label="Clear all memories">
                <Trash2 className="icon icon--xs" aria-hidden="true" />
                <span>Clear all</span>
              </button>
            )}
          </div>

          <div style={{ marginTop: 20 }}>
            {shownMemories.length === 0 ? (
              <EmptyState
                icon={Brain}
                title="Nothing remembered yet"
                text="Tell Klyro a fact above — preferences, context, conventions — and it is cited automatically in future answers."
              />
            ) : (
              <div className="list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                {shownMemories.map((record) => (
                  <div key={record.id} className="list__row" style={{ alignItems: 'flex-start' }}>
                    <button
                      className="btn btn--icon btn--icon-sm btn--quiet"
                      title={record.pinned ? 'Unpin (always included)' : 'Pin (always included)'}
                      onClick={() => void knowledge.togglePinned(record)}
                      style={{ color: record.pinned ? 'var(--accent)' : 'var(--text-muted)' }}
                    >
                      {record.pinned ? <Pin className="icon icon--sm" aria-hidden="true" /> : <PinOff className="icon icon--sm" aria-hidden="true" />}
                    </button>
                    <div className="list__main">
                      <div className="row row--wrap" style={{ gap: 6, marginBottom: 4 }}>
                        <Badge>{record.source}</Badge>
                        {record.pinned && <Badge tone="accent">Always included</Badge>}
                        {record.tags.map((tag) => (
                          <Badge key={tag}>#{tag}</Badge>
                        ))}
                        <span className="hint">{timeAgo(record.updatedAt)}</span>
                      </div>
                      <div className="card__text">{record.text}</div>
                    </div>
                    <div className="list__actions">
                      <button
                        className="btn btn--icon btn--icon-sm btn--quiet"
                        onClick={() => {
                          const next = window.prompt('Edit memory', record.text)
                          if (next && next.trim()) void knowledge.updateMemory(record.id, next)
                        }}
                        aria-label="Edit memory"
                      >
                        <span className="hint">Edit</span>
                      </button>
                      <button
                        className="btn btn--icon btn--icon-sm btn--quiet"
                        aria-label={'Forget memory ' + record.text.slice(0, 40)}
                        onClick={() => void knowledge.deleteMemory(record.id)}
                      >
                        <Trash2 className="icon icon--xs" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Group>
      )}

      {tab === 'documents' && (
        <Group
          title="Local documents"
          description="Text, Markdown, code, CSV/JSON, HTML, and Office/PDF files (with pdftotext / unzip available). Files stay on this device and are only searchable by you."
          icon={FileText}
        >
          <div className="row" style={{ gap: 10, marginBottom: 16 }}>
            <button className="btn btn--primary" disabled={knowledge.importing} onClick={() => void knowledge.importDocuments()}>
              {knowledge.importing ? (
                <>
                  <Loader2 className="icon icon--sm spin" aria-hidden="true" />
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
              <div className="confirm">
                <span>Remove all indexed documents?</span>
                <span className="confirm__actions">
                  <button className="btn btn--danger btn--sm" onClick={() => { void knowledge.clearDocuments(); setConfirmClear(null) }}>
                    <span>Yes, clear all</span>
                  </button>
                  <button className="btn btn--quiet btn--sm" onClick={() => setConfirmClear(null)}>
                    <span>Keep</span>
                  </button>
                </span>
              </div>
            ) : (
              <button className="btn btn--danger-quiet btn--sm" onClick={() => setConfirmClear('documents')} aria-label="Clear all documents">
                <Trash2 className="icon icon--xs" aria-hidden="true" />
                <span>Clear all</span>
              </button>
            )}
          </div>

          {knowledge.documents.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No documents indexed"
              text="Import files once; their excerpts are then cited in answers when relevant. Imported text stays on this device."
              action={
                <button className="btn btn--sm" onClick={() => void knowledge.importDocuments()}>
                  <Plus className="icon icon--xs" aria-hidden="true" />
                  <span>Add documents…</span>
                </button>
              }
            />
          ) : (
            <div className="list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
              {knowledge.documents.map((document) => (
                <div key={document.id} className="list__row" style={{ alignItems: 'flex-start' }}>
                  <div className="list__main">
                    <div className="list__title">{document.name}</div>
                    <div className="row row--wrap" style={{ gap: 8, marginTop: 4 }}>
                      <Badge>{document.kind}</Badge>
                      <span className="hint">
                        {document.chunkCount} chunks · added {timeAgo(document.addedAt)}
                      </span>
                    </div>
                    <div className="hit__snippet" style={{ marginTop: 6 }}>{document.excerpt}</div>
                    {askDocId === document.id ? (
                      <div className="stack stack--tight" style={{ marginTop: 10 }}>
                        <textarea
                          rows={2}
                          autoFocus
                          placeholder={`Ask anything about ${document.name} — the whole document is attached`}
                          value={askQuestion}
                          onChange={(event) => setAskQuestion(event.target.value)}
                        />
                        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                          <button className="btn btn--quiet btn--sm" onClick={() => setAskDocId(null)}>
                            <span>Cancel</span>
                          </button>
                          <button
                            className="btn btn--primary btn--sm"
                            disabled={!askQuestion.trim() || askBusy}
                            onClick={() => void askDocument(document.id)}
                          >
                            {askBusy ? (
                              <Loader2 className="icon icon--xs spin" aria-hidden="true" />
                            ) : (
                              <MessageSquare className="icon icon--xs" aria-hidden="true" />
                            )}
                            <span>Ask in chat</span>
                          </button>
                        </div>
                        {askNote && <div className="hint">{askNote}</div>}
                      </div>
                    ) : (
                      <button
                        className="btn btn--ghost btn--xs"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          setAskDocId(document.id)
                          setAskQuestion('')
                          setAskNote(null)
                        }}
                      >
                        <MessageSquare className="icon icon--xs" aria-hidden="true" />
                        <span>Ask about this</span>
                      </button>
                    )}
                  </div>
                  <div className="list__actions">
                    <button
                      className="btn btn--icon btn--icon-sm btn--quiet"
                      aria-label={'Remove document ' + document.name}
                      onClick={() => void knowledge.deleteDocument(document.id)}
                    >
                      <Trash2 className="icon icon--xs" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Group>
      )}
    </>
  )
}
