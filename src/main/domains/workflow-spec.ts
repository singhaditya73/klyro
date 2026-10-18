import type { WorkflowDraft, WorkflowRecord, WorkflowStep, WorkflowStepKind } from '@shared/types'

/**
 * Versioned, validated workflow definitions.
 *
 * Kept free of Electron/Node imports so the rules can be unit-tested directly and
 * so the renderer and main process agree on what a valid workflow is.
 */
export const WORKFLOW_SCHEMA_VERSION = 2

export const STEP_KINDS: WorkflowStepKind[] = [
  'prompt',
  'githubIssues',
  'githubCreateIssue',
  'projectSearch',
  'knowledge',
  'meetingSummary'
]

export const DEFAULT_STEP_TIMEOUT_MS = 120_000
export const MIN_STEP_TIMEOUT_MS = 1_000
export const MAX_STEP_TIMEOUT_MS = 600_000
export const MAX_STEP_RETRIES = 3
export const MAX_STEPS = 12

/** A step after defaults are applied: every field the engine needs is present. */
export interface ResolvedStep {
  id: string
  name: string
  kind: WorkflowStepKind
  onFailure: 'stop' | 'continue'
  retries: number
  timeoutMs: number
  output: string
  /** Template/query/payload for the step's tool, already selected by kind. */
  argument: string
  /** Secondary arguments for kinds that need more than one (repo + title + body). */
  extra: Record<string, string>
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

function slug(value: string, fallback: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return cleaned || fallback
}

/** Templates may reference {{input}}, {{prev}} and {{steps.<key>}}. */
export function templateReferences(template: string): string[] {
  const found: string[] = []
  const pattern = /\{\{\s*([\w.-]+)\s*\}\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(template)) !== null) found.push(match[1])
  return found
}

function requiredFieldsOf(step: WorkflowStep): { label: string; value: string }[] {
  switch (step.kind) {
    case 'prompt':
      return [{ label: 'template', value: step.template }]
    case 'githubIssues':
      return [{ label: 'repository', value: step.repo }]
    case 'githubCreateIssue':
      return [
        { label: 'repository', value: step.repo },
        { label: 'title', value: step.title },
        { label: 'body', value: step.body }
      ]
    case 'projectSearch':
    case 'knowledge':
      return [{ label: 'query', value: step.query }]
    case 'meetingSummary':
      return [{ label: 'meetingId', value: step.meetingId }]
    default:
      return []
  }
}

/** The text a step's tool consumes, or the first template-ish field. */
function argumentOf(step: WorkflowStep): string {
  switch (step.kind) {
    case 'prompt':
      return step.template
    case 'githubIssues':
      return step.repo
    case 'githubCreateIssue':
      return step.repo
    case 'projectSearch':
    case 'knowledge':
      return step.query
    case 'meetingSummary':
      return step.meetingId
    default:
      return ''
  }
}

function extraOf(step: WorkflowStep): Record<string, string> {
  if (step.kind === 'githubCreateIssue') return { title: step.title, body: step.body }
  return {}
}

/**
 * Fill in ids, output keys, timeouts and failure policy, and confirm that every
 * forward template reference points at a step that has already run.
 */
export function resolveSteps(workflow: WorkflowRecord): ResolvedStep[] {
  const usedIds = new Set<string>()
  const usedOutputs = new Set<string>()
  const resolved: ResolvedStep[] = []

  for (const [index, step] of workflow.steps.entries()) {
    let id = (step.id ?? '').trim() || slug(step.name, `step-${index + 1}`)
    while (usedIds.has(id)) id = `${id}-${index + 1}`
    usedIds.add(id)

    let output = (step.output ?? '').trim() || id
    while (usedOutputs.has(output)) output = `${output}-${index + 1}`
    usedOutputs.add(output)

    resolved.push({
      id,
      name: step.name.trim(),
      kind: step.kind,
      onFailure: step.onFailure === 'continue' ? 'continue' : 'stop',
      retries: Math.min(MAX_STEP_RETRIES, Math.max(0, Math.round(step.retries ?? 0))),
      timeoutMs: Math.min(MAX_STEP_TIMEOUT_MS, Math.max(MIN_STEP_TIMEOUT_MS, Math.round(step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS))),
      output,
      argument: argumentOf(step),
      extra: extraOf(step)
    })
  }

  return resolved
}

