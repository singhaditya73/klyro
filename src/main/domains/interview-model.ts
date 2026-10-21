import type { InterviewSession, InterviewSummary, QuestionKind } from '@shared/types'

/**
 * How a question is classified, and how the answer should be shaped.
 *
 * The kind is read off the words of the question, so it costs nothing; the
 * advice is what the assistant is told about it.
 */
export const QUESTION_KINDS: QuestionKind[] = ['technical', 'behavioral', 'project', 'general']

export interface KindAdvice {
  /** What the assistant is told to do with a question of this kind. */
  guidance: string
  /** One line for the user, so they can see why the answer looks like that. */
  label: string
}

const ADVICE: Record<QuestionKind, KindAdvice> = {
  technical: {
    label: 'Technical',
    guidance:
      'This is a technical question. Be precise and concrete: name the technology, the trade-off and the decision. Two or three sentences, no preamble.'
  },
  behavioral: {
    label: 'Behavioural',
    guidance:
      'This is a behavioural question. Answer in the shape of the situation, what you did and what came of it — briefly, in two or three sentences, in first person.'
  },
  project: {
    label: 'Project',
    guidance:
      'This is a question about a project. Focus on the user\'s own role, what they built and what it changed. Two or three sentences.'
  },
  general: {
    label: 'General',
    guidance: 'Answer directly and briefly — two or three sentences.'
  }
}

const TECHNICAL_CUES =
  /\b(architecture|implement|algorithm|complexity|database|schema|api|sql|latency|throughput|scal|deploy|docker|kubernetes|async|concurren|thread|process|memory|cache|index|query|optimi[sz]|refactor|design pattern|microservice|server|client|protocol|buffer|stack|heap|garbage|compile|type|race condition|deadlock|encryption|auth|token)\b/i
const BEHAVIORAL_CUES =
  /\b(tell me about a time|describe a time|how do you handle|conflict|disagree|feedback|failure|mistake|challenge|struggl|lead|team|mentor|priorit|deadline|pressure|weakness|strength|why do you want|why are you leaving|tell me about yourself|walk me through a)\b/i
const PROJECT_CUES =
  /\b(your project|the project|you (built|shipped|led|owned)|your role|impact|outcome|metric|scale of|contribution)\b/i

/**
 * What kind of question is this?
 *
 * The cues are deliberately cheap: this runs on every question, and a model
 * call to classify a question would cost more than it is worth.
 */
export function classifyQuestion(text: string): QuestionKind {
  const trimmed = text.trim()
  if (!trimmed) return 'general'
  if (BEHAVIORAL_CUES.test(trimmed)) return 'behavioral'
  if (TECHNICAL_CUES.test(trimmed)) return 'technical'
  if (PROJECT_CUES.test(trimmed)) return 'project'
  return 'general'
}

/** How the assistant should answer a question of this kind. */
export function adviceFor(kind: QuestionKind): KindAdvice {
  return ADVICE[kind] ?? ADVICE.general
}

/**
 * Lines worth keeping from a meeting.
 *
 * A decision ("we decided to…", "let's go with…") and a definition ("X means
 * Y", "we call it…") are the things a later question needs and the
 * conversation will not repeat. The cues are cheap on purpose: this runs over
 * every line of a transcript.
 */
const DECISION_CUE =
  /\b(we(?:'ve| have)? decided|decision|let'?s go with|we will use|we'?ll use|we chose|agreed|sign(?:ed)? off|going with|the plan is|we settled on)\b/i
const TERM_CUE = /\b(means|that is|referred to as|call(?:ed|s| it| the)|defined as|in other words|stands for)\b/i

export interface ContextNote {
  text: string
  kind: 'decision' | 'term'
  at: number
}

/** The lines in a transcript worth remembering for the rest of the session. */
export function extractContext(lines: string[]): ContextNote[] {
  const notes: ContextNote[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length < 12 || trimmed.length > 400) continue
    if (DECISION_CUE.test(trimmed)) {
      notes.push({ text: trimmed, kind: 'decision', at: Date.now() })
    } else if (TERM_CUE.test(trimmed)) {
      notes.push({ text: trimmed, kind: 'term', at: Date.now() })
    }
    // A handful is plenty; a long meeting would otherwise drown the prompt.
    if (notes.length >= 12) break
  }
  return notes
}

/** The context block that goes into the prompt. */
export function contextBlock(notes: ContextNote[]): string {
  if (notes.length === 0) return ''
  const lines = notes.map((note) => `• ${note.text}`)
  return `Decisions and terms from earlier in this conversation:\n${lines.join('\n')}`
}

/** How far along a session is: how many questions were answered. */
export function progressOf(session: InterviewSession): { answered: number; total: number; percent: number } {
  const total = session.questions.length
  const answered = session.questions.filter((question) => question.answer.trim().length > 0).length
  return { answered, total, percent: total === 0 ? 0 : Math.round((answered / total) * 100) }
}

/** The short line that shows in the list. */
export function toSummary(session: InterviewSession): InterviewSummary {
  const progress = progressOf(session)
  return {
    id: session.id,
    company: session.company,
    role: session.role,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs: session.durationMs,
    questionCount: session.questions.length,
    answeredCount: progress.answered,
    progress: progress.percent,
    bookmarked: session.bookmarked,
    stage: session.stage,
    hasSummary: session.summary.trim().length > 0,
    preview: (session.questions[0]?.text ?? session.notes ?? '').replace(/\s+/g, ' ').slice(0, 90)
  }
}
