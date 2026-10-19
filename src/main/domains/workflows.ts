import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  ChatMessage,
  GitHubIssue,
  WorkflowDraft,
  WorkflowEvent,
  WorkflowRecord,
  WorkflowRun,
  WorkflowRunResult,
  WorkflowRunStatus,
  WorkflowStepKind,
  WorkflowStepResult
} from '@shared/types'
import { renderTemplate } from '../knowledge/code-files'
import { formatLocation } from '../knowledge/locations'
import { logger } from '../logger'
import { getProvider } from '../providers'
import { resolveRoute } from '../providers/routing'
import { wrapUntrusted } from '../security/untrusted'
import { JsonStore } from '../store/json-store'
import { withIdleTimeout } from '../util/idle-timeout'
import { withTimeout } from '../util/with-timeout'
import { buildKnowledgeContext } from './context'
import { conversations } from './conversations'
import { usage } from './usage'
import { documents } from './documents'
import { github } from './integrations'
import { meetings } from './meetings'
import { memory } from './memory'
import { settingsDomain } from './settings'
import {
  describeStep,
  normalizeWorkflow,
  resolveSteps,
  validateWorkflow,
  WORKFLOW_SCHEMA_VERSION,
  type ResolvedStep
} from './workflow-spec'

interface WorkflowState {
  custom: WorkflowRecord[]
  /** Durable run history, newest last. */
  runs: WorkflowRun[]
}

const MAX_RUNS = 50
/** Delay before a retry, doubled per attempt. */
const RETRY_BASE_DELAY_MS = 400

export const BUILTIN_WORKFLOWS: WorkflowRecord[] = [
  {
    id: 'builtin:standup',
    version: WORKFLOW_SCHEMA_VERSION,
    name: 'Standup from GitHub issues',
    description: 'Fetch the open issues for a repository and draft a standup update.',
    builtin: true,
    createdAt: 0,
    steps: [
      {
        id: 'issues',
        kind: 'githubIssues',
        name: 'Fetch open issues',
        repo: '{{input}}',
        output: 'issues',
        retries: 1,
        timeoutMs: 30_000
      },
      {
        id: 'draft',
        kind: 'prompt',
        name: 'Draft standup',
        output: 'standup',
        template:
          'Open issues fetched from GitHub:\n\n{{steps.issues}}\n\nUsing only those issues, write a short standup update covering what is in progress, what is blocked, and what is next. Group related issues and keep it under 200 words.'
      }
    ]
  },
  {
    id: 'builtin:notes-to-actions',
    version: WORKFLOW_SCHEMA_VERSION,
    name: 'Turn notes into action items',
    description: 'Summarise raw notes and extract concrete action items.',
    builtin: true,
    createdAt: 0,
    steps: [
      {
        id: 'actions',
        kind: 'prompt',
        name: 'Extract actions',
        template:
          'Notes:\n\n{{input}}\n\nWrite a two-sentence summary, then a numbered list of concrete action items with owners and dates when they are stated. Do not invent details.'
      }
    ]
  },
  {
    id: 'builtin:review-diff',
    version: WORKFLOW_SCHEMA_VERSION,
    name: 'Review a diff',
    description: 'Review a patch for bugs, risky changes, and missing tests.',
    builtin: true,
    createdAt: 0,
    steps: [
      {
        id: 'review',
        kind: 'prompt',
        name: 'Review',
        template:
          'Review this diff:\n\n```diff\n{{input}}\n```\n\nList concrete problems (bugs, regressions, unsafe assumptions, missing tests), each with the file and line it concerns and why it matters. Then state what looks fine. Do not invent context you were not given.'
      }
    ]
  }
]

/** Context handed to a step tool. */
interface ToolContext {
  runId: string
  conversationId: string
  step: ResolvedStep
  /** The step's argument after template substitution. */
  rendered: string
  signal: AbortSignal
  /** Append a visible "▶ step" message to the run's conversation. */
  note: (label: string, body: string) => void
}

/**
 * A typed, reusable step implementation. Tools are the only way a workflow can
 * touch the outside world, so every capability a workflow has is listed here.
 */
interface WorkflowTool {
  kind: WorkflowStepKind
  label: string
  description: string
  /** True when running the step changes something outside this machine. */
  consequential: boolean
  run: (context: ToolContext) => Promise<string>
}

function formatIssues(issues: GitHubIssue[]): string {
  if (issues.length === 0) return '(no open issues)'
  return issues
    .map(
      (issue) =>
        `- #${issue.number} ${issue.isPullRequest ? '[PR] ' : ''}${issue.title} (labels: ${
          issue.labels.join(', ') || 'none'
        })`
    )
    .join('\n')
}

