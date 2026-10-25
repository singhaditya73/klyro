import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Award,
  Bookmark,
  Briefcase,
  Check,
  CheckCircle2,
  CheckSquare,
  Clock,
  Copy,
  Database,
  DollarSign,
  Download,
  ExternalLink,
  FileText,
  ListTodo,
  Loader2,
  Mail,
  MessageSquare,
  Plus,
  Save,
  Search,
  Share2,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Zap
} from 'lucide-react'
import { Badge, EmptyState, Group, PageHeader } from './ui'
import type { MeetingActionItem, MeetingCrmNotes, MeetingType } from '@shared/types'

/**
 * Enterprise-grade Meeting & CRM Intelligence Center.
 * Features automated CRM notes, interactive action items hub, MEDDPIC sales deal frameworks,
 * talk-time ratio visualizers, and multi-format exports (Slack, Notion, CRM).
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
  crmNotes?: MeetingCrmNotes
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
  hasCrmNotes?: boolean
  preview: string
  ephemeral: boolean
}

interface GlobalActionItem {
  sessionId: string
  sessionTitle: string
  taskIndex: number
  task: string
  owner?: string
  deadline?: string
  done?: boolean
}

const KIND_LABEL: Record<string, string> = {
  technical: 'Technical',
  behavioral: 'Behavioural',
  project: 'Project',
  general: 'General'
}

const MEETING_TYPE_LABELS: Record<MeetingType, { label: string; icon: string }> = {
  meddpic: { label: 'MEDDPIC B2B Sales Deal', icon: '💎' },
  client_call: { label: 'Client / Sales Call', icon: '💼' },
  internal_sync: { label: 'Team / Architecture Sync', icon: '👥' },
  interview: { label: 'Interview / Candidate', icon: '🎯' },
  one_on_one: { label: '1-on-1 Sync', icon: '🤝' },
  general: { label: 'General Meeting', icon: '📋' }
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
  const [typeFilter, setTypeFilter] = useState<'all' | 'crm' | 'bookmarked'>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [open, setOpen] = useState<Session | null>(null)
  const [viewMode, setViewMode] = useState<'sessions' | 'action_items'>('sessions')
  const [activeTab, setActiveTab] = useState<'crm' | 'qa'>('crm')
  const [meetingType, setMeetingType] = useState<MeetingType>('client_call')
  const [generatingCrm, setGeneratingCrm] = useState(false)
  const [busySummary, setBusySummary] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [pushingSlack, setPushingSlack] = useState(false)
  const [pushSlackMsg, setPushSlackMsg] = useState<string | null>(null)
  const [pushingCrm, setPushingCrm] = useState(false)
  const [pushCrmMsg, setPushCrmMsg] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [newActionText, setNewActionText] = useState('')
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Global Action Items Hub state
  const [globalActions, setGlobalActions] = useState<GlobalActionItem[]>([])
  const [loadingGlobalActions, setLoadingGlobalActions] = useState(false)
  const [actionFilter, setActionFilter] = useState<'all' | 'open' | 'done'>('open')

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const query: Record<string, unknown> = { search }
      if (company) query.company = company
      if (role) query.role = role
      if (typeFilter === 'bookmarked') query.bookmarked = true
      const rawList = await window.klyro.interviewsList(query)
      setSessions(rawList)
      setFacets(await window.klyro.interviewsFacets())
      setError(null)
    } catch (caught) {
      setSessions([])
      setError((caught as Error).message)
    }
  }, [search, company, role, typeFilter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const loadGlobalActions = useCallback(async (): Promise<void> => {
    if (!sessions) return
    setLoadingGlobalActions(true)
    try {
      const crmSessionSummaries = sessions.filter((s) => s.hasCrmNotes)
      const detailed = await Promise.all(crmSessionSummaries.map((s) => window.klyro.interviewsGet(s.id)))
      const items: GlobalActionItem[] = []
      for (const session of detailed) {
        if (session?.crmNotes?.actionItems) {
          session.crmNotes.actionItems.forEach((action: MeetingActionItem, idx: number) => {
            items.push({
              sessionId: session.id,
              sessionTitle: session.crmNotes?.title || session.company || 'Meeting Session',
              taskIndex: idx,
              task: action.task,
              owner: action.owner,
              deadline: action.deadline,
              done: action.done
            })
          })
        }
      }
      setGlobalActions(items)
    } finally {
      setLoadingGlobalActions(false)
    }
  }, [sessions])

  useEffect(() => {
    if (viewMode === 'action_items') {
      void loadGlobalActions()
    }
  }, [viewMode, loadGlobalActions])

  const openSession = useCallback(async (id: string): Promise<void> => {
    setViewMode('sessions')
    setOpenId(id)
    const session = await window.klyro.interviewsGet(id)
    setOpen(session)
    if (session?.crmNotes) {
      setActiveTab('crm')
      setMeetingType(session.crmNotes.type || 'client_call')
    } else {
      setActiveTab('crm')
    }
  }, [])

  const copyToClipboard = useCallback(async (text: string, key: string): Promise<void> => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }, [])

  const generateCrmNotes = useCallback(
    async (id: string, type: MeetingType): Promise<void> => {
      setGeneratingCrm(true)
      try {
        const crmNotes = await window.klyro.interviewsGenerateCrmNotes({ id, meetingType: type })
        if (crmNotes) {
          setOpen((prev) => (prev && prev.id === id ? { ...prev, crmNotes } : prev))
        }
        await refresh()
      } finally {
        setGeneratingCrm(false)
      }
    },
    [refresh]
  )

  const toggleActionItem = useCallback(
    async (index: number): Promise<void> => {
      if (!open || !open.crmNotes) return
      const updatedActions = [...open.crmNotes.actionItems]
      const current = updatedActions[index]
      if (!current) return
      updatedActions[index] = { ...current, done: !current.done }
      const updatedNotes: MeetingCrmNotes = { ...open.crmNotes, actionItems: updatedActions }
      setOpen({ ...open, crmNotes: updatedNotes })
      await window.klyro.interviewsUpdate({ id: open.id, crmNotes: updatedNotes })
    },
    [open]
  )

  const toggleGlobalActionItem = useCallback(
    async (sessionId: string, taskIndex: number): Promise<void> => {
      const session = await window.klyro.interviewsGet(sessionId)
      if (!session || !session.crmNotes) return
      const updatedActions = [...session.crmNotes.actionItems]
      if (!updatedActions[taskIndex]) return
      updatedActions[taskIndex] = { ...updatedActions[taskIndex], done: !updatedActions[taskIndex].done }
      const updatedNotes = { ...session.crmNotes, actionItems: updatedActions }
      await window.klyro.interviewsUpdate({ id: sessionId, crmNotes: updatedNotes })
      if (open?.id === sessionId) {
        setOpen({ ...open, crmNotes: updatedNotes })
      }
      setGlobalActions((prev) =>
        prev.map((item) =>
          item.sessionId === sessionId && item.taskIndex === taskIndex ? { ...item, done: !item.done } : item
        )
      )
    },
    [open]
  )

  const addActionItem = useCallback(async (): Promise<void> => {
    const text = newActionText.trim()
    if (!text || !open || !open.crmNotes) return
    const updatedActions = [...open.crmNotes.actionItems, { task: text, done: false }]
    const updatedNotes: MeetingCrmNotes = { ...open.crmNotes, actionItems: updatedActions }
    setOpen({ ...open, crmNotes: updatedNotes })
    setNewActionText('')
    await window.klyro.interviewsUpdate({ id: open.id, crmNotes: updatedNotes })
  }, [newActionText, open])

  const openMailClient = useCallback((notes: MeetingCrmNotes): void => {
    if (!notes.followUpEmail) return
    const firstLine = notes.followUpEmail.split('\n')[0] || ''
    const subjectMatch = firstLine.match(/subject:\s*(.*)/i)
    const subject = subjectMatch ? subjectMatch[1] : `Follow-up: ${notes.title}`
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(notes.followUpEmail)}`
    window.open(mailtoUrl, '_blank')
  }, [])

  const exportMarkdown = useCallback(
    async (id: string): Promise<void> => {
      const md = await window.klyro.interviewsExportMarkdown(id)
      if (!md) return
      await copyToClipboard(md, 'markdown')
    },
    [copyToClipboard]
  )

  const copySlackRecap = useCallback(
    async (notes: MeetingCrmNotes): Promise<void> => {
      const lines = [`*📋 Meeting Summary: ${notes.title}*`, `>${notes.executiveSummary}`, '']
      if (notes.talkRatio) {
        lines.push(`>🎙️ *Talk Ratio:* You: ${notes.talkRatio.userPct}% | Others: ${notes.talkRatio.othersPct}% (${notes.talkRatio.pacingNote})`, '')
      }
      if (notes.actionItems.length > 0) {
        lines.push('*✅ Action Items:*')
        for (const item of notes.actionItems) {
          const owner = item.owner ? ` _(@${item.owner})_` : ''
          const deadline = item.deadline ? ` [Due: ${item.deadline}]` : ''
          lines.push(`• [${item.done ? 'x' : ' '}] ${item.task}${owner}${deadline}`)
        }
        lines.push('')
      }
      if (notes.keyDecisions.length > 0) {
        lines.push('*🎯 Key Decisions:*')
        for (const d of notes.keyDecisions) lines.push(`• ${d}`)
        lines.push('')
      }
      if (notes.crmInsights?.nextSteps) {
        lines.push(`*➡️ Next Steps:* ${notes.crmInsights.nextSteps}`)
      }
      await copyToClipboard(lines.join('\n'), 'slack')
    },
    [copyToClipboard]
  )

  const copyNotion = useCallback(
    async (notes: MeetingCrmNotes): Promise<void> => {
      const lines: string[] = [
        `# 📋 ${notes.title}`,
        `> 💡 **Executive Summary**: ${notes.executiveSummary}`,
        ''
      ]
      if (notes.talkRatio) {
        lines.push(`> 🎙️ **Talk Ratio**: You: ${notes.talkRatio.userPct}% | Others: ${notes.talkRatio.othersPct}% (${notes.talkRatio.pacingNote})`, '')
      }
      if (notes.actionItems.length > 0) {
        lines.push('### ✅ Action Items')
        for (const item of notes.actionItems) {
          const owner = item.owner ? ` (@${item.owner})` : ''
          const deadline = item.deadline ? ` [Due: ${item.deadline}]` : ''
          lines.push(`- [${item.done ? 'x' : ' '}] ${item.task}${owner}${deadline}`)
        }
        lines.push('')
      }
      if (notes.keyDecisions.length > 0) {
        lines.push('### 🎯 Key Decisions')
        for (const d of notes.keyDecisions) lines.push(`- ${d}`)
        lines.push('')
      }
      if (notes.meddpic) {
        lines.push('### 💼 MEDDPIC Deal Qualification')
        if (notes.meddpic.metrics) lines.push(`- **Metrics**: ${notes.meddpic.metrics}`)
        if (notes.meddpic.economicBuyer) lines.push(`- **Economic Buyer**: ${notes.meddpic.economicBuyer}`)
        if (notes.meddpic.decisionCriteria) lines.push(`- **Decision Criteria**: ${notes.meddpic.decisionCriteria}`)
        if (notes.meddpic.decisionProcess) lines.push(`- **Decision Process**: ${notes.meddpic.decisionProcess}`)
        if (notes.meddpic.painPoints) lines.push(`- **Identify Pain**: ${notes.meddpic.painPoints}`)
        if (notes.meddpic.champion) lines.push(`- **Champion**: ${notes.meddpic.champion}`)
        if (notes.meddpic.competition) lines.push(`- **Competition**: ${notes.meddpic.competition}`)
        lines.push('')
      }
      if (notes.crmInsights) {
        lines.push('### 📊 Commercial Insights')
        if (notes.crmInsights.clientNeeds) lines.push(`- **Customer Needs**: ${notes.crmInsights.clientNeeds.join(', ')}`)
        if (notes.crmInsights.budgetTimeline) lines.push(`- **Budget & Timeline**: ${notes.crmInsights.budgetTimeline}`)
        if (notes.crmInsights.nextSteps) lines.push(`- **Next Steps**: ${notes.crmInsights.nextSteps}`)
        lines.push('')
      }
      await copyToClipboard(lines.join('\n'), 'notion')
    },
    [copyToClipboard]
  )

  const copyCrm = useCallback(
    async (notes: MeetingCrmNotes): Promise<void> => {
      const lines: string[] = [
        `=== CALL LOG: ${notes.title.toUpperCase()} ===`,
        `EXECUTIVE SUMMARY:`,
        notes.executiveSummary,
        ''
      ]
      if (notes.talkRatio) {
        lines.push(`TALK RATIO: User ${notes.talkRatio.userPct}% / Others ${notes.talkRatio.othersPct}% (${notes.talkRatio.pacingNote})`, '')
      }
      if (notes.crmInsights?.nextSteps) lines.push(`NEXT STEPS: ${notes.crmInsights.nextSteps}`)
      if (notes.crmInsights?.budgetTimeline) lines.push(`BUDGET & TIMELINE: ${notes.crmInsights.budgetTimeline}`)
      if (notes.crmInsights?.clientNeeds && notes.crmInsights.clientNeeds.length > 0) {
        lines.push(`PAIN POINTS / CLIENT NEEDS:`, ...notes.crmInsights.clientNeeds.map((n) => `• ${n}`))
      }
      if (notes.actionItems.length > 0) {
        lines.push('', 'ACTION ITEMS:')
        for (const a of notes.actionItems) {
          lines.push(`• [${a.done ? 'DONE' : 'OPEN'}] ${a.task}${a.owner ? ` (Owner: ${a.owner})` : ''}${a.deadline ? ` (Due: ${a.deadline})` : ''}`)
        }
      }
      if (notes.meddpic) {
        lines.push('', '--- MEDDPIC DEAL QUALIFICATION ---')
        if (notes.meddpic.metrics) lines.push(`M - Metrics: ${notes.meddpic.metrics}`)
        if (notes.meddpic.economicBuyer) lines.push(`E - Economic Buyer: ${notes.meddpic.economicBuyer}`)
        if (notes.meddpic.decisionCriteria) lines.push(`D - Decision Criteria: ${notes.meddpic.decisionCriteria}`)
        if (notes.meddpic.decisionProcess) lines.push(`D - Decision Process: ${notes.meddpic.decisionProcess}`)
        if (notes.meddpic.painPoints) lines.push(`P - Pain Points: ${notes.meddpic.painPoints}`)
        if (notes.meddpic.champion) lines.push(`C - Champion: ${notes.meddpic.champion}`)
        if (notes.meddpic.competition) lines.push(`C - Competition: ${notes.meddpic.competition}`)
      }
      await copyToClipboard(lines.join('\n'), 'crm')
    },
    [copyToClipboard]
  )

  const pushSlack = useCallback(
    async (notes: MeetingCrmNotes): Promise<void> => {
      setPushingSlack(true)
      setPushSlackMsg(null)
      try {
        const text =
          `*${notes.title}*\n${notes.executiveSummary}\n\n*Action Items:*\n` +
          notes.actionItems.map((a) => `• ${a.task}${a.owner ? ` (@${a.owner})` : ''}`).join('\n')
        const res = await window.klyro.integrationsSendSlack({ message: text })
        if (res.ok) {
          setPushSlackMsg('Sent!')
        } else {
          setPushSlackMsg(res.error || 'Failed')
        }
      } catch (err) {
        setPushSlackMsg((err as Error).message)
      } finally {
        setPushingSlack(false)
        setTimeout(() => setPushSlackMsg(null), 3500)
      }
    },
    []
  )

  const pushCrm = useCallback(
    async (notes: MeetingCrmNotes): Promise<void> => {
      setPushingCrm(true)
      setPushCrmMsg(null)
      try {
        const payload: Record<string, unknown> = {
          title: notes.title,
          executiveSummary: notes.executiveSummary,
          talkRatio: notes.talkRatio,
          actionItems: notes.actionItems,
          crmInsights: notes.crmInsights,
          meddpic: notes.meddpic
        }
        const res = await window.klyro.integrationsSendCrm({ payload })
        if (res.ok) {
          setPushCrmMsg('Logged!')
        } else {
          setPushCrmMsg(res.error || 'Failed')
        }
      } catch (err) {
        setPushCrmMsg((err as Error).message)
      } finally {
        setPushingCrm(false)
        setTimeout(() => setPushCrmMsg(null), 3500)
      }
    },
    []
  )

  const summarize = useCallback(
    async (id: string): Promise<void> => {
      setBusySummary(true)
      try {
        await window.klyro.interviewsSummarize(id)
        setOpen(await window.klyro.interviewsGet(id))
        await refresh()
      } finally {
        setBusySummary(false)
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

  const filteredSessions = useMemo(() => {
    if (!sessions) return null
    if (typeFilter === 'crm') return sessions.filter((s) => s.hasCrmNotes)
    if (typeFilter === 'bookmarked') return sessions.filter((s) => s.bookmarked)
    return sessions
  }, [sessions, typeFilter])

  const stats = useMemo(() => {
    const list = sessions ?? []
    const totalMeetings = list.length
    const crmCount = list.filter((s) => s.hasCrmNotes).length
    const totalQuestions = list.reduce((sum, s) => sum + s.questionCount, 0)
    const avgDurationMs = totalMeetings > 0 ? list.reduce((sum, s) => sum + s.durationMs, 0) / totalMeetings : 0
    return {
      totalMeetings,
      crmCount,
      totalQuestions,
      avgDuration: duration(avgDurationMs)
    }
  }, [sessions])

  const openActionCounts = useMemo(() => {
    if (!open?.crmNotes) return { done: 0, total: 0 }
    const total = open.crmNotes.actionItems.length
    const done = open.crmNotes.actionItems.filter((a) => a.done).length
    return { done, total }
  }, [open])

  const filteredGlobalActions = useMemo(() => {
    let list = globalActions
    if (actionFilter === 'open') list = list.filter((a) => !a.done)
    if (actionFilter === 'done') list = list.filter((a) => a.done)
    if (search.trim()) {
      const query = search.trim().toLowerCase()
      list = list.filter(
        (a) =>
          a.task.toLowerCase().includes(query) ||
          (a.owner && a.owner.toLowerCase().includes(query)) ||
          a.sessionTitle.toLowerCase().includes(query)
      )
    }
    return list
  }, [globalActions, actionFilter, search])

  const pendingGlobalCount = useMemo(() => globalActions.filter((a) => !a.done).length, [globalActions])

  return (
    <>
      <PageHeader
        title="Meetings & Interviews"
        description="Private meeting intelligence: instant CRM notes, MEDDPIC sales deals, interactive action items hub, and follow-up emails — all running 100% locally."
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

      {/* Top Intelligence Stats Strip */}
      {sessions && sessions.length > 0 && (
        <div className="crm-stats-grid">
          <div className="crm-stat-card">
            <span className="crm-stat-value">{stats.totalMeetings}</span>
            <span className="crm-stat-label">Total Meetings</span>
          </div>
          <div className="crm-stat-card">
            <span className="crm-stat-value" style={{ color: 'var(--accent)' }}>
              {stats.crmCount}
            </span>
            <span className="crm-stat-label">CRM Notes Ready</span>
          </div>
          <div className="crm-stat-card">
            <span className="crm-stat-value" style={{ color: 'var(--status-ok)' }}>
              {stats.totalQuestions}
            </span>
            <span className="crm-stat-label">Questions Handled</span>
          </div>
          <div className="crm-stat-card">
            <span className="crm-stat-value">{stats.avgDuration}</span>
            <span className="crm-stat-label">Avg Meeting Time</span>
          </div>
        </div>
      )}

      {/* Top-Level Navigation Switcher */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button
          className={`btn btn--sm ${viewMode === 'sessions' ? 'btn--primary' : 'btn--quiet'}`}
          onClick={() => setViewMode('sessions')}
        >
          <Database className="icon icon--xs" aria-hidden="true" />
          <span>Meetings Archive ({sessions?.length ?? 0})</span>
        </button>
        <button
          className={`btn btn--sm ${viewMode === 'action_items' ? 'btn--primary' : 'btn--quiet'}`}
          onClick={() => setViewMode('action_items')}
        >
          <ListTodo className="icon icon--xs" aria-hidden="true" />
          <span>Global Action Items</span>
          {pendingGlobalCount > 0 && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                background: 'var(--accent)',
                color: '#fff',
                padding: '1px 6px',
                borderRadius: 999
              }}
            >
              {pendingGlobalCount} open
            </span>
          )}
        </button>
      </div>

      {/* MODE 1: GLOBAL ACTION ITEMS HUB */}
      {viewMode === 'action_items' && (
        <Group
          title="Global Deliverables Hub"
          description={`Aggregated action items from all meetings (${globalActions.length} total · ${pendingGlobalCount} pending)`}
          icon={ListTodo}
          actions={
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className={`btn btn--xs ${actionFilter === 'open' ? 'btn--primary' : 'btn--quiet'}`}
                onClick={() => setActionFilter('open')}
              >
                Open ({pendingGlobalCount})
              </button>
              <button
                className={`btn btn--xs ${actionFilter === 'done' ? 'btn--primary' : 'btn--quiet'}`}
                onClick={() => setActionFilter('done')}
              >
                Completed ({globalActions.filter((a) => a.done).length})
              </button>
              <button
                className={`btn btn--xs ${actionFilter === 'all' ? 'btn--primary' : 'btn--quiet'}`}
                onClick={() => setActionFilter('all')}
              >
                All ({globalActions.length})
              </button>
            </div>
          }
        >
          <div style={{ marginBottom: 14 }}>
            <div className="field">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Search className="icon icon--xs" aria-hidden="true" />
                <input
                  value={search}
                  placeholder="Filter deliverables by task, owner (@John), or meeting title…"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </div>

          {loadingGlobalActions ? (
            <div className="loading-line">Loading deliverables across all meetings…</div>
          ) : filteredGlobalActions.length === 0 ? (
            <EmptyState
              icon={CheckSquare}
              title={actionFilter === 'open' ? 'All caught up!' : 'No deliverables found'}
              text={
                actionFilter === 'open'
                  ? 'There are no pending action items across any recorded meetings.'
                  : 'Try selecting a different filter or generate CRM notes from meetings to track deliverables.'
              }
            />
          ) : (
            <div className="crm-action-hub-table">
              {filteredGlobalActions.map((item) => (
                <div
                  key={`${item.sessionId}-${item.taskIndex}`}
                  className={`crm-action-hub-row ${item.done ? 'crm-action-hub-row--done' : ''}`}
                >
                  <div
                    className={`crm-action-checkbox ${item.done ? 'crm-action-checkbox--checked' : ''}`}
                    onClick={() => void toggleGlobalActionItem(item.sessionId, item.taskIndex)}
                    role="checkbox"
                    aria-checked={item.done}
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                  >
                    {item.done && <Check className="icon icon--xs" />}
                  </div>
                  <span className="crm-action-text">{item.task}</span>
                  {item.owner && <Badge tone="idle">@{item.owner}</Badge>}
                  {item.deadline && <Badge tone="warn">Due: {item.deadline}</Badge>}
                  <button
                    type="button"
                    className="btn btn--quiet btn--xs"
                    onClick={() => void openSession(item.sessionId)}
                    title="Jump to this meeting"
                    style={{ marginLeft: 'auto' }}
                  >
                    <span>{item.sessionTitle}</span>
                    <ArrowRight className="icon icon--xs" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Group>
      )}

      {/* MODE 2: SPLIT SESSIONS & CRM DETAIL VIEW */}
      {viewMode === 'sessions' && (
        <div className="split">
          <div>
            <Group title="Session Archive" description={`${sessions?.length ?? 0} meetings recorded`} flush>
              <div style={{ padding: '12px 16px' }}>
                {/* Filter Pills */}
                <div className="crm-type-pills">
                  <button
                    type="button"
                    className={`crm-type-pill ${typeFilter === 'all' ? 'crm-type-pill--active' : ''}`}
                    onClick={() => setTypeFilter('all')}
                  >
                    All ({sessions?.length ?? 0})
                  </button>
                  <button
                    type="button"
                    className={`crm-type-pill ${typeFilter === 'crm' ? 'crm-type-pill--active' : ''}`}
                    onClick={() => setTypeFilter('crm')}
                  >
                    <Sparkles className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                    CRM Notes ({stats.crmCount})
                  </button>
                  <button
                    type="button"
                    className={`crm-type-pill ${typeFilter === 'bookmarked' ? 'crm-type-pill--active' : ''}`}
                    onClick={() => setTypeFilter('bookmarked')}
                  >
                    <Bookmark className="icon icon--xs" style={{ color: 'var(--warning)' }} />
                    Bookmarked
                  </button>
                </div>

                {/* Deep Search & dropdowns */}
                <div className="interviews__filters" style={{ marginBottom: 12 }}>
                  <div className="field" style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Search className="icon icon--xs" aria-hidden="true" />
                      <input
                        value={search}
                        placeholder="Search transcripts, CRM notes, MEDDPIC, tasks…"
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
                </div>

                {error && (
                  <div className="notice notice--error" style={{ marginBottom: 12 }}>
                    <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
                    <span className="notice__body">{error}</span>
                  </div>
                )}

                {filteredSessions === null ? (
                  <div className="loading-line">Loading sessions…</div>
                ) : filteredSessions.length === 0 ? (
                  <EmptyState
                    icon={Clock}
                    title="No sessions match"
                    text="Start an audio session with “Listen to meeting” in the overlay, and automated CRM notes will appear here."
                  />
                ) : (
                  <div className="interviews__list">
                    {filteredSessions.map((session) => (
                      <button
                        key={session.id}
                        className={`interviews__row${openId === session.id ? ' interviews__row--active' : ''}`}
                        onClick={() => (openId === session.id ? setOpenId(null) : void openSession(session.id))}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="interviews__title">
                            <span style={{ fontSize: 14 }}>{session.hasCrmNotes ? '💼' : '🎙️'}</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {session.company || 'Meeting Session'}
                              {session.role ? ` · ${session.role}` : ''}
                            </span>
                            {session.bookmarked && (
                              <Bookmark
                                className="icon icon--xs"
                                style={{ color: 'var(--warning)', flexShrink: 0 }}
                                aria-hidden="true"
                              />
                            )}
                          </div>
                          <div className="interviews__meta">
                            <span>{when(session.startedAt)}</span>
                            <span>·</span>
                            <span>{duration(session.durationMs)}</span>
                            {session.hasCrmNotes ? (
                              <Badge tone="accent">CRM Ready</Badge>
                            ) : (
                              <Badge tone="idle">{session.questionCount} questions</Badge>
                            )}
                            {session.stage && <Badge>{KIND_LABEL[session.stage] ?? session.stage}</Badge>}
                            {session.ephemeral && <Badge tone="idle">Not saved</Badge>}
                          </div>
                          {session.preview && <div className="interviews__preview">{session.preview}</div>}
                        </div>
                        <div className="interviews__progress" title={`${session.progress}% answered`}>
                          <div
                            className="interviews__progress-bar"
                            style={{ width: `${Math.max(10, session.progress)}%` }}
                          />
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
                  title="Select a meeting to view CRM intelligence"
                  text="Pick a session on the left to review executive summaries, MEDDPIC sales deals, action items, customer insights, and follow-up email drafts."
                />
              </Group>
            ) : (
              <Group
                title={`${open.crmNotes?.title || open.company || 'Meeting Session'}${open.role ? ` · ${open.role}` : ''}`}
                description={`${when(open.startedAt)} · ${duration(open.durationMs)} · ${open.transcript.length} transcript lines`}
                icon={FileText}
                actions={
                  <>
                    <button className="btn btn--ghost btn--sm" onClick={() => void toggleBookmark(open.id)}>
                      <Bookmark
                        className="icon icon--xs"
                        style={open.bookmarked ? { color: 'var(--warning)' } : undefined}
                        aria-hidden="true"
                      />
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
                      This session is held in memory only: it is not written to disk, and will be cleared when Klyro
                      quits.
                    </span>
                  </div>
                )}

                {/* View Tabs */}
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    borderBottom: '1px solid var(--border-subtle)',
                    paddingBottom: 10,
                    marginBottom: 16
                  }}
                >
                  <button
                    className={`btn btn--sm ${activeTab === 'crm' ? 'btn--primary' : 'btn--quiet'}`}
                    onClick={() => setActiveTab('crm')}
                  >
                    <Sparkles className="icon icon--xs" aria-hidden="true" />
                    <span>Automated CRM Notes</span>
                    {open.crmNotes && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          background: 'rgba(255,255,255,0.2)',
                          padding: '1px 6px',
                          borderRadius: 999
                        }}
                      >
                        ✓ {openActionCounts.done}/{openActionCounts.total}
                      </span>
                    )}
                  </button>
                  <button
                    className={`btn btn--sm ${activeTab === 'qa' ? 'btn--primary' : 'btn--quiet'}`}
                    onClick={() => setActiveTab('qa')}
                  >
                    <MessageSquare className="icon icon--xs" aria-hidden="true" />
                    <span>Q&amp;A &amp; Transcript ({open.questions.length})</span>
                  </button>
                </div>

                {/* TAB 1: Automated CRM Notes */}
                {activeTab === 'crm' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Meeting Type Template Bar */}
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 10,
                        background: 'var(--surface-sunken)',
                        padding: '10px 14px',
                        borderRadius: 8
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                          Template:
                        </span>
                        <select
                          value={meetingType}
                          onChange={(e) => setMeetingType(e.target.value as MeetingType)}
                          style={{
                            fontSize: 13,
                            padding: '4px 10px',
                            borderRadius: 6,
                            background: 'var(--surface-input)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-subtle)'
                          }}
                          aria-label="Meeting Type Template"
                        >
                          {(Object.keys(MEETING_TYPE_LABELS) as MeetingType[]).map((type) => (
                            <option key={type} value={type}>
                              {MEETING_TYPE_LABELS[type].icon} {MEETING_TYPE_LABELS[type].label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        className="btn btn--primary btn--sm"
                        onClick={() => void generateCrmNotes(open.id, meetingType)}
                        disabled={generatingCrm}
                        style={{ marginLeft: 'auto' }}
                      >
                        {generatingCrm ? (
                          <Loader2 className="icon icon--xs spin" aria-hidden="true" />
                        ) : (
                          <Sparkles className="icon icon--xs" aria-hidden="true" />
                        )}
                        <span>{open.crmNotes ? 'Regenerate Notes' : 'Generate CRM Notes'}</span>
                      </button>
                    </div>

                    {open.crmNotes ? (
                      <>
                        {/* Quick export & share toolbar (Slack, Notion, CRM, Markdown, Direct Push) */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <button
                            className="btn btn--quiet btn--sm"
                            onClick={() => void copySlackRecap(open.crmNotes!)}
                            title="Format for Slack or Microsoft Teams"
                          >
                            {copiedKey === 'slack' ? (
                              <Check className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                            ) : (
                              <Share2 className="icon icon--xs" />
                            )}
                            <span>{copiedKey === 'slack' ? 'Copied Slack!' : 'Copy for Slack'}</span>
                          </button>
                          <button
                            className="btn btn--quiet btn--sm"
                            onClick={() => void copyNotion(open.crmNotes!)}
                            title="Format for Notion call database / toggle block"
                          >
                            {copiedKey === 'notion' ? (
                              <Check className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                            ) : (
                              <Database className="icon icon--xs" />
                            )}
                            <span>{copiedKey === 'notion' ? 'Copied Notion!' : 'Copy for Notion'}</span>
                          </button>
                          <button
                            className="btn btn--quiet btn--sm"
                            onClick={() => void copyCrm(open.crmNotes!)}
                            title="Format for Salesforce, HubSpot, or standard CRM deal log"
                          >
                            {copiedKey === 'crm' ? (
                              <Check className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                            ) : (
                              <Briefcase className="icon icon--xs" />
                            )}
                            <span>{copiedKey === 'crm' ? 'Copied CRM!' : 'Copy for CRM'}</span>
                          </button>
                          <button
                            className="btn btn--quiet btn--sm"
                            onClick={() => void exportMarkdown(open.id)}
                            title="Export complete session as Markdown document"
                          >
                            {copiedKey === 'markdown' ? (
                              <Check className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                            ) : (
                              <Download className="icon icon--xs" />
                            )}
                            <span>{copiedKey === 'markdown' ? 'Copied MD!' : 'Export MD'}</span>
                          </button>

                          {/* Direct 1-Click Push Channels */}
                          <div style={{ height: 16, width: 1, background: 'var(--border-subtle)', margin: '0 2px' }} />

                          <button
                            className="btn btn--quiet btn--sm"
                            onClick={() => void pushSlack(open.crmNotes!)}
                            disabled={pushingSlack}
                            title="Dispatch directly to configured Slack Incoming Webhook"
                            style={{ color: pushSlackMsg === 'Sent!' ? 'var(--status-ok)' : undefined }}
                          >
                            {pushingSlack ? (
                              <Loader2 className="icon icon--xs spin" />
                            ) : pushSlackMsg === 'Sent!' ? (
                              <Check className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                            ) : (
                              <Zap className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                            )}
                            <span>{pushSlackMsg || 'Push to Slack'}</span>
                          </button>

                          <button
                            className="btn btn--quiet btn--sm"
                            onClick={() => void pushCrm(open.crmNotes!)}
                            disabled={pushingCrm}
                            title="Dispatch directly to configured CRM Webhook (HubSpot / Salesforce)"
                            style={{ color: pushCrmMsg === 'Logged!' ? 'var(--status-ok)' : undefined }}
                          >
                            {pushingCrm ? (
                              <Loader2 className="icon icon--xs spin" />
                            ) : pushCrmMsg === 'Logged!' ? (
                              <Check className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                            ) : (
                              <Briefcase className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                            )}
                            <span>{pushCrmMsg || 'Push to CRM'}</span>
                          </button>

                          {open.crmNotes.model && (
                            <div
                              style={{
                                marginLeft: 'auto',
                                fontSize: 11,
                                color: 'var(--text-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4
                              }}
                            >
                              <Zap className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                              <span>Model: {open.crmNotes.model}</span>
                            </div>
                          )}
                        </div>

                        {/* Talk-Time Dynamics & Audio Cadence Graph */}
                        {open.crmNotes.talkRatio && (
                          <div className="crm-talk-meter-container">
                            <div className="crm-talk-meter-header">
                              <div className="crm-talk-meter-title-wrap">
                                <div className="crm-talk-meter-icon-pill">
                                  <TrendingUp className="icon icon--xs" />
                                </div>
                                <div>
                                  <div className="crm-talk-meter-title">Conversation Dynamics &amp; Talk Ratio</div>
                                  <div className="crm-talk-meter-sub">AI Diarized Speaking Balance &amp; Pacing Coach</div>
                                </div>
                              </div>
                              <Badge tone={open.crmNotes.talkRatio.userPct > 60 ? 'warn' : 'ok'}>
                                {open.crmNotes.talkRatio.userPct > 60 ? '⚠️ ' : '⚡ '}
                                {open.crmNotes.talkRatio.pacingNote}
                              </Badge>
                            </div>

                            {/* Stacked Gradient Visualizer Bar */}
                            <div
                              className="crm-talk-meter-bar"
                              title={`You: ${open.crmNotes.talkRatio.userPct}%, Attendees: ${open.crmNotes.talkRatio.othersPct}%`}
                            >
                              <div
                                className="crm-talk-meter-user"
                                style={{ width: `${Math.max(12, open.crmNotes.talkRatio.userPct)}%` }}
                              >
                                You {open.crmNotes.talkRatio.userPct}%
                              </div>
                              <div className="crm-talk-meter-divider" />
                              <div
                                className="crm-talk-meter-others"
                                style={{ width: `${Math.max(12, open.crmNotes.talkRatio.othersPct)}%` }}
                              >
                                Attendees {open.crmNotes.talkRatio.othersPct}%
                              </div>
                            </div>

                            {/* Metric Chips with Glowing Dots and Ideal Ranges */}
                            <div className="crm-talk-chips-row">
                              <div className="crm-talk-chip">
                                <span className="crm-talk-dot crm-talk-dot--user" />
                                <span>Your Speaking Share:</span>
                                <span className="crm-talk-chip-strong">{open.crmNotes.talkRatio.userPct}%</span>
                                <span className="crm-talk-chip-hint">(Ideal: 35–45% for pitch/discovery)</span>
                              </div>

                              <div className="crm-talk-chip">
                                <span className="crm-talk-dot crm-talk-dot--others" />
                                <span>Prospect / Client Share:</span>
                                <span className="crm-talk-chip-strong">{open.crmNotes.talkRatio.othersPct}%</span>
                                <span className="crm-talk-chip-hint">(Ideal: 55–65% active listening)</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Executive Summary Hero Card */}
                        <div className="crm-card crm-card--hero">
                          <div className="crm-card-header">
                            <h4 className="crm-card-title">
                              <Sparkles className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                              <span>Executive Summary</span>
                            </h4>
                            <button
                              type="button"
                              className="btn btn--icon btn--icon-sm btn--quiet"
                              onClick={() => void copyToClipboard(open.crmNotes!.executiveSummary, 'summary')}
                              title="Copy summary"
                            >
                              {copiedKey === 'summary' ? (
                                <Check className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                              ) : (
                                <Copy className="icon icon--xs" />
                              )}
                            </button>
                          </div>
                          <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)' }}>
                            {open.crmNotes.executiveSummary}
                          </div>
                        </div>

                        {/* MEDDPIC Deal Qualification Block */}
                        {open.crmNotes.meddpic && (
                          <div className="crm-card">
                            <div className="crm-card-header">
                              <h4 className="crm-card-title">
                                <Award className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                                <span>MEDDPIC Enterprise Sales Deal Framework</span>
                              </h4>
                            </div>
                            <div className="crm-meddpic-grid">
                              {open.crmNotes.meddpic.metrics && (
                                <div className="crm-meddpic-card">
                                  <div className="crm-meddpic-label">M · Metrics (ROI)</div>
                                  <div className="crm-meddpic-val">{open.crmNotes.meddpic.metrics}</div>
                                </div>
                              )}
                              {open.crmNotes.meddpic.economicBuyer && (
                                <div className="crm-meddpic-card">
                                  <div className="crm-meddpic-label">E · Economic Buyer</div>
                                  <div className="crm-meddpic-val">{open.crmNotes.meddpic.economicBuyer}</div>
                                </div>
                              )}
                              {open.crmNotes.meddpic.decisionCriteria && (
                                <div className="crm-meddpic-card">
                                  <div className="crm-meddpic-label">D · Decision Criteria</div>
                                  <div className="crm-meddpic-val">{open.crmNotes.meddpic.decisionCriteria}</div>
                                </div>
                              )}
                              {open.crmNotes.meddpic.decisionProcess && (
                                <div className="crm-meddpic-card">
                                  <div className="crm-meddpic-label">D · Decision Process</div>
                                  <div className="crm-meddpic-val">{open.crmNotes.meddpic.decisionProcess}</div>
                                </div>
                              )}
                              {open.crmNotes.meddpic.painPoints && (
                                <div className="crm-meddpic-card">
                                  <div className="crm-meddpic-label" style={{ color: 'var(--danger)' }}>P · Identified Pain</div>
                                  <div className="crm-meddpic-val">{open.crmNotes.meddpic.painPoints}</div>
                                </div>
                              )}
                              {open.crmNotes.meddpic.champion && (
                                <div className="crm-meddpic-card">
                                  <div className="crm-meddpic-label" style={{ color: 'var(--status-ok)' }}>C · Internal Champion</div>
                                  <div className="crm-meddpic-val">{open.crmNotes.meddpic.champion}</div>
                                </div>
                              )}
                              {open.crmNotes.meddpic.competition && (
                                <div className="crm-meddpic-card">
                                  <div className="crm-meddpic-label" style={{ color: 'var(--warning)' }}>C · Competition</div>
                                  <div className="crm-meddpic-val">{open.crmNotes.meddpic.competition}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Interactive Action Items Checklist */}
                        <div className="crm-card">
                          <div className="crm-card-header">
                            <h4 className="crm-card-title">
                              <CheckSquare className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                              <span>Action Items &amp; Deliverables</span>
                              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>
                                ({openActionCounts.done}/{openActionCounts.total} completed)
                              </span>
                            </h4>
                          </div>

                          <div className="crm-actions-list">
                            {open.crmNotes.actionItems.map((item, idx) => (
                              <div
                                key={idx}
                                className={`crm-action-row ${item.done ? 'crm-action-row--done' : ''}`}
                                onClick={() => void toggleActionItem(idx)}
                                role="checkbox"
                                aria-checked={item.done}
                                tabIndex={0}
                              >
                                <div
                                  className={`crm-action-checkbox ${item.done ? 'crm-action-checkbox--checked' : ''}`}
                                >
                                  {item.done && <Check className="icon icon--xs" />}
                                </div>
                                <span className="crm-action-text">{item.task}</span>
                                {item.owner && <Badge tone="idle">@{item.owner}</Badge>}
                                {item.deadline && <Badge tone="warn">Due: {item.deadline}</Badge>}
                              </div>
                            ))}
                          </div>

                          {/* Inline add action item */}
                          <div className="crm-add-action">
                            <input
                              type="text"
                              placeholder="Add a new action item or follow-up task…"
                              value={newActionText}
                              onChange={(e) => setNewActionText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void addActionItem()
                              }}
                            />
                            <button
                              type="button"
                              className="btn btn--quiet btn--sm"
                              onClick={() => void addActionItem()}
                              disabled={!newActionText.trim()}
                            >
                              <Plus className="icon icon--xs" />
                              <span>Add</span>
                            </button>
                          </div>
                        </div>

                        {/* Key Decisions Made */}
                        {open.crmNotes.keyDecisions.length > 0 && (
                          <div className="crm-card">
                            <h4 className="crm-card-title">
                              <Target className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                              <span>Key Decisions Made</span>
                            </h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {open.crmNotes.keyDecisions.map((decision, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 8,
                                    fontSize: 13,
                                    lineHeight: 1.5
                                  }}
                                >
                                  <CheckCircle2
                                    className="icon icon--xs"
                                    style={{ color: 'var(--status-ok)', marginTop: 3, flexShrink: 0 }}
                                  />
                                  <span>{decision}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Commercial & CRM Insights Grid */}
                        {open.crmNotes.crmInsights && (
                          <div className="crm-card" style={{ background: 'var(--surface-sunken)' }}>
                            <h4 className="crm-card-title">
                              <Briefcase className="icon icon--xs" style={{ color: 'var(--info)' }} />
                              <span>Commercial &amp; Strategic Insights</span>
                            </h4>
                            <div className="crm-insights-grid">
                              {open.crmNotes.crmInsights.clientNeeds &&
                                open.crmNotes.crmInsights.clientNeeds.length > 0 && (
                                  <div className="crm-insight-card">
                                    <div className="crm-insight-card-title" style={{ color: 'var(--info)' }}>
                                      <Target className="icon icon--xs" />
                                      <span>Customer Needs</span>
                                    </div>
                                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.4 }}>
                                      {open.crmNotes.crmInsights.clientNeeds.map((need, idx) => (
                                        <li key={idx}>{need}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                              {open.crmNotes.crmInsights.objectionsOrRisks &&
                                open.crmNotes.crmInsights.objectionsOrRisks.length > 0 && (
                                  <div className="crm-insight-card">
                                    <div className="crm-insight-card-title" style={{ color: 'var(--danger)' }}>
                                      <ShieldAlert className="icon icon--xs" />
                                      <span>Objections &amp; Blockers</span>
                                    </div>
                                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.4 }}>
                                      {open.crmNotes.crmInsights.objectionsOrRisks.map((risk, idx) => (
                                        <li key={idx}>{risk}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                              {open.crmNotes.crmInsights.budgetTimeline && (
                                <div className="crm-insight-card">
                                  <div className="crm-insight-card-title" style={{ color: 'var(--status-ok)' }}>
                                    <DollarSign className="icon icon--xs" />
                                    <span>Budget &amp; Timeline</span>
                                  </div>
                                  <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                                    {open.crmNotes.crmInsights.budgetTimeline}
                                  </div>
                                </div>
                              )}

                              {open.crmNotes.crmInsights.nextSteps && (
                                <div className="crm-insight-card">
                                  <div className="crm-insight-card-title" style={{ color: 'var(--accent)' }}>
                                    <ArrowRight className="icon icon--xs" />
                                    <span>Agreed Next Steps</span>
                                  </div>
                                  <div style={{ fontSize: 13, lineHeight: 1.4, fontWeight: 500 }}>
                                    {open.crmNotes.crmInsights.nextSteps}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Ready-to-send Follow-up Email */}
                        {open.crmNotes.followUpEmail && (
                          <div className="crm-card">
                            <div className="crm-card-header">
                              <h4 className="crm-card-title">
                                <Mail className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                                <span>Ready-to-send Follow-up Email</span>
                              </h4>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className="btn btn--quiet btn--sm"
                                  onClick={() => void copyToClipboard(open.crmNotes!.followUpEmail!, 'email')}
                                >
                                  {copiedKey === 'email' ? (
                                    <Check className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                                  ) : (
                                    <Copy className="icon icon--xs" />
                                  )}
                                  <span>{copiedKey === 'email' ? 'Copied Email!' : 'Copy Draft'}</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--quiet btn--sm"
                                  onClick={() => openMailClient(open.crmNotes!)}
                                  title="Open in default mail client"
                                >
                                  <ExternalLink className="icon icon--xs" />
                                  <span>Mail App</span>
                                </button>
                              </div>
                            </div>
                            <div className="crm-email-box">{open.crmNotes.followUpEmail}</div>
                          </div>
                        )}
                      </>
                    ) : (
                      <EmptyState
                        icon={Sparkles}
                        title="No CRM notes generated yet"
                        text="Select a meeting template above and click “Generate CRM Notes” to create an executive summary, MEDDPIC deal analysis, interactive action items, and a follow-up email from this session."
                      />
                    )}
                  </div>
                )}

                {/* TAB 2: Questions, Legacy Summary, Transcript */}
                {activeTab === 'qa' && (
                  <div>
                    <div className="row" style={{ marginBottom: 12 }}>
                      <button
                        className="btn btn--primary btn--sm"
                        onClick={() => void summarize(open.id)}
                        disabled={busySummary}
                      >
                        {busySummary ? (
                          <Loader2 className="icon icon--xs spin" aria-hidden="true" />
                        ) : (
                          <Sparkles className="icon icon--xs" aria-hidden="true" />
                        )}
                        <span>{open.summary ? 'Write it again' : 'Summarise Interview'}</span>
                      </button>
                    </div>

                    {open.summary && (
                      <div className="notice notice--info" style={{ marginBottom: 16 }}>
                        <span className="icon icon--sm notice__icon" aria-hidden="true">
                          <FileText />
                        </span>
                        <span className="notice__body" style={{ whiteSpace: 'pre-wrap' }}>
                          {open.summary}
                        </span>
                      </div>
                    )}

                    {open.context.length > 0 && (
                      <div style={{ marginTop: 16, marginBottom: 16 }}>
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
                      <h4 className="section-label">Questions &amp; Answers ({open.questions.length})</h4>
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
                              onChange={(event) =>
                                setNoteDraft((draft) => ({ ...draft, [question.id]: event.target.value }))
                              }
                              onBlur={() => void saveNote(open.id, question.id)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    {open.transcript.length > 0 && (
                      <details style={{ marginTop: 16 }} open>
                        <summary className="hint" style={{ cursor: 'pointer', fontWeight: 600 }}>
                          Live Audio Transcript ({open.transcript.length} lines)
                        </summary>
                        <div
                          className="interviews__transcript"
                          style={{ maxHeight: 300, overflowY: 'auto', marginTop: 8 }}
                        >
                          {open.transcript.map((line, index) => (
                            <div key={index}>{line}</div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </Group>
            )}
          </div>
        </div>
      )}
    </>
  )
}
