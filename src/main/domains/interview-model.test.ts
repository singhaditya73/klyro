import { describe, expect, it } from 'vitest'
import {
  adviceFor,
  classifyQuestion,
  contextBlock,
  extractContext,
  progressOf
} from './interview-model'
import type { InterviewSession } from '@shared/types'

describe('classifyQuestion', () => {
  it('spots a behavioural question', () => {
    expect(classifyQuestion('Tell me about a time you handled a conflict with a teammate')).toBe('behavioral')
    expect(classifyQuestion('How do you handle disagreement with your manager?')).toBe('behavioral')
  })

  it('spots a technical question', () => {
    expect(classifyQuestion('How would you design the database schema for this?')).toBe('technical')
    expect(classifyQuestion('What is the latency of this API under load?')).toBe('technical')
    expect(classifyQuestion('How do you implement caching here?')).toBe('technical')
  })

  it('spots a question about the project', () => {
    expect(classifyQuestion('What was your role on the project?')).toBe('project')
    expect(classifyQuestion('Tell me about the impact of the project you shipped')).toBe('project')
  })

  it('falls back to general', () => {
    expect(classifyQuestion('Good morning')).toBe('general')
    expect(classifyQuestion('')).toBe('general')
  })
})

describe('adviceFor', () => {
  it('tells the assistant how to answer each kind', () => {
    expect(adviceFor('behavioral').guidance).toMatch(/situation/i)
    expect(adviceFor('technical').guidance).toMatch(/precise/i)
    expect(adviceFor('project').guidance).toMatch(/role/i)
    expect(adviceFor('general').guidance).toMatch(/briefly/i)
  })
})

describe('extractContext', () => {
  it('keeps the decisions and the definitions', () => {
    const notes = extractContext([
      'we decided to go with the local model for the demo',
      'the thing we call the gateway is what fronts the providers',
      'yeah that sounds good to me'
    ])
    expect(notes).toHaveLength(2)
    expect(notes[0].kind).toBe('decision')
    expect(notes[1].kind).toBe('term')
  })

  it('ignores the noise', () => {
    expect(extractContext(['okay', 'um', 'yeah'])).toHaveLength(0)
  })

  it('puts them into a block for the prompt', () => {
    const block = contextBlock([{ text: 'we decided to use Rust', kind: 'decision', at: 0 }])
    expect(block).toContain('we decided to use Rust')
    expect(contextBlock([])).toBe('')
  })
})

describe('progressOf', () => {
  const session = {
    id: 'x',
    company: '',
    role: '',
    startedAt: 0,
    endedAt: 0,
    durationMs: 0,
    transcript: [],
    answers: [],
    notes: '',
    summary: '',
    tags: [],
    bookmarked: false,
    context: [],
    ephemeral: false,
    questions: [
      { id: '1', text: 'a', source: 'voice', askedAt: 0, kind: 'general', progress: 'answered', answer: 'yes', note: '', bookmarked: false },
      { id: '2', text: 'b', source: 'voice', askedAt: 0, kind: 'general', progress: 'asked', answer: '', note: '', bookmarked: false }
    ]
  } as unknown as InterviewSession

  it('counts what was answered', () => {
    const progress = progressOf(session)
    expect(progress.answered).toBe(1)
    expect(progress.total).toBe(2)
    expect(progress.percent).toBe(50)
  })

  it('does not divide by nothing', () => {
    const empty = { ...session, questions: [] } as unknown as InterviewSession
    expect(progressOf(empty).percent).toBe(0)
  })
})
