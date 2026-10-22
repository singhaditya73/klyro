import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Bookmark, Clock, FileText, Loader2, Save, Search, Sparkles, Trash2 } from 'lucide-react'
import { Badge, EmptyState, Group, PageHeader } from './ui'

/**
 * Saved sessions.
 *
 * Every interview that was recorded, kept on this machine: the questions, the
 * answers, the transcript, the notes and the summary. The list is on the left
 * and the session on the right, so a long transcript never pushes the list
 * out of sight.
 */

interface Question {
  id: string
  text: string
  source: 'voice' | 'text'
  askedAt: number
  kind: 'technical' | 'behavioral' | 'project' | 'general'
  progress: 'asked' | 'answered' | 'skipped' | 'followup'
  answer: string
  answeredAt?: number
  answerMs?: number
  note: string
  bookmarked: boolean
}

interface Session {
  id: string
  company: string
  role: string
  startedAt: number
  endedAt: number
  durationMs: number
  questions: Question[]
  transcript: string[]
  answers: string[]
  notes: string
  summary: string
  summaryModel?: string
  context: Array<{ text: string; kind: 'decision' | 'term'; at: number }>
  tags: string[]
  bookmarked: boolean
  stage?: string
  ephemeral: boolean
}

interface Summary {
  id: string
  company: string
  role: string
  startedAt: number
  endedAt: number
  durationMs: number
  questionCount: number
  answeredCount: number
  progress: number
  bookmarked: boolean
  stage?: string
  hasSummary: boolean
  preview: string
  /** Held in memory only: never written to disk. */
  ephemeral: boolean
}

const KIND_LABEL: Record<string, string> = {
  technical: 'Technical',
  behavioral: 'Behavioural',
  project: 'Project',
  general: 'General'
}

