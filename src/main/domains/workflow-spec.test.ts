import { describe, expect, it } from 'vitest'
import type { WorkflowRecord } from '@shared/types'
import {
  DEFAULT_STEP_TIMEOUT_MS,
  MAX_STEP_RETRIES,
  describeStep,
  normalizeWorkflow,
  resolveSteps,
  templateReferences,
  validateWorkflow
} from './workflow-spec'

function record(steps: WorkflowRecord['steps'], name = 'Test'): WorkflowRecord {
  return { id: 'w', version: 0, name, description: '', builtin: false, steps, createdAt: 0 }
}

describe('workflow validation', () => {
  it('accepts a well-formed workflow', () => {
    const result = validateWorkflow({
      name: 'Fine',
      steps: [
        { kind: 'githubIssues', name: 'fetch', repo: 'owner/name', output: 'issues' },
        { kind: 'prompt', name: 'draft', template: 'summarise {{steps.issues}}' }
      ]
    })
    expect(result).toEqual({ ok: true, errors: [] })
  })

  it('rejects an empty workflow and a missing name', () => {
    expect(validateWorkflow({ name: '', steps: [{ kind: 'prompt', name: 'a', template: 'x' }] }).errors[0]).toMatch(
      /needs a name/
    )
    expect(validateWorkflow({ name: 'X', steps: [] }).errors[0]).toMatch(/at least one step/)
  })

  it('requires the fields each step type needs', () => {
    const cases: Array<{ steps: WorkflowRecord['steps']; expected: RegExp }> = [
      { steps: [{ kind: 'prompt', name: 'p', template: '   ' }], expected: /template is required/ },
      { steps: [{ kind: 'githubIssues', name: 'g', repo: '' }], expected: /repository is required/ },
      { steps: [{ kind: 'knowledge', name: 's', query: '' }], expected: /query is required/ },
      { steps: [{ kind: 'meetingSummary', name: 'm', meetingId: '' }], expected: /meetingId is required/ },
      { steps: [{ kind: 'githubCreateIssue', name: 'c', repo: 'a/b', title: '', body: 'x' }], expected: /title is required/ }
    ]
    for (const testCase of cases) {
      const result = validateWorkflow({ name: 'X', steps: testCase.steps })
      expect(result.ok).toBe(false)
      expect(result.errors.join(' ')).toMatch(testCase.expected)
    }
  })

  it('rejects an unknown step type', () => {
    const result = validateWorkflow({ name: 'X', steps: [{ kind: 'launchMissiles', name: 'nope' } as never] })
    expect(result.errors.join(' ')).toMatch(/unsupported step type/)
  })

  it('accepts a repository that comes from the run input', () => {
    expect(validateWorkflow({ name: 'X', steps: [{ kind: 'githubIssues', name: 'g', repo: '{{input}}' }] }).ok).toBe(true)
    expect(
      validateWorkflow({ name: 'X', steps: [{ kind: 'githubIssues', name: 'g', repo: 'not-a-repo' }] }).errors.join(' ')
    ).toMatch(/owner\/name/)
  })

  it('rejects forward and unknown template references', () => {
    const forward = validateWorkflow({
      name: 'X',
      steps: [
        { kind: 'prompt', name: 'first', template: 'use {{steps.later}}' },
        { kind: 'prompt', name: 'second', template: 'hi', output: 'later' }
      ]
    })
    expect(forward.errors.join(' ')).toMatch(/refers to a step that runs later/)

    const unknown = validateWorkflow({ name: 'X', steps: [{ kind: 'prompt', name: 'only', template: 'use {{mystery}}' }] })
    expect(unknown.errors.join(' ')).toMatch(/unknown placeholder/)
  })

  it('bounds retries and timeouts', () => {
    const result = validateWorkflow({
      name: 'X',
      steps: [{ kind: 'prompt', name: 'p', template: 'x', retries: MAX_STEP_RETRIES + 1, timeoutMs: 10 }]
    })
    expect(result.errors.join(' ')).toMatch(/retries must be between/)
    expect(result.errors.join(' ')).toMatch(/timeout must be between/)
  })
})

describe('resolving steps', () => {
  it('fills in ids, defaults and unique output keys', () => {
    const steps = resolveSteps(
      record([
        { kind: 'prompt', name: 'First Step', template: 'a' },
        { kind: 'prompt', name: 'First Step', template: 'b' }
      ])
    )
    expect(steps.map((step) => step.id)).toEqual(['first-step', 'first-step-2'])
    expect(steps.map((step) => step.output)).toEqual(['first-step', 'first-step-2'])
    expect(steps[0].timeoutMs).toBe(DEFAULT_STEP_TIMEOUT_MS)
    expect(steps[0].onFailure).toBe('stop')
    expect(steps[0].retries).toBe(0)
  })

  it('honours explicit ids, outputs and policies', () => {
    const [step] = resolveSteps(
      record([
        {
          kind: 'githubIssues',
          id: 'issues',
          name: 'Fetch',
          repo: 'owner/name',
          output: 'tickets',
          onFailure: 'continue',
          retries: 2,
          timeoutMs: 5000
        }
      ])
    )
    expect(step).toMatchObject({
      id: 'issues',
      output: 'tickets',
      onFailure: 'continue',
      retries: 2,
      timeoutMs: 5000,
      argument: 'owner/name'
    })
  })
})

describe('normalising stored workflows', () => {
  it('upgrades a definition saved before the schema version existed', () => {
    const legacy = record([
      { kind: 'prompt', name: 'Legacy', template: 'old' },
      { kind: 'githubIssues', name: 'Fetch', repo: '{{input}}' }
    ])
    const upgraded = normalizeWorkflow(legacy)
    expect(upgraded.version).toBeGreaterThan(0)
    for (const step of upgraded.steps) {
      expect(step.id).toBeTruthy()
      expect(step.output).toBeTruthy()
    }
  })
})

describe('template references', () => {
  it('finds placeholders, including steps.*', () => {
    expect(templateReferences('{{input}} + {{prev}} + {{steps.a}}')).toEqual(['input', 'prev', 'steps.a'])
    expect(templateReferences('no placeholders here')).toEqual([])
  })
})

describe('describing steps', () => {
  it('explains each step in plain language', () => {
    const steps = resolveSteps(
      record([
        { kind: 'prompt', name: 'p', template: 'do a thing' },
        { kind: 'githubIssues', name: 'g', repo: 'owner/name' },
        { kind: 'knowledge', name: 's', query: 'config' }
      ])
    )
    expect(describeStep(steps[0])).toMatch(/Ask the model/)
    expect(describeStep(steps[1])).toMatch(/owner\/name/)
    expect(describeStep(steps[2])).toMatch(/config/)
  })
})
