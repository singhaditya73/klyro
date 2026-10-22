import { randomUUID } from 'node:crypto'
import type {
  InterviewContextNote,
  InterviewQuery,
  InterviewSession,
  InterviewSummary,
  QuestionKind
} from '@shared/types'
import { logger } from '../logger'
import { JsonStore } from '../store/json-store'
import { classifyQuestion, extractContext, toSummary } from './interview-model'
import { configuredCutoff } from './retention'
import { settingsDomain } from './settings'

interface InterviewsFile {
  interviews: InterviewSession[]
}

/** How a session is kept. */
export interface StartOptions {
  /**
   * Held in memory only. Nothing about it — the company, the questions, the
   * answers, the transcript — is written to a file, and it is gone when Klyro
   * quits. Defaults to the user's setting.
   */
  ephemeral?: boolean
}

/**
 * Interview history.
 *
 * Everything stays on this machine: the questions, the answers, the
 * transcript and the notes. A session can be *ephemeral* — recorded, used and
 * never written down — which is the right default for anything the user would
 * rather not have on disk. Ephemeral sessions are held in this process's
 * memory and are unreachable from every other surface: they are not in the
 * history file, so no file left behind can be read later.
 *
 * Retention is a setting, not a suggestion: `prune` deletes what is older than
 * the policy, and it runs at startup and whenever a session begins.
 */
class InterviewsDomain {
  private readonly store = new JsonStore<InterviewsFile>('interviews.json', { interviews: [] })

  /** The sessions that must never reach the disk. */
  private readonly live = new Map<string, InterviewSession>()

  /** Every session: the ones in memory first, then the ones on disk. */
  private all(): InterviewSession[] {
    return [...this.live.values(), ...this.store.get().interviews]
  }

  /** Every session, newest first. */
  list(query: InterviewQuery = {}): InterviewSummary[] {
    return this.all()
      .filter((session) => this.matches(session, query))
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(toSummary)
  }

  get(id: string): InterviewSession | null {
    return this.live.get(id) ?? this.store.get().interviews.find((session) => session.id === id) ?? null
  }

  /** How many sessions are held in memory only. */
  ephemeralCount(): number {
    return this.live.size
  }

  /** How many sessions are on disk. */
  storedCount(): number {
    return this.store.get().interviews.length
  }

  /** Start a session. */
  start(company = '', role = '', options: StartOptions = {}): InterviewSession {
    const now = Date.now()
    const ephemeral = options.ephemeral ?? settingsDomain.get().interviewEphemeralDefault === true
    const session: InterviewSession = {
      id: randomUUID(),
      company: company.trim(),
      role: role.trim(),
      startedAt: now,
      endedAt: now,
      durationMs: 0,
      questions: [],
      transcript: [],
      answers: [],
      notes: '',
      summary: '',
      tags: [],
      bookmarked: false,
      context: [],
      ephemeral
    }
    if (ephemeral) {
      this.live.set(session.id, session)
    } else {
      this.store.update((draft) => {
        draft.interviews.unshift(session)
      })
      this.prune()
    }
    return session
  }

  /**
   * Add a question, and the answer that came back.
   *
   * An ephemeral session is not written down: it is answered, and then it is
   * gone.
   */
  addQuestion(
    id: string,
    question: { text: string; source: 'voice' | 'text'; answer?: string; answerMs?: number }
  ): InterviewSession | null {
    const write = (session: InterviewSession): void => {
      const kind = classifyQuestion(question.text)
      session.questions.push({
        id: randomUUID(),
        text: question.text,
        source: question.source,
        askedAt: Date.now(),
        kind,
        progress: question.answer ? 'answered' : 'asked',
        answer: question.answer ?? '',
        answeredAt: question.answer ? Date.now() : undefined,
        answerMs: question.answerMs,
        note: '',
        bookmarked: false
      })
      if (question.answer) session.answers.push(question.answer)
      session.endedAt = Date.now()
      session.durationMs = session.endedAt - session.startedAt
    }

    const live = this.live.get(id)
    if (live) {
      write(live)
      return live
    }

    let result: InterviewSession | null = null
    this.store.update((draft) => {
      const session = draft.interviews.find((entry) => entry.id === id)
      if (!session) return
      write(session)
      result = session
    })
    return result
  }

  /** Add a line to the live transcript. */
  addTranscript(id: string, line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    const write = (session: InterviewSession): void => {
      session.transcript.push(trimmed)
      // Keep the transcript from growing without end in a long meeting.
      if (session.transcript.length > 400) session.transcript.splice(0, session.transcript.length - 400)
      // The decisions and terms are picked up as they are said.
      const notes = extractContext([trimmed])
      for (const note of notes) {
        if (!session.context.some((existing) => existing.text === note.text)) {
          session.context.push(note as InterviewContextNote)
        }
      }
      if (session.context.length > 12) session.context.splice(0, session.context.length - 12)
      session.endedAt = Date.now()
      session.durationMs = session.endedAt - session.startedAt
    }

    const live = this.live.get(id)
    if (live) {
      write(live)
      return
    }
    this.store.update((draft) => {
      const session = draft.interviews.find((entry) => entry.id === id)
      if (session) write(session)
    })
  }

  /** The decisions and terms remembered so far. */
  context(id: string): InterviewContextNote[] {
    return this.get(id)?.context ?? []
  }