const WORKFLOW_TOOLS: Record<WorkflowStepKind, WorkflowTool> = {
  prompt: {
    kind: 'prompt',
    label: 'Ask the model',
    description: 'Send a prompt (with local knowledge context) to the active model.',
    consequential: false,
    run: async (context) => {
      const settings = settingsDomain.get()
      const providerId = settings.activeProvider
      const provider = getProvider(providerId)
      const route = resolveRoute({ settings, apiKey: settingsDomain.apiKey(providerId), purpose: 'chat' })
      const knowledge = buildKnowledgeContext(context.rendered)

      context.note(context.step.name, context.rendered)

      let text = ''
      for await (const delta of withIdleTimeout(
        provider.chat({
          model: route.model,
          baseUrl: route.baseUrl,
          apiKey: route.apiKey,
          system: [settings.systemPrompt, knowledge.block].filter(Boolean).join('\n\n'),
          turns: [{ role: 'user', text: context.rendered }],
          temperature: 0.3,
          maxTokens: 1800,
          signal: context.signal
        })
      )) {
        text += delta
      }
      usage.record(providerId, 'workflow-step')
      text = text.trim()

      conversations.addMessage(context.conversationId, {
        id: randomUUID(),
        role: 'assistant',
        content: text,
        createdAt: Date.now(),
        model: route.model
      })
      return text
    }
  },
  githubIssues: {
    kind: 'githubIssues',
    label: 'Fetch GitHub issues',
    description: 'Read the open issues of a repository (read-only).',
    consequential: false,
    run: async (context) => {
      const target = context.rendered.trim()
      if (!target) throw new Error('This step needs a repository, but the input was empty.')
      const issues = await github.issues(target, 25)
      const digest = formatIssues(issues)
      const wrapped = wrapUntrusted(`github issues for ${target}`, digest)
      context.note(context.step.name, `Fetched from github.com/${target}:\n${wrapped}`)
      return wrapped
    }
  },
  githubCreateIssue: {
    kind: 'githubCreateIssue',
    label: 'Create a GitHub issue',
    description: 'Open a new issue in a repository. Changes GitHub, so it is only run when you put it in a workflow.',
    consequential: true,
    run: async (context) => {
      const repo = context.rendered.trim()
      const title = renderTemplate(context.step.extra.title ?? '', { input: '', prev: '' })
      const body = renderTemplate(context.step.extra.body ?? '', { input: '', prev: '' })
      if (!title.trim()) throw new Error('This step needs an issue title.')
      const issue = await github.createIssue(repo, title, body)
      const summary = `Created #${issue.number} "${issue.title}" in ${repo}\n${issue.url}`
      context.note(context.step.name, summary)
      return summary
    }
  },
  knowledge: {
    kind: 'knowledge',
    label: 'Search local knowledge',
    description: 'Search saved memories and imported documents (read-only).',
    consequential: false,
    run: async (context) => {
      const query = context.rendered.trim()
      if (!query) throw new Error('This step needs a search query.')
      const sections = [
        ...memory.recall(query, 4).map((record) => wrapUntrusted(`memory (${record.origin ?? record.source})`, record.text)),
        ...documents.recall(query, 4).map((hit) => wrapUntrusted(`document: ${formatLocation(hit)}`, hit.text.slice(0, 1500)))
      ]
      if (sections.length === 0) return `(nothing in local knowledge matches "${query}")`
      return sections.join('\n\n')
    }
  },
  meetingSummary: {
    kind: 'meetingSummary',
    label: 'Read a meeting',
    description: "Read a recorded meeting's summary, or its transcript when no summary exists (read-only).",
    consequential: false,
    run: async (context) => {
      const id = context.rendered.trim()
      if (!id) throw new Error('This step needs a meeting id.')
      const meeting = meetings.get(id)
      if (!meeting) throw new Error('That meeting was not found. Pick one from the Meetings list.')
      if (meeting.summary) {
        const actions = meeting.actions.length > 0 ? `\n\nAction items:\n${meeting.actions.map((item) => `- ${item}`).join('\n')}` : ''
        return `${meeting.summary}${actions}`
      }
      return wrapUntrusted(`meeting transcript: ${meeting.title}`, meetings.transcriptText(id))
    }
  }
}

