import { randomUUID } from 'node:crypto'
import type {
  InterviewContextNote,
  InterviewQuery,
  InterviewSession,
  InterviewSummary,
  QuestionKind
} from '@shared/types'
import { JsonStore } from '../store/json-store'
import { classifyQuestion, extractContext, toSummary } from './interview-model'

interface InterviewsFile {
  interviews: InterviewSession[]
}

/**
 * Interview history.
 *
 * Everything stays on this machine: the questions, the answers, the
 * transcript and the notes. A session can also be *ephemeral* — recorded,
 * used and never written down — which is the right default for anything the
 * user would rather not have on disk.
 */
class InterviewsDomain {
  private readonly store = new JsonStore<InterviewsFile>('interviews.json', { interviews: [] })

  /** Every session, newest first. */
  list(query: InterviewQuery = {}): InterviewSummary[] {
    const sessions = this.store.get().interviews
    return sessions
      .filter((session) => this.matches(session, query))
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(toSummary)
  }

  get(id: string): InterviewSession | null {
    return this.store.get().interviews.find((session) => session.id === id) ?? null
  }

  /** Start a session. */
  start(company = '', role = ''): InterviewSession {
    const now = Date.now()
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
      ephemeral: false
    }
    this.store.update((draft) => {
      draft.interviews.unshift(session)
    })
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
    let result: InterviewSession | null = null
    this.store.update((draft) => {
      const session = draft.interviews.find((entry) => entry.id === id)
      if (!session) return
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
      result = session
    })
    return result
  }

  /** Add a line to the live transcript. */
  addTranscript(id: string, line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    this.store.update((draft) => {
      const session = draft.interviews.find((entry) => entry.id === id)
      if (!session) return
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
    })
  }

  /** The decisions and terms remembered so far. */
  context(id: string): InterviewContextNote[] {
    return this.get(id)?.context ?? []
  }

  /** Update the details of a session. */
  update(id: string, patch: Partial<InterviewSession>): InterviewSession | null {
    let updated: InterviewSession | null = null
    this.store.update((draft) => {
      const session = draft.interviews.find((entry) => entry.id === id)
      if (!session) return
      Object.assign(session, patch)
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
    this.store.update((draft) => {
      const session = draft.interviews.find((entry) => entry.id === id)
      const question = session?.questions.find((entry) => entry.id === questionId)
      if (!question) return
      Object.assign(question, patch)
    })
  }

  /** Bookmark a session, or a question in it. */
  toggleBookmark(id: string, questionId?: string): void {
    this.store.update((draft) => {
      const session = draft.interviews.find((entry) => entry.id === id)
      if (!session) return
      if (questionId) {
        const question = session.questions.find((entry) => entry.id === questionId)
        if (question) question.bookmarked = !question.bookmarked
        return
      }
      session.bookmarked = !session.bookmarked
    })
  }

  /** Forget one session. */
  remove(id: string): void {
    this.store.update((draft) => {
      draft.interviews = draft.interviews.filter((session) => session.id !== id)
    })
  }

  /** Forget every session. */
  clear(): void {
    this.store.set({ interviews: [] })
  }

  /** The companies and roles, for the filters. */
  facets(): { companies: string[]; roles: string[]; kinds: QuestionKind[] } {
    const sessions = this.store.get().interviews
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