  /** Update the details of a session. */
  update(id: string, patch: Partial<InterviewSession>): InterviewSession | null {
    // A session that is not written down must not be made writeable by a
    // patch: `ephemeral` is fixed when the session starts.
    const safe = { ...patch }
    delete safe.ephemeral
    delete safe.id
    delete safe.startedAt

    const live = this.live.get(id)
    if (live) {
      Object.assign(live, safe)
      live.endedAt = Date.now()
      live.durationMs = live.endedAt - live.startedAt
      return live
    }

    let updated: InterviewSession | null = null
    this.store.update((draft) => {
      const session = draft.interviews.find((entry) => entry.id === id)
      if (!session) return
      Object.assign(session, safe)
      session.endedAt = Date.now()
      session.durationMs = session.endedAt - session.startedAt
      updated = session
    })
    return updated
  }

  /** Update one question. */
  updateQuestion(
    id: string,
    questionId: string,
    patch: Partial<InterviewSession['questions'][number]>
  ): void {
    const live = this.live.get(id)
    if (live) {
      const question = live.questions.find((entry) => entry.id === questionId)
      if (question) Object.assign(question, patch)
      return
    }
    this.store.update((draft) => {
      const session = draft.interviews.find((entry) => entry.id === id)
      const question = session?.questions.find((entry) => entry.id === questionId)
      if (!question) return
      Object.assign(question, patch)
    })
  }

  /** Bookmark a session, or a question in it. */
  toggleBookmark(id: string, questionId?: string): void {
    const flip = (session: InterviewSession): void => {
      if (questionId) {
        const question = session.questions.find((entry) => entry.id === questionId)
        if (question) question.bookmarked = !question.bookmarked
        return
      }
      session.bookmarked = !session.bookmarked
    }

    const live = this.live.get(id)
    if (live) {
      flip(live)
      return
    }
    this.store.update((draft) => {
      const session = draft.interviews.find((entry) => entry.id === id)
      if (session) flip(session)
    })
  }

  /**
   * Write an ephemeral session down: the user decided, afterwards, that this
   * one was worth keeping. It stops being private the moment it lands on disk,
   * and the history says so.
   */
  keep(id: string): InterviewSession | null {
    const live = this.live.get(id)
    if (!live) return this.get(id)
    const session: InterviewSession = { ...live, ephemeral: false }
    this.live.delete(id)
    this.store.update((draft) => {
      draft.interviews.unshift(session)
    })
    return session
  }

  /** Forget one session. */
  remove(id: string): void {
    this.live.delete(id)
    this.store.update((draft) => {
      draft.interviews = draft.interviews.filter((session) => session.id !== id)
    })
  }

  /** Forget every session, including the ones held in memory. */
  clear(): void {
    this.live.clear()
    this.store.set({ interviews: [] })
  }

  /** Drop the sessions held in memory. Called when Klyro quits. */
  forgetEphemeral(): void {
    this.live.clear()
  }

  /**
   * Apply the retention policy. Returns how many sessions were deleted.
   *
   * The sessions in memory are not affected: they are already gone when the
   * process ends, and they are not the thing a retention policy is about.
   */
  prune(now = Date.now()): number {
    const days = settingsDomain.get().retentionDays
    const cutoff = configuredCutoff(now)
    if (cutoff === null) return 0
    let removed = 0
    this.store.update((draft) => {
      const kept = draft.interviews.filter((session) => session.startedAt >= cutoff)
      removed = draft.interviews.length - kept.length
      draft.interviews = kept
    })
    if (removed > 0) {
      logger.info(`Retention: forgot ${removed} interview session(s) older than ${days} day(s)`)
    }
    return removed
  }

  /** The companies and roles, for the filters. */
  facets(): { companies: string[]; roles: string[]; kinds: QuestionKind[] } {
    const sessions = this.all()
    const companies = new Set<string>()
    const roles = new Set<string>()
    const kinds = new Set<QuestionKind>()
    for (const session of sessions) {
      if (session.company) companies.add(session.company)
      if (session.role) roles.add(session.role)
      for (const question of session.questions) kinds.add(question.kind)
    }
    return {
      companies: [...companies].sort(),
      roles: [...roles].sort(),
      kinds: [...kinds]
    }
  }

  private matches(session: InterviewSession, query: InterviewQuery): boolean {
    if (query.bookmarked && !session.bookmarked) return false
    if (query.company && session.company !== query.company) return false
    if (query.role && session.role !== query.role) return false
    if (query.kind && !session.questions.some((question) => question.kind === query.kind)) return false
    if (query.since && session.startedAt < query.since) return false
    const needle = (query.search ?? '').trim().toLowerCase()
    if (!needle) return true
    return (
      session.company.toLowerCase().includes(needle) ||
      session.role.toLowerCase().includes(needle) ||
      session.notes.toLowerCase().includes(needle) ||
      session.summary.toLowerCase().includes(needle) ||
      session.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
      session.questions.some(
        (question) =>
          question.text.toLowerCase().includes(needle) || question.answer.toLowerCase().includes(needle)
      ) ||
      session.transcript.some((line) => line.toLowerCase().includes(needle))
    )
  }
}

export const interviews = new InterviewsDomain()