/** Human-readable catalogue of what workflows can do, for docs and settings. */
export function workflowToolCatalogue(): Array<{ kind: WorkflowStepKind; label: string; description: string; consequential: boolean }> {
  return Object.values(WORKFLOW_TOOLS).map(({ kind, label, description, consequential }) => ({
    kind,
    label,
    description,
    consequential
  }))
}

/** Named, multi-step workflows that run inside a real conversation. */
class WorkflowDomain {
  private readonly store = new JsonStore<WorkflowState>('workflows.json', { custom: [], runs: [] })
  private readonly controllers = new Map<string, AbortController>()

  constructor() {
    this.recoverInterrupted()
  }

  /**
   * A run that was still marked `running` when the app last exited cannot be
   * resumed, so say so instead of leaving it stuck forever.
   */
  private recoverInterrupted(): void {
    const stale = this.store.get().runs.filter((run) => run.status === 'running')
    if (stale.length === 0) return
    this.store.update((state) => {
      for (const run of state.runs) {
        if (run.status !== 'running') continue
        run.status = 'interrupted'
        run.error = 'Klyro closed before this run finished.'
        run.finishedAt = Date.now()
        for (const step of run.steps) {
          if (step.status === 'running') step.status = 'failed'
        }
      }
    })
    logger.warn(`Workflows: marked ${stale.length} interrupted run(s)`)
  }

  list(): WorkflowRecord[] {
    return [...BUILTIN_WORKFLOWS, ...this.store.get().custom].map(normalizeWorkflow)
  }

  create(draft: WorkflowDraft): WorkflowRecord {
    const name = (draft.name ?? '').trim().slice(0, 120)
    const steps = (draft.steps ?? []).filter((step) => step?.name?.trim())
    const validation = validateWorkflow({ name, steps })
    if (!validation.ok) throw new Error(validation.errors[0])

    const workflow: WorkflowRecord = {
      id: randomUUID(),
      version: WORKFLOW_SCHEMA_VERSION,
      name,
      description: (draft.description ?? '').trim().slice(0, 300),
      builtin: false,
      steps,
      createdAt: Date.now()
    }
    this.store.update((state) => {
      state.custom.push(workflow)
    })
    return normalizeWorkflow(workflow)
  }

  remove(id: string): void {
    if (id.startsWith('builtin:')) throw new Error('Built-in workflows cannot be deleted.')
    this.store.update((state) => {
      state.custom = state.custom.filter((workflow) => workflow.id !== id)
    })
  }

  /** Recent runs, newest first, for the workflow panel. */
  runs(limit = 20): WorkflowRun[] {
    return [...this.store.get().runs].reverse().slice(0, Math.max(1, limit))
  }

  /** Stop a run in progress. Pending steps are marked skipped. */
  cancel(runId: string): void {
    const controller = this.controllers.get(runId)
    if (!controller) throw new Error('That run is not in progress.')
    controller.abort()
  }