/** Validate a draft before it is stored or run. Never throws. */
export function validateWorkflow(draft: Pick<WorkflowDraft, 'name' | 'steps'>, kinds: WorkflowStepKind[] = STEP_KINDS): ValidationResult {
  const errors: string[] = []
  if (!draft.name?.trim()) errors.push('A workflow needs a name.')
  if (draft.name && draft.name.trim().length > 120) errors.push('The workflow name is too long (max 120 characters).')
  if (!Array.isArray(draft.steps) || draft.steps.length === 0) errors.push('A workflow needs at least one step.')
  if (draft.steps && draft.steps.length > MAX_STEPS) errors.push(`A workflow can have at most ${MAX_STEPS} steps.`)

  const outputKeys = new Set<string>()
  draft.steps?.forEach((step, index) => {
    const label = `Step ${index + 1}${step?.name ? ` (${step.name})` : ''}`
    if (!step || typeof step !== 'object') {
      errors.push(`${label}: not a valid step.`)
      return
    }
    const kind = String(step.kind) as WorkflowStepKind
    if (!kinds.includes(kind)) {
      errors.push(`${label}: unsupported step type "${String(step.kind)}".`)
      return
    }
    if (!step.name?.trim()) errors.push(`${label}: every step needs a name.`)
    for (const field of requiredFieldsOf(step)) {
      if (!field.value?.trim()) errors.push(`${label}: ${field.label} is required.`)
    }
    if (step.retries !== undefined && (step.retries < 0 || step.retries > MAX_STEP_RETRIES)) {
      errors.push(`${label}: retries must be between 0 and ${MAX_STEP_RETRIES}.`)
    }
    if (step.timeoutMs !== undefined && (step.timeoutMs < MIN_STEP_TIMEOUT_MS || step.timeoutMs > MAX_STEP_TIMEOUT_MS)) {
      errors.push(`${label}: timeout must be between ${MIN_STEP_TIMEOUT_MS / 1000}s and ${MAX_STEP_TIMEOUT_MS / 1000}s.`)
    }
    if (step.kind === 'githubIssues' || step.kind === 'githubCreateIssue') {
      if (step.repo?.trim() && !/^[\w.-]+\/[\w.-]+$/.test(step.repo.trim())) {
        errors.push(`${label}: repository must look like "owner/name".`)
      }
    }

    // Validate template references against outputs defined so far.
    const text = `${argumentOf(step)} ${Object.values(extraOf(step)).join(' ')}`
    for (const reference of templateReferences(text)) {
      if (reference === 'input' || reference === 'prev') continue
      const match = /^steps\.([\w-]+)$/.exec(reference)
      if (!match) {
        errors.push(`${label}: unknown placeholder {{${reference}}}.`)
        continue
      }
      if (!outputKeys.has(match[1])) {
        errors.push(`${label}: {{steps.${match[1]}}} refers to a step that runs later or does not exist.`)
      }
    }

    const key = (step.output ?? '').trim() || (step.id ?? '').trim() || slug(step.name, `step-${index + 1}`)
    outputKeys.add(key)
  })

  return { ok: errors.length === 0, errors }
}

/** Bring a stored record up to the current schema without mutating it. */
export function normalizeWorkflow(record: WorkflowRecord): WorkflowRecord {
  const resolved = resolveSteps({ ...record, steps: record.steps ?? [] })
  return {
    ...record,
    version: WORKFLOW_SCHEMA_VERSION,
    steps: record.steps.map((step, index) => ({
      ...step,
      id: step.id ?? resolved[index]?.id,
      output: step.output ?? resolved[index]?.output
    }))
  }
}

/** One-line description of what a step will do, for logs and the UI. */
export function describeStep(step: ResolvedStep): string {
  switch (step.kind) {
    case 'prompt':
      return `Ask the model: ${step.argument.slice(0, 80)}`
    case 'githubIssues':
      return `Fetch open GitHub issues for ${step.argument}`
    case 'githubCreateIssue':
      return `Create a GitHub issue in ${step.argument}`
    case 'projectSearch':
      return `Search the indexed project for "${step.argument}"`
    case 'knowledge':
      return `Search local knowledge for "${step.argument}"`
    case 'meetingSummary':
      return `Read meeting ${step.argument}`
    default:
      return step.name
  }
}
