import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  ChatMessage,
  WorkflowDraft,
  WorkflowEvent,
  WorkflowRecord,
  WorkflowRunResult,
  WorkflowStep,
  WorkflowStepResult
} from '@shared/types'
import { renderTemplate } from '../knowledge/code-files'
import { logger } from '../logger'
import { getProvider } from '../providers'
import { JsonStore } from '../store/json-store'
import { withIdleTimeout } from '../util/idle-timeout'
import { buildKnowledgeContext } from './context'
import { conversations } from './conversations'
import { github } from './integrations'
import { settingsDomain } from './settings'

interface WorkflowState {
  custom: WorkflowRecord[]
}

export const BUILTIN_WORKFLOWS: WorkflowRecord[] = [
  {
    id: 'builtin:standup',
    name: 'Standup from GitHub issues',
    description: 'Fetch the open issues for a repository and draft a standup update.',
    builtin: true,
    createdAt: 0,
    steps: [
      { kind: 'githubIssues', name: 'Fetch open issues', repo: '{{input}}' },
      {
        kind: 'prompt',
        name: 'Draft standup',
        template:
          'Open issues fetched from GitHub:\n\n{{prev}}\n\nUsing only those issues, write a short standup update covering what is in progress, what is blocked, and what is next. Group related issues and keep it under 200 words.'
      }
    ]
  },
  {
    id: 'builtin:explain-area',
    name: 'Explain an area of the codebase',
    description: 'Explain how a subsystem fits together, citing the indexed files.',
    builtin: true,
    createdAt: 0,
    steps: [
      {
        kind: 'prompt',
        name: 'Explain',
        template:
          'Explain how {{input}} fits together in this project. Cite the specific files, describe the data flow, and call out anything surprising or fragile.'
      }
    ]
  },
  {
    id: 'builtin:notes-to-actions',
    name: 'Turn notes into action items',
    description: 'Summarise raw notes and extract concrete action items.',
    builtin: true,
    createdAt: 0,
    steps: [
      {
        kind: 'prompt',
        name: 'Extract actions',
        template:
          'Notes:\n\n{{input}}\n\nWrite a two-sentence summary, then a numbered list of concrete action items with owners and dates when they are stated. Do not invent details.'
      }
    ]
  },
  {
    id: 'builtin:review-diff',
    name: 'Review a diff',
    description: 'Review a patch for bugs, risky changes, and missing tests.',
    builtin: true,
    createdAt: 0,
    steps: [
      {
        kind: 'prompt',
        name: 'Review',
        template:
          'Review this diff:\n\n```diff\n{{input}}\n```\n\nList concrete problems (bugs, regressions, unsafe assumptions, missing tests), each with the file and line it concerns and why it matters. Then state what looks fine. Do not invent context you were not given.'
      }
    ]
  }
]

/** Named, multi-step workflows that run inside a real conversation. */
class WorkflowDomain {
  private readonly store = new JsonStore<WorkflowState>('workflows.json', { custom: [] })

  list(): WorkflowRecord[] {
    return [...BUILTIN_WORKFLOWS, ...this.store.get().custom]
  }

  create(draft: WorkflowDraft): WorkflowRecord {
    const name = draft.name.trim().slice(0, 120)
    if (!name) throw new Error('A workflow needs a name.')
    const steps = draft.steps.filter((step) => step.name.trim())
    if (steps.length === 0) throw new Error('A workflow needs at least one step.')

    const workflow: WorkflowRecord = {
      id: randomUUID(),
      name,
      description: (draft.description ?? '').trim().slice(0, 300),
      builtin: false,
      steps,
      createdAt: Date.now()
    }
    this.store.update((state) => {
      state.custom.push(workflow)
    })
    return workflow
  }

  remove(id: string): void {
    if (id.startsWith('builtin:')) throw new Error('Built-in workflows cannot be deleted.')
    this.store.update((state) => {
      state.custom = state.custom.filter((workflow) => workflow.id !== id)
    })
  }

