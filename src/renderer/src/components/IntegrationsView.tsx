import { useState } from 'react'
import { Blocks, GitBranch, Plug, CheckCircle, AlertCircle, ExternalLink, ChevronDown, ChevronUp, Trash2, Mail, MessageSquare, FileText } from 'lucide-react'
import { useKnowledge } from '../hooks/useKnowledge'
import { McpSection } from './McpSection'
import KlyroMark from '../assets/logo/klyro-mark.svg'

interface Props {}

export function IntegrationsView({}: Props) {
  const knowledge = useKnowledge()
  const [githubToken, setGithubToken] = useState('')
  const [repo, setRepo] = useState('')
  const [issueTitle, setIssueTitle] = useState('')
  const [issueBody, setIssueBody] = useState('')
  const [issueNotice, setIssueNotice] = useState<string | null>(null)
  const [openRepos, setOpenRepos] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [connecting, setConnecting] = useState(false)

  const github = knowledge.integrations.find((entry) => entry.id === 'github')

  async function createIssue() {
    setIssueNotice(null)
    try {
      const created = await window.klyro.githubCreateIssue(repo, issueTitle, issueBody)
      setIssueNotice('Created #' + created.number + ': ' + created.title)
      setIssueTitle('')
      setIssueBody('')
    } catch (error) {
      setIssueNotice('✗ ' + (error as Error).message)
    }
  }

  const workspaceStyle: React.CSSProperties = { flex: 1, display: 'flex', flexDirection: 'column' }
  const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 }
  const sectionStyle: React.CSSProperties = { marginBottom: 40, width: '100%' }

  return (
    <div className="workspace" style={workspaceStyle}>
      <header className="workspace-header">
        <div style={headerStyle}>
          <img src={KlyroMark} alt="" style={{ width: 28, height: 28 }} aria-hidden="true" />
          <div>
            <h1 className="workspace-header__title">Integrations</h1>
            <p className="workspace-header__subtitle">Connect the tools Klyro works with</p>
          </div>
        </div>
      </header>

      <div className="workspace-content" style={{ maxWidth: 920 }}>
        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
            <div className="icon icon--lg" style={{ background: 'var(--surface-raised)', borderRadius: 'var(--radius-md)', padding: 10, color: 'var(--text-secondary)' }}>
              <GitBranch aria-hidden="true" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>GitHub</h2>
                <span className={`pill ${github?.connected ? 'pill--ok' : 'pill--warn'}`}>
                  <span className="status-indicator__dot" style={{ background: 'currentColor', width: 6, height: 6, borderRadius: '50%', display: 'inline-block', marginRight: 6 }} aria-hidden="true" />
                  {github?.connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                Issues, repositories, and code context — token stays encrypted on this device
              </p>
            </div>
          </div>

          {github?.detail && (
            <div className="notice notice--info" style={{ marginBottom: 16 }}>
              <span className="icon icon--sm notice__icon" aria-hidden="true"><Plug /></span>
              <span className="notice__body">{github.detail}</span>
            </div>
          )}

          {github?.test && (
            <div className={`notice ${github.test.ok ? 'notice--success' : 'notice--error'}`} style={{ marginBottom: 16 }}>
              <span className="icon icon--sm notice__icon" aria-hidden="true">
                {github.test.ok ? <CheckCircle /> : <AlertCircle />}
              </span>
              <span className="notice__body">
                Test connection: {github.test.detail}
                {github.test.ok ? '' : ' — clear below or paste a new token.'}
              </span>
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
                    <button className="btn btn--ghost btn--sm" onClick={() => void knowledge.testGitHubConnection()}>
                      <Plug className="icon icon--xs" aria-hidden="true" />
                      <span>Test connection</span>
                    </button>
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
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Repositories ({knowledge.repos.length})</h3>
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
                  <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600 }}>Open an issue</h3>
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
              <div className="field">
                <span className="field__label">Personal access token required</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  Create a token with the <code>repo</code> scope at GitHub Settings → Developer settings →
                  Personal access tokens. It is stored encrypted by Klyro and is never sent anywhere else,
                  logged, or shown again after saving.
                </span>
                <div className="provider__key" style={{ marginTop: 12 }}>
                  <input
                    type={showToken ? 'text' : 'password'}
                    aria-label="GitHub personal access token"
                    placeholder="ghp_…"
                    value={githubToken}
                    onChange={(event) => setGithubToken(event.target.value)}
                    className="field"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setShowToken(!showToken)}
                    aria-pressed={showToken}
                  >
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                  <button
                    className="btn btn--primary"
                    disabled={!githubToken.trim() || connecting}
                    onClick={async () => {
                      setConnecting(true)
                      try {
                        await knowledge.saveGitHubToken(githubToken)
                        setGithubToken('')
                      } finally {
                        setConnecting(false)
                      }
                    }}
                  >
                    <Plug className="icon icon--sm" aria-hidden="true" />
                    <span>{connecting ? 'Connecting…' : 'Connect GitHub'}</span>
                  </button>
                </div>
                {github && <span className="composer__hint">Saved token: stored in the encrypted secret store — never rendered here.</span>}
              </div>
            </div>
          )}

          <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--border-subtle)' }}>
            <McpSection />
          </div>

          <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--border-subtle)' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>Available integrations</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {[
                { id: 'gmail', label: 'Gmail', description: 'Read, search, and send emails', icon: <Mail /> },
                { id: 'slack', label: 'Slack', description: 'Post messages, search channels', icon: <MessageSquare /> },
                { id: 'drive', label: 'Google Drive', description: 'Search and attach files', icon: <FileText /> },
                { id: 'notion', label: 'Notion', description: 'Search pages and databases', icon: <FileText /> },
              ].map((item) => (
                <div key={item.id} className="card">
                  <div className="card__row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="icon icon--md" style={{ background: 'var(--surface-base)', borderRadius: 'var(--radius-sm)', padding: 8, color: 'var(--text-muted)' }}>
                        {item.icon}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{item.label}</div>
                        <span className="pill pill--warn">Planned · OAuth</span>
                      </div>
                    </div>
                  </div>
                  <div className="card__text muted" style={{ fontSize: 12 }}>
                    {item.description}. Not yet implemented — it will appear with an OAuth connect flow; no placeholder buttons here.
                  </div>
                </div>
              ))}
            </div>
            <p style={{ margin: '16px 0 0', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
              Planned integrations land with real OAuth support. GitHub is available today.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}