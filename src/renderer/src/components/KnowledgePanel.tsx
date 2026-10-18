import { useState } from 'react'
import type { KnowledgeHit } from '@shared/types'
import { useKnowledge } from '../hooks/useKnowledge'
import { useModal } from '../hooks/useModal'
import { timeAgo } from '../lib/format'
import { Brain, FileText, Plug, Search, Loader2, Plus, Trash2, Pin, PinOff, Edit2, Blocks, GitBranch, CheckCircle, AlertCircle, ExternalLink, ChevronUp, ChevronDown, Mail, MessageSquare, Info, Key, X } from 'lucide-react'
import KlyroMark from '../assets/logo/klyro-mark.svg'

interface Props {
  onClose: () => void
}

type Tab = 'memories' | 'documents' | 'integrations'

export function KnowledgePanel({ onClose }: Props) {
  const knowledge = useKnowledge()
  const panelRef = useModal(onClose)
  const [tab, setTab] = useState<Tab>('memories')
  const [memoryText, setMemoryText] = useState('')
  const [memoryTags, setMemoryTags] = useState('')
  const [filter, setFilter] = useState('')
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null)
  const [token, setToken] = useState('')
  const [repo, setRepo] = useState('')
  const [issueTitle, setIssueTitle] = useState('')
  const [issueBody, setIssueBody] = useState('')
  const [issueNotice, setIssueNotice] = useState<string | null>(null)
  const [openRepos, setOpenRepos] = useState(false)

  const github = knowledge.integrations.find((entry) => entry.id === 'github')
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

  async function createIssue(): Promise<void> {
    setIssueNotice(null)
    try {
      const created = await window.klyro.githubCreateIssue(repo, issueTitle, issueBody)
      setIssueNotice('Created #' + created.number + ': ' + created.title)
      setIssueTitle('')
      setIssueBody('')
    } catch (error) {
      setIssueNotice('\u2717 ' + (error as Error).message)
    }
  }

  const h3Style: React.CSSProperties = { margin: '0 0 16px', fontSize: '14px', fontWeight: 600 }
  const h4Style: React.CSSProperties = { margin: '0 0 12px', fontSize: '13px', fontWeight: 600 }

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
          <button className={tab === 'integrations' ? 'tab tab--active' : 'tab'} role="tab" aria-selected={tab === 'integrations'} onClick={() => setTab('integrations')}>
            <Blocks className="icon icon--sm" aria-hidden="true" />
            <span style={{ marginLeft: 6 }}>Integrations</span>
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
                      <span>Remembering\u2026</span>
                    </>
                  ) : (
                    <>
                      <Plus className="icon icon--sm" aria-hidden="true" />
                      <span>Remember</span>
                    </>
                  )}
                </button>
                <button className="btn btn--ghost" onClick={() => void knowledge.clearMemories()}>
                  <Trash2 className="icon icon--sm" aria-hidden="true" />
                  <span>Clear all</span>
                </button>
              </div>

              <h3 style={{ ...h3Style, marginTop: 24 }}>Remembered ({shownMemories.length})</h3>
              {shownMemories.length === 0 ? (
                <div className="muted" style={{ padding: 24, textAlign: 'center' }}>Nothing stored yet.</div>
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
                      <span>Importing\u2026</span>
                    </>
                  ) : (
                    <>
                      <Plus className="icon icon--sm" aria-hidden="true" />
                      <span>Add documents\u2026</span>
                    </>
                  )}
                </button>
                <button className="btn btn--ghost" onClick={() => void knowledge.clearDocuments()}>
                  <Trash2 className="icon icon--sm" aria-hidden="true" />
                  <span>Clear all</span>
                </button>
              </div>
              {knowledge.documents.length === 0 ? (
                <div className="muted" style={{ padding: 24, textAlign: 'center' }}>No documents indexed.</div>
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
                    <div className="card__text muted">{document.excerpt}</div>
                  </div>
                ))
              )}
            </section>
          )}

          {tab === 'integrations' && (
            <section>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div className="icon icon--lg" style={{ background: 'var(--surface-raised)', borderRadius: 'var(--radius-md)', padding: 10, color: 'var(--text-secondary)' }}>
                  <GitBranch aria-hidden="true" />
                </div>
                <div>
                  <h3 style={h3Style}>GitHub</h3>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>Create issues, search repositories, and link code to conversations</p>
                </div>
              </div>

              {github?.detail && (
                <div className="notice notice--info" style={{ marginBottom: 16 }}>
                  <span className="icon icon--sm notice__icon" aria-hidden="true"><Plug /></span>
                  {github.detail}
                </div>
              )}

              {knowledge.githubAccount ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="card">
                    <div className="card__row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <CheckCircle className="icon icon--md" style={{ color: 'var(--success)' }} aria-hidden="true" />
                        <div>
                          <div style={{ fontWeight: 600 }}>Connected as <strong>{knowledge.githubAccount.login}</strong></div>
                          {knowledge.githubAccount.name && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{knowledge.githubAccount.name}</div>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                        <button className="btn btn--ghost btn--sm" onClick={() => void knowledge.loadRepos()}>
                          <Blocks className="icon icon--xs" aria-hidden="true" />
                          <span>Load repositories</span>
                        </button>
                        <button className="btn btn--ghost btn--sm" onClick={() => void knowledge.clearGitHubToken()}>
                          <Trash2 className="icon icon--xs" aria-hidden="true" />
                          <span>Disconnect</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {knowledge.repos.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <h4 style={h4Style}>Repositories ({knowledge.repos.length})</h4>
                        <button className="btn btn--ghost btn--sm" onClick={() => setOpenRepos(!openRepos)}>
                          {openRepos ? <ChevronUp className="icon icon--xs" aria-hidden="true" /> : <ChevronDown className="icon icon--xs" aria-hidden="true" />}
                          <span style={{ marginLeft: 6 }}>{openRepos ? 'Collapse' : 'Expand'}</span>
                        </button>
                      </div>
                      {openRepos && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                          {knowledge.repos.map((item) => (
                            <div key={item.fullName} className="card" style={{ cursor: 'pointer' }} onClick={() => { setRepo(item.fullName); setIssueNotice(null); }}>
                              <div className="card__row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                <strong style={{ flex: 1, minWidth: 0 }}>{item.fullName}</strong>
                                {item.isPrivate && <span className="pill pill--warn">Private</span>}
                                <span className="pill" style={{ marginLeft: 8 }}>{item.openIssues} open</span>
                              </div>
                              {item.description && <div className="card__text muted" style={{ marginTop: 8 }}>{item.description}</div>}
                              <div className="provider__actions" style={{ marginTop: 12 }}>
                                <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); setRepo(item.fullName); setIssueNotice(null); }}>
                                  Use for issues
                                  <ExternalLink className="icon icon--xs" aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {knowledge.githubAccount && (
                    <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--border-subtle)' }}>
                      <h4 style={h4Style}>Open an issue</h4>
                      <label className="field" style={{ marginBottom: 12 }}>
                        <span className="field__label">Repository (owner/name)</span>
                        <input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="singhaditya73/klyro" className="field" />
                      </label>
                      <label className="field" style={{ marginBottom: 12 }}>
                        <span className="field__label">Title</span>
                        <input value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} className="field" />
                      </label>
                      <label className="field" style={{ marginBottom: 16 }}>
                        <span className="field__label">Body</span>
                        <textarea rows={4} value={issueBody} onChange={(event) => setIssueBody(event.target.value)} className="field" />
                      </label>
                      <div className="provider__actions" style={{ gap: 10 }}>
                        <button className="btn btn--primary" disabled={!repo.trim() || !issueTitle.trim()} onClick={createIssue}>
                          <AlertCircle className="icon icon--sm" aria-hidden="true" />
                          <span>Create issue</span>
                        </button>
                        {issueNotice && <span className="muted">{issueNotice}</span>}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="card">
                  <div className="provider__key" style={{ flexDirection: 'column', gap: 12, alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Key className="icon icon--md" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                      <div>
                        <div style={{ fontWeight: 500 }}>Personal access token required</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Create a token with <code>repo</code> scope at GitHub Settings \u2192 Developer settings \u2192 Personal access tokens</div>
                      </div>
                    </div>
                    <input
                      type="password"
                      placeholder="Paste personal access token (repo scope)\u2026"
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      className="field"
                    />
                    <button className="btn btn--primary" disabled={!token.trim()} onClick={() => { void knowledge.saveGitHubToken(token); setToken(''); }}>
                      <Plug className="icon icon--sm" aria-hidden="true" />
                      <span>Connect GitHub</span>
                    </button>
                  </div>
                </div>
              )}

              <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--border-subtle)' }}>
                <h4 style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Available integrations</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                  {[
                    { id: 'gmail', label: 'Gmail', description: 'Read, search, and send emails', icon: <Mail /> },
                    { id: 'slack', label: 'Slack', description: 'Post messages, search channels', icon: <MessageSquare /> },
                    { id: 'drive', label: 'Google Drive', description: 'Search and attach files', icon: <FileText /> },
                    { id: 'notion', label: 'Notion', description: 'Search pages and databases', icon: <FileText /> },
                  ].map((item) => (
                    <div key={item.id} className="card" style={{ opacity: 0.6, pointerEvents: 'none' }}>
                      <div className="card__row">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="icon icon--md" style={{ background: 'var(--surface-base)', borderRadius: 'var(--radius-sm)', padding: 8, color: 'var(--text-muted)' }}>
                            {item.icon}
                          </div>
                          <div>
                            <div style={{ fontWeight: 500 }}>{item.label}</div>
                            <div className="muted" style={{ fontSize: 11 }}>Coming soon</div>
                          </div>
                        </div>
                        <span className="pill pill--warn">Planned</span>
                      </div>
                      <div className="card__text muted" style={{ fontSize: 12 }}>{item.description}</div>
                    </div>
                  ))}
                </div>
                <p style={{ margin: '16px 0 0', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  More integrations are planned. Let us know which ones you would like to see.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