  private emit(event: WorkflowEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.workflowEvent, event)
    }
  }

  private async complete(rendered: string, conversationId: string, label: string): Promise<string> {
    const settings = settingsDomain.get()
    const providerId = settings.activeProvider
    const provider = getProvider(providerId)
    const config = settings.providers[providerId]
    const knowledge = buildKnowledgeContext(rendered)

    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      content: `▶ ${label}\n\n${rendered}`.slice(0, 40000),
      createdAt: Date.now()
    }
    conversations.addMessage(conversationId, userMessage)

    let text = ''
    for await (const delta of withIdleTimeout(
      provider.chat({
        model: config.model,
        baseUrl: config.baseUrl,
        apiKey: settingsDomain.apiKey(providerId),
        system: [settings.systemPrompt, knowledge.block].filter(Boolean).join('\n\n'),
        turns: [{ role: 'user', text: rendered }],
        temperature: 0.3,
        maxTokens: 1800
      })
    )) {
      text += delta
    }
    text = text.trim()

    conversations.addMessage(conversationId, {
      id: randomUUID(),
      role: 'assistant',
      content: text,
      createdAt: Date.now(),
      model: config.model
    })
    return text
  }

  private async fetchIssues(repo: string, conversationId: string, label: string): Promise<string> {
    const target = repo.trim()
    if (!target) throw new Error('This step needs a repository, but the input was empty.')
    const issues = await github.issues(target, 25)
    const digest = issues.length
      ? issues
          .map(
            (issue) =>
              `- #${issue.number} ${issue.isPullRequest ? '[PR] ' : ''}${issue.title} (labels: ${
                issue.labels.join(', ') || 'none'
              })`
          )
          .join('\n')
      : '(no open issues)'

    conversations.addMessage(conversationId, {
      id: randomUUID(),
      role: 'user',
      content: `▶ ${label}\n\nFetched from github.com/${target} (data, not a request):\n${digest}`.slice(0, 40000),
      createdAt: Date.now()
    })
    return digest
  }

  async run(id: string, input: string): Promise<WorkflowRunResult> {
    const workflow = this.list().find((candidate) => candidate.id === id)
    if (!workflow) throw new Error('Workflow not found.')

    const runId = randomUUID()
    const conversation = conversations.create()
    conversations.rename(conversation.id, workflow.name)
    this.emit({ type: 'start', runId, workflowId: workflow.id, name: workflow.name })

    const results: WorkflowStepResult[] = []
    let previous = ''

    for (const [index, step] of workflow.steps.entries()) {
      this.emit({ type: 'step', runId, index, name: step.name, status: 'running' })
      try {
        const output =
          step.kind === 'githubIssues'
            ? await this.fetchIssues(renderTemplate(step.repo, { input, prev: previous }), conversation.id, step.name)
            : await this.complete(
                renderTemplate((step as Extract<WorkflowStep, { kind: 'prompt' }>).template, { input, prev: previous }),
                conversation.id,
                step.name
              )
        previous = output
        results.push({ name: step.name, output, ok: true })
        this.emit({ type: 'step', runId, index, name: step.name, status: 'done', detail: output.slice(0, 160) })
      } catch (error) {
        const message = (error as Error).message
        logger.warn(`Workflow step failed: ${step.name}`, message)
        results.push({ name: step.name, output: message, ok: false })
        this.emit({ type: 'step', runId, index, name: step.name, status: 'failed', detail: message })
        this.emit({ type: 'error', runId, message: `Step "${step.name}" failed: ${message}` })
        return { runId, conversationId: conversation.id, steps: results }
      }
    }

    this.emit({ type: 'done', runId, conversationId: conversation.id })
    return { runId, conversationId: conversation.id, steps: results }
  }
}

export const workflows = new WorkflowDomain()