  private emit(event: WorkflowEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.workflowEvent, event)
    }
  }

  private saveRun(run: WorkflowRun): void {
    this.store.update((state) => {
      const index = state.runs.findIndex((candidate) => candidate.id === run.id)
      if (index >= 0) state.runs[index] = run
      else state.runs = [...state.runs, run].slice(-MAX_RUNS)
    })
  }

  /** Render a template against the run's variables. */
  private render(template: string, input: string, previous: string, outputs: Record<string, string>): string {
    const variables: Record<string, string> = { input, prev: previous }
    for (const [key, value] of Object.entries(outputs)) variables[`steps.${key}`] = value
    return renderTemplate(template, variables)
  }

  /**
   * One step, with its retries, timeout and abort wiring.
   *
   * Each attempt gets its own controller so a timeout cancels just that attempt;
   * aborting the run propagates into whichever attempt is in flight.
   */
  private async executeStep(
    step: ResolvedStep,
    rendered: string,
    runController: AbortController,
    runId: string,
    conversationId: string,
    note: (label: string, body: string) => void
  ): Promise<{ output: string; attempts: number }> {
    const tool = WORKFLOW_TOOLS[step.kind]
    let lastError: Error = new Error(`Step "${step.name}" failed.`)

    for (let attempt = 1; attempt <= step.retries + 1; attempt += 1) {
      const attemptController = new AbortController()
      const cancelAttempt = (): void => attemptController.abort()
      runController.signal.addEventListener('abort', cancelAttempt, { once: true })
      try {
        const output = await withTimeout(
          tool.run({ runId, conversationId, step, rendered, signal: attemptController.signal, note }),
          step.timeoutMs,
          `Step "${step.name}" timed out after ${Math.round(step.timeoutMs / 1000)}s.`,
          cancelAttempt
        )
        return { output, attempts: attempt }
      } catch (error) {
        lastError = error as Error
        // A cancelled run should stop immediately rather than retry.
        if (runController.signal.aborted) throw lastError
        if (attempt > step.retries) throw lastError
        logger.warn(`Workflow step "${step.name}" attempt ${attempt} failed, retrying`, lastError.message)
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt))
        if (runController.signal.aborted) throw lastError
      } finally {
        runController.signal.removeEventListener('abort', cancelAttempt)
      }
    }
    throw lastError
  }

  async run(id: string, input: string): Promise<WorkflowRunResult> {
    const workflow = this.list().find((candidate) => candidate.id === id)
    if (!workflow) throw new Error('Workflow not found.')

    const validation = validateWorkflow({ name: workflow.name, steps: workflow.steps })
    if (!validation.ok) throw new Error(`This workflow is not valid: ${validation.errors[0]}`)

    const steps = resolveSteps(workflow)
    const runId = randomUUID()
    const conversation = conversations.create()
    conversations.rename(conversation.id, workflow.name)
    this.emit({ type: 'start', runId, workflowId: workflow.id, name: workflow.name })

    const run: WorkflowRun = {
      id: runId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      input,
      conversationId: conversation.id,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: 0,
      steps: steps.map((step) => ({ id: step.id, name: step.name, status: 'pending', attempts: 0 }))
    }
    this.saveRun(run)

    const controller = new AbortController()
    this.controllers.set(runId, controller)

    const note = (label: string, body: string): void => {
      conversations.addMessage(conversation.id, {
        id: randomUUID(),
        role: 'user',
        content: `▶ ${label}\n\n${body}`.slice(0, 40000),
        createdAt: Date.now()
      } satisfies ChatMessage)
    }

    const results: WorkflowStepResult[] = []
    const outputs: Record<string, string> = {}
    let previous = ''
    let status: WorkflowRunStatus = 'completed'
    let failure: string | undefined

    try {
      for (const [index, step] of steps.entries()) {
        if (controller.signal.aborted) {
          status = 'cancelled'
          failure = 'Run cancelled.'
          break
        }

        const state = run.steps[index]
        state.status = 'running'
        state.startedAt = Date.now()
        this.saveRun(run)
        this.emit({
          type: 'step',
          runId,
          index,
          name: step.name,
          status: 'running',
          detail: describeStep(step)
        })

        try {
          const rendered = this.render(step.argument, input, previous, outputs)
          const { output, attempts } = await this.executeStep(step, rendered, controller, runId, conversation.id, note)
          state.status = 'done'
          state.attempts = attempts
          state.output = output.slice(0, 20000)
          state.finishedAt = Date.now()
          this.saveRun(run)

          outputs[step.output] = output
          previous = output
          results.push({ id: step.id, name: step.name, output, ok: true, attempts })
          this.emit({ type: 'step', runId, index, name: step.name, status: 'done', detail: output.slice(0, 160) })
        } catch (error) {
          const message = (error as Error).message
          state.status = 'failed'
          state.attempts = Math.max(1, state.attempts)
          state.error = message
          state.finishedAt = Date.now()
          this.saveRun(run)

          logger.warn(`Workflow step failed: ${step.name}`, message)
          results.push({ id: step.id, name: step.name, output: message, ok: false, attempts: state.attempts, error: message })
          this.emit({ type: 'step', runId, index, name: step.name, status: 'failed', detail: message })

          if (step.onFailure === 'continue') {
            previous = ''
            continue
          }

          status = controller.signal.aborted ? 'cancelled' : 'failed'
          failure = message
          break
        }
      }

      if (controller.signal.aborted && status === 'completed') {
        status = 'cancelled'
        failure = 'Run cancelled.'
      }

      if (status !== 'completed') {
        // Remaining steps never ran.
        for (const step of run.steps) {
          if (step.status === 'pending') step.status = 'skipped'
        }
      }
    } finally {
      this.controllers.delete(runId)
    }

    run.status = status
    run.error = failure
    run.finishedAt = Date.now()
    this.saveRun(run)

    if (status === 'completed') {
      this.emit({ type: 'done', runId, conversationId: conversation.id, status })
    } else {
      this.emit({ type: 'error', runId, message: failure ?? 'The run did not finish.' })
      this.emit({ type: 'done', runId, conversationId: conversation.id, status })
    }

    return { runId, conversationId: conversation.id, status, error: failure, steps: results }
  }
}

export const workflows = new WorkflowDomain()
