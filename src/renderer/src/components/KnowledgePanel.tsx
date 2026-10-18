import { useState } from 'react'
import type { KnowledgeHit } from '@shared/types'
import { useKnowledge } from '../hooks/useKnowledge'
import { useModal } from '../hooks/useModal'
import { timeAgo } from '../lib/format'

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
      setIssueNotice(`Created #${created.number}: ${created.title}`)
      setIssueTitle('')
      setIssueBody('')
    } catch (error) {
      setIssueNotice(`✗ ${(error as Error).message}`)
    }
  }

  return (
    <div className="modal">
      <div className="modal__panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="Knowledge" tabIndex={-1}>
        <div className="modal__head">
          <h2>Knowledge</h2>
          <button className="btn btn--ghost" aria-label="Close the knowledge panel" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="tabs" role="tablist" aria-label="Knowledge sections">
          <button
            className={`tab${tab === 'memories' ? ' tab--active' : ''}`}
            role="tab"
            aria-selected={tab === 'memories'}
            onClick={() => setTab('memories')}
          >
            Memory ({knowledge.memories.length})
          </button>
          <button
            className={`tab${tab === 'documents' ? ' tab--active' : ''}`}
            role="tab"
            aria-selected={tab === 'documents'}
            onClick={() => setTab('documents')}
          >
            Documents ({knowledge.documents.length})
          </button>
          <button
            className={`tab${tab === 'integrations' ? ' tab--active' : ''}`}
            role="tab"
            aria-selected={tab === 'integrations'}
            onClick={() => setTab('integrations')}
          >
            Integrations
          </button>
        </div>

        <div className="modal__body">
          {knowledge.error ? <div className="agent__warning">{knowledge.error}</div> : null}
          {knowledge.notice ? <div className="muted">{knowledge.notice}</div> : null}

          <label className="field">
            Search everything Klyro knows
            <input placeholder="e.g. deployment preferences" value={filter} onChange={(e) => void runSearch(e.target.value)} />
          </label>

          {hits ? (
            <div className="hits">
              {hits.length === 0 ? <div className="muted">No matches.</div> : null}
              {hits.map((hit) => (
                <div key={`${hit.kind}:${hit.id}`} className="hit">
                  <span className={`pill${hit.kind === 'memory' ? ' pill--ok' : ''}`}>{hit.kind}</span>
                  <div className="hit__body">
                    <div className="hit__title">{hit.title}</div>
                    {hit.snippet ? <div className="hit__snippet">{hit.snippet}</div> : null}
                  </div>
                  <span className="muted">{hit.score}</span>
                </div>
              ))}
            </div>
          ) : null}

          {tab === 'memories' ? (
            <section>
              <h3>Add a memory</h3>
              <label className="field">
                What should Klyro remember?
                <textarea
                  rows={2}
                  value={memoryText}
                  onChange={(event) => setMemoryText(event.target.value)}
                  placeholder="e.g. I deploy from the main branch and prefer squash merges"
                />
              </label>
              <label className="field">
                Tags (comma separated)
                <input value={memoryTags} onChange={(event) => setMemoryTags(event.target.value)} placeholder="work, git" />
              </label>
              <div className="provider__actions">
                <button
                  className="btn btn--primary"
                  disabled={!memoryText.trim()}
                  onClick={() => {
                    void knowledge.addMemory(memoryText, memoryTags)
                    setMemoryText('')
                    setMemoryTags('')
                  }}
                >
                  Remember
                </button>
                <button className="btn btn--ghost" onClick={() => void knowledge.clearMemories()}>
                  Clear all
                </button>
              </div>

              <h3>Remembered ({shownMemories.length})</h3>
              {shownMemories.length === 0 ? <div className="muted">Nothing stored yet.</div> : null}
              {shownMemories.map((record) => (
                <div key={record.id} className="card">
                  <div className="card__row">
                    <button
                      className="btn btn--ghost"
                      title={record.pinned ? 'Unpin' : 'Pin (always included)'}
                      onClick={() => void knowledge.togglePinned(record)}
                    >
                      {record.pinned ? '★' : '☆'}
                    </button>
                    <span className="pill">{record.source}</span>
                    {record.tags.map((tag) => (
                      <span key={tag} className="pill">
                        #{tag}
                      </span>
                    ))}
                    <span className="muted card__spacer">{timeAgo(record.updatedAt)}</span>
                    <button
                      className="btn btn--ghost"
                      onClick={() => {
                        const next = window.prompt('Edit memory', record.text)
                        if (next && next.trim()) void knowledge.updateMemory(record.id, next)
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="conv__delete"
                      aria-label={`Forget memory ${record.text.slice(0, 40)}`}
                      onClick={() => void knowledge.deleteMemory(record.id)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="card__text">{record.text}</div>
                </div>
              ))}
            </section>
          ) : null}

          {tab === 'documents' ? (
            <section>
              <h3>Local documents</h3>
              <p className="muted">
                Text, Markdown, code, CSV/JSON, HTML, and Office/PDF files (with <code>pdftotext</code> /{' '}
                <code>unzip</code> available). Files stay on this device and are only searchable by you.
              </p>
              <div className="provider__actions">
                <button className="btn btn--primary" disabled={knowledge.importing} onClick={() => void knowledge.importDocuments()}>
                  {knowledge.importing ? 'Importing…' : 'Add documents…'}
                </button>
                <button className="btn btn--ghost" onClick={() => void knowledge.clearDocuments()}>
                  Clear all
                </button>
              </div>
              {knowledge.documents.length === 0 ? <div className="muted">No documents indexed.</div> : null}
              {knowledge.documents.map((document) => (
                <div key={document.id} className="card">
                  <div className="card__row">
                    <strong>{document.name}</strong>
                    <span className="pill">{document.kind}</span>
                    <span className="muted">{document.chunkCount} chunks</span>
                    <span className="muted card__spacer">{timeAgo(document.addedAt)}</span>
                    <button
                      className="conv__delete"
                      aria-label={`Remove document ${document.name}`}
                      onClick={() => void knowledge.deleteDocument(document.id)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="card__text muted">{document.excerpt}</div>
                </div>
              ))}
            </section>
          ) : null}

          {tab === 'integrations' ? (
            <section>
              <h3>GitHub</h3>
              <p className="muted">{github?.detail}</p>
              {knowledge.githubAccount ? (
                <div className="permissions">
                  <div>
                    Connected as <strong>{knowledge.githubAccount.login}</strong>
                    {knowledge.githubAccount.name ? ` (${knowledge.githubAccount.name})` : ''}
                  </div>
                  <div className="provider__actions">
                    <button className="btn" onClick={() => void knowledge.loadRepos()}>
                      Load repositories
                    </button>
                    <button className="btn btn--ghost" onClick={() => void knowledge.clearGitHubToken()}>
                      Disconnect
                    </button>
                  </div>
                </div>
              ) : (
                <div className="provider__key">
                  <input
                    type="password"
                    placeholder="Personal access token (repo scope)…"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                  />
                  <button
                    className="btn btn--primary"
                    disabled={!token.trim()}
                    onClick={() => {
                      void knowledge.saveGitHubToken(token)
                      setToken('')
                    }}
                  >
                    Connect
                  </button>
                </div>
              )}

              {knowledge.repos.length > 0 ? (
                <>
                  <h4>Repositories</h4>
                  {knowledge.repos.map((item) => (
                    <div key={item.fullName} className="card">
                      <div className="card__row">
                        <strong>{item.fullName}</strong>
                        {item.isPrivate ? <span className="pill">private</span> : null}
                        <span className="muted">{item.openIssues} open</span>
                        <span className="muted card__spacer">{timeAgo(Date.parse(item.updatedAt))}</span>
                        <button
                          className="btn btn--ghost"
                          onClick={() => {
                            setRepo(item.fullName)
                            setIssueNotice(null)
                          }}
                        >
                          Use
                        </button>
                      </div>
                      {item.description ? <div className="card__text muted">{item.description}</div> : null}
                    </div>
                  ))}
                </>
              ) : null}

              {knowledge.githubAccount ? (
                <>
                  <h4>Open an issue</h4>
                  <label className="field">
                    Repository (owner/name)
                    <input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="singhaditya73/klyro" />
                  </label>
                  <label className="field">
                    Title
                    <input value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} />
                  </label>
                  <label className="field">
                    Body
                    <textarea rows={3} value={issueBody} onChange={(event) => setIssueBody(event.target.value)} />
                  </label>
                  <div className="provider__actions">
                    <button
                      className="btn btn--primary"
                      disabled={!repo.trim() || !issueTitle.trim()}
                      onClick={() => void createIssue()}
                    >
                      Create issue
                    </button>
                    {issueNotice ? <span className="muted">{issueNotice}</span> : null}
                  </div>
                </>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