function when(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

export function InterviewsView(): React.ReactNode {
  const [sessions, setSessions] = useState<Summary[] | null>(null)
  const [facets, setFacets] = useState<{ companies: string[]; roles: string[]; kinds: string[] }>({
    companies: [],
    roles: [],
    kinds: []
  })
  const [search, setSearch] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [onlyBookmarked, setOnlyBookmarked] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [open, setOpen] = useState<Session | null>(null)
  const [busy, setBusy] = useState(false)
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const query: Record<string, unknown> = { search }
      if (company) query.company = company
      if (role) query.role = role
      if (onlyBookmarked) query.bookmarked = true
      setSessions(await window.klyro.interviewsList(query))
      setFacets(await window.klyro.interviewsFacets())
      setError(null)
    } catch (caught) {
      // An empty list must say why it is empty.
      setSessions([])
      setError((caught as Error).message)
    }
  }, [search, company, role, onlyBookmarked])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openSession = useCallback(async (id: string): Promise<void> => {
    setOpenId(id)
    setOpen(await window.klyro.interviewsGet(id))
  }, [])

  const summarize = useCallback(
    async (id: string): Promise<void> => {
      setBusy(true)
      try {
        await window.klyro.interviewsSummarize(id)
        setOpen(await window.klyro.interviewsGet(id))
        await refresh()
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await window.klyro.interviewsRemove(id)
      if (openId === id) {
        setOpen(null)
        setOpenId(null)
      }
      await refresh()
    },
    [openId, refresh]
  )

  const keep = useCallback(
    async (id: string): Promise<void> => {
      await window.klyro.interviewsKeep(id)
      setOpen(await window.klyro.interviewsGet(id))
      await refresh()
    },
    [refresh]
  )

  const toggleBookmark = useCallback(
    async (id: string, questionId?: string): Promise<void> => {
      await window.klyro.interviewsToggleBookmark({ id, questionId })
      if (openId === id) setOpen(await window.klyro.interviewsGet(id))
      await refresh()
    },
    [openId, refresh]
  )

  const saveNote = useCallback(
    async (sessionId: string, questionId: string): Promise<void> => {
      const note = noteDraft[questionId] ?? ''
      await window.klyro.interviewsUpdateQuestion({ id: sessionId, questionId, note })
      setOpen(await window.klyro.interviewsGet(sessionId))
      await refresh()
    },
    [noteDraft, refresh]
  )

  const total = useMemo(() => (sessions ?? []).reduce((sum, session) => sum + session.questionCount, 0), [sessions])

  return (
    <>
      <PageHeader
        title="Interviews"
        description="Every recorded session, kept on this machine: the questions, the answers, the transcript, your notes and a summary Klyro writes."
        icon={Clock}
        actions={
          sessions && sessions.length > 0 ? (
            confirmClearAll ? (
              <div className="confirm">
                <span>Delete every session?</span>
                <span className="confirm__actions">
                  <button
                    className="btn btn--danger btn--sm"
                    onClick={() => {
                      void window.klyro.interviewsClear()
                      setOpen(null)
                      setOpenId(null)
                      setConfirmClearAll(false)
                      void refresh()
                    }}
                  >
                    <span>Yes, delete all</span>
                  </button>
                  <button className="btn btn--quiet btn--sm" onClick={() => setConfirmClearAll(false)}>
                    <span>Keep</span>
                  </button>
                </span>
              </div>
            ) : (
              <button className="btn btn--danger-quiet btn--sm" onClick={() => setConfirmClearAll(true)}>
                <Trash2 className="icon icon--xs" aria-hidden="true" />
                <span>Delete all</span>
              </button>
            )
          ) : undefined
        }
      />

      <div className="split">
        <div>
          <Group title="Sessions" description={`${sessions?.length ?? 0} sessions · ${total} questions`} flush>
            <div style={{ padding: '12px 16px' }}>
              <div className="interviews__filters" style={{ marginBottom: 12 }}>
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Search className="icon icon--xs" aria-hidden="true" />
                    <input
                      value={search}
                      placeholder="A question, a company, a note…"
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                </div>
                {facets.companies.length > 0 && (
                  <select value={company} onChange={(event) => setCompany(event.target.value)} aria-label="Company">
                    <option value="">All companies</option>
                    {facets.companies.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
                {facets.roles.length > 0 && (
                  <select value={role} onChange={(event) => setRole(event.target.value)} aria-label="Role">
                    <option value="">All roles</option>
                    {facets.roles.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={onlyBookmarked}
                    onChange={(event) => setOnlyBookmarked(event.target.checked)}
                  />
                  <span>Bookmarked only</span>
                </label>
              </div>

              {error && (
                <div className="notice notice--error" style={{ marginBottom: 12 }}>
                  <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
                  <span className="notice__body">{error}</span>
                </div>
              )}
              {sessions === null ? (
                <div className="loading-line">Loading…</div>
              ) : sessions.length === 0 ? (
                <EmptyState
                  icon={Clock}
                  title="Nothing here yet"
                  text="Record an interview with “Listen to meeting” or “Record question” in the overlay, and it is written down here."
                />
              ) : (
                <div className="interviews__list">
                  {sessions.map((session) => (
                    <button
                      key={session.id}
                      className={`interviews__row${openId === session.id ? ' interviews__row--active' : ''}`}
                      onClick={() => (openId === session.id ? setOpenId(null) : void openSession(session.id))}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="interviews__title">
                          {session.company || 'Interview'}
                          {session.role ? ` · ${session.role}` : ''}
                          {session.bookmarked && <Bookmark className="icon icon--xs" aria-hidden="true" />}
                        </div>
                        <div className="interviews__meta">
                          <span>{when(session.startedAt)}</span>
                          <span>·</span>
                          <span>{duration(session.durationMs)}</span>
                          <span>·</span>
                          <span>
                            {session.answeredCount}/{session.questionCount} answered
                          </span>
                          {session.stage && <Badge>{KIND_LABEL[session.stage] ?? session.stage}</Badge>}
                          {session.ephemeral && <Badge tone="idle">Not saved</Badge>}
                        </div>
                        {session.preview && <div className="interviews__preview">{session.preview}</div>}
                      </div>
                      <div className="interviews__progress" title={`${session.progress}% answered`}>
                        <div className="interviews__progress-bar" style={{ width: `${session.progress}%` }} />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Group>
        </div>

        <div>
          {!open ? (
            <Group>
              <EmptyState
                icon={Clock}
                title="No session open"
                text="Pick one on the left to see its questions, answers, notes and transcript."
              />
            </Group>
          ) : (
            <Group
              title={`${open.company || 'Interview'}${open.role ? ` · ${open.role}` : ''}`}
              description={`${when(open.startedAt)} · ${duration(open.durationMs)} · ${open.questions.length} questions`}
              icon={Clock}
              actions={
                <>
                  <button className="btn btn--ghost btn--sm" onClick={() => void toggleBookmark(open.id)}>
                    <Bookmark className="icon icon--xs" aria-hidden="true" />
                    <span>{open.bookmarked ? 'Bookmarked' : 'Bookmark'}</span>
                  </button>
                  {open.ephemeral && (
                    <button className="btn btn--ghost btn--sm" onClick={() => void keep(open.id)}>
                      <Save className="icon icon--xs" aria-hidden="true" />
                      <span>Keep this one</span>
                    </button>
                  )}
                  <button className="btn btn--danger-quiet btn--sm" onClick={() => void remove(open.id)}>
                    <Trash2 className="icon icon--xs" aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                </>
              }
            >
              {open.ephemeral && (
                <div className="notice notice--info" style={{ marginBottom: 12 }}>
                  <span className="notice__body">
                    This session is held in memory only: it is not written to disk, and it is gone when Klyro quits.
                  </span>
                </div>
              )}

              <div className="row" style={{ marginBottom: 12 }}>
                <button className="btn btn--primary btn--sm" onClick={() => void summarize(open.id)} disabled={busy}>
                  {busy ? (
                    <Loader2 className="icon icon--xs spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="icon icon--xs" aria-hidden="true" />
                  )}
                  <span>{open.summary ? 'Write it again' : 'Summarise'}</span>
                </button>
              </div>

              {open.summary && (
                <div className="notice notice--info">
                  <span className="icon icon--sm notice__icon" aria-hidden="true">
                    <FileText />
                  </span>
                  <span className="notice__body" style={{ whiteSpace: 'pre-wrap' }}>
                    {open.summary}
                  </span>
                </div>
              )}

              {open.context.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h4 className="section-label">Decisions &amp; terms</h4>
                  <ul className="interviews__context">
                    {open.context.map((note) => (
                      <li key={`${note.at}-${note.text}`}>
                        <Badge>{note.kind === 'decision' ? 'Decision' : 'Term'}</Badge> {note.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{ marginTop: 16 }}>
                <h4 className="section-label">Questions</h4>
                {open.questions.length === 0 && <div className="hint">No questions were recorded.</div>}
                {open.questions.map((question) => (
                  <div key={question.id} className="interviews__question">
                    <div className="interviews__question-head">
                      <Badge>{KIND_LABEL[question.kind] ?? question.kind}</Badge>
                      <span className="interviews__question-text">{question.text}</span>
                      <button
                        className="btn btn--icon btn--icon-sm btn--quiet"
                        onClick={() => void toggleBookmark(open.id, question.id)}
                        aria-label="Bookmark this question"
                        title="Bookmark"
                      >
                        <Bookmark
                          className="icon icon--xs"
                          style={question.bookmarked ? { color: 'var(--warning)' } : undefined}
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                    {question.answer && <div className="interviews__answer">{question.answer}</div>}
                    {question.answerMs !== undefined && (
                      <div className="hint">answered in {(question.answerMs / 1000).toFixed(1)}s</div>
                    )}
                    <div className="interviews__note">
                      <input
                        placeholder="Your note about this question…"
                        value={noteDraft[question.id] ?? question.note}
                        onChange={(event) => setNoteDraft((draft) => ({ ...draft, [question.id]: event.target.value }))}
                        onBlur={() => void saveNote(open.id, question.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {open.transcript.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary className="hint" style={{ cursor: 'pointer' }}>
                    Transcript ({open.transcript.length} lines)
                  </summary>
                  <div className="interviews__transcript">
                    {open.transcript.map((line, index) => (
                      <div key={index}>{line}</div>
                    ))}
                  </div>
                </details>
              )}
            </Group>
          )}
        </div>
      </div>
    </>
  )
}
