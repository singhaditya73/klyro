import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bookmark, Check, ChevronDown, Clock, FileText, Loader2, Save, Search, Sparkles, Trash2, X } from 'lucide-react'
import { useModal } from '../hooks/useModal'

/**
 * Interview history.
 *
 * Every interview that was recorded, kept on this machine: the questions, the
 * answers, the transcript, the notes and the summary. Searchable, filterable,
 * and a bookmark for the ones worth keeping.
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

export function InterviewsPanel({ onClose }: { onClose: () => void }) {
  const panelRef = useModal(() => onClose())
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

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const query: Record<string, unknown> = { search }
      if (company) query.company = company
      if (role) query.role = role
      if (onlyBookmarked) query.bookmarked = true
      setSessions(await window.klyro.interviewsList(query))
      setFacets(await window.klyro.interviewsFacets())
    } catch {
      setSessions([])
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
    <div className="modal" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal__panel modal__panel--wide" ref={panelRef} role="dialog" aria-modal="true" aria-label="Interviews" tabIndex={-1}>
        <div className="modal__head">
          <strong>Interviews</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            {sessions?.length ?? 0} session{(sessions?.length ?? 0) === 1 ? '' : 's'} · {total} question
            {total === 1 ? '' : 's'} · on this machine only
          </span>
          <button className="btn btn--icon btn--icon-sm btn--ghost" onClick={onClose} aria-label="Close the interviews panel">
            <X className="icon icon--xs" aria-hidden="true" />
          </button>
        </div>

        <div className="modal__body">
          <div className="interviews__filters">
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <span className="field__label">Search</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Search className="icon icon--xs" aria-hidden="true" />
                <input
                  className="field"
                  value={search}
                  placeholder="A question, a company, a note…"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            {facets.companies.length > 0 && (
              <label className="field">
                <span className="field__label">Company</span>
                <select className="field" value={company} onChange={(event) => setCompany(event.target.value)}>
                  <option value="">All</option>
                  {facets.companies.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {facets.roles.length > 0 && (
              <label className="field">
                <span className="field__label">Role</span>
                <select className="field" value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="">All</option>
                  {facets.roles.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="checkbox" style={{ alignSelf: 'flex-end', marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={onlyBookmarked}
                onChange={(event) => setOnlyBookmarked(event.target.checked)}
              />
              <span>Bookmarked only</span>
            </label>
          </div>

          {sessions === null && <div className="muted">Loading…</div>}
          {sessions !== null && sessions.length === 0 && (
            <div className="muted" style={{ fontSize: 13 }}>
              Nothing here yet. Record an interview with <strong>Listen to meeting</strong> or{' '}
              <strong>Record question</strong> in the overlay, and it is written down here.
            </div>
          )}

          <div className="interviews__list">
            {(sessions ?? []).map((session) => (
              <div key={session.id} className="interviews__item">
                <button
                  className="interviews__row"
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
                      <span>
                        <Clock className="icon icon--xs" aria-hidden="true" /> {duration(session.durationMs)}
                      </span>
                      <span>·</span>
                      <span>
                        {session.answeredCount}/{session.questionCount} answered
                      </span>
                      {session.stage && <span className="pill">{KIND_LABEL[session.stage] ?? session.stage}</span>}
                      {session.ephemeral && <span className="pill">not saved</span>}
                    </div>
                    {session.preview && <div className="interviews__preview">{session.preview}</div>}
                  </div>
                  <div className="interviews__progress" title={`${session.progress}% answered`}>
                    <div className="interviews__progress-bar" style={{ width: `${session.progress}%` }} />
                  </div>
                  <ChevronDown className={`icon icon--xs${openId === session.id ? ' interviews__chevron--open' : ''}`} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>

          {open && (
            <div className="interviews__detail">
              <div className="card__row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <button className="btn btn--ghost btn--sm" onClick={() => void toggleBookmark(open.id)}>
                  <Bookmark className="icon icon--xs" aria-hidden="true" />
                  <span>{open.bookmarked ? 'Bookmarked' : 'Bookmark'}</span>
                </button>
                <button className="btn btn--primary btn--sm" onClick={() => void summarize(open.id)} disabled={busy}>
                  {busy ? (
                    <Loader2 className="icon icon--xs spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="icon icon--xs" aria-hidden="true" />
                  )}
                  <span>{open.summary ? 'Write it again' : 'Summarise'}</span>
                </button>
                {open.ephemeral && (
                  <button className="btn btn--ghost btn--sm" onClick={() => void keep(open.id)}>
                    <Save className="icon icon--xs" aria-hidden="true" />
                    <span>Keep this one</span>
                  </button>
                )}
                <button className="btn btn--ghost btn--sm" onClick={() => void remove(open.id)}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Delete</span>
                </button>
              </div>

              {open.summary && (
                <div className="notice notice--info" style={{ marginTop: 12 }}>
                  <span className="icon icon--sm notice__icon" aria-hidden="true">
                    <FileText />
                  </span>
                  <span className="notice__body" style={{ whiteSpace: 'pre-wrap' }}>
                    {open.summary}
                  </span>
                </div>
              )}

              {open.context.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <h4 className="section-label">Decisions &amp; terms</h4>
                  <ul className="interviews__context">
                    {open.context.map((note) => (
                      <li key={`${note.at}-${note.text}`}>
                        <span className="pill">{note.kind === 'decision' ? 'Decision' : 'Term'}</span> {note.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <h4 className="section-label">Questions</h4>
                {open.questions.length === 0 && <div className="muted">No questions were recorded.</div>}
                {open.questions.map((question) => (
                  <div key={question.id} className="interviews__question">
                    <div className="interviews__question-head">
                      <span className="pill">{KIND_LABEL[question.kind] ?? question.kind}</span>
                      <span className="interviews__question-text">{question.text}</span>
                      <button
                        className="btn btn--icon btn--icon-sm btn--ghost"
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
                      <div className="muted" style={{ fontSize: 11 }}>
                        answered in {(question.answerMs / 1000).toFixed(1)}s
                      </div>
                    )}
                    <div className="interviews__note">
                      <input
                        className="field"
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
                  <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
                    Transcript ({open.transcript.length} lines)
                  </summary>
                  <div className="interviews__transcript">
                    {open.transcript.map((line, index) => (
                      <div key={index}>{line}</div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        <div className="modal__foot">
          <span className="muted" style={{ fontSize: 12, flex: 1 }}>
            Everything here stays on this machine. Delete any session with one click.
          </span>
          {sessions !== null && sessions.length > 0 && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={async () => {
                await window.klyro.interviewsClear()
                setOpen(null)
                setOpenId(null)
                await refresh()
              }}
            >
              <Trash2 className="icon icon--xs" aria-hidden="true" />
              <span>Delete all</span>
            </button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={onClose}>
            <Check className="icon icon--xs" aria-hidden="true" />
            <span>Done</span>
          </button>
        </div>
      </div>
    </div>
  )
}
