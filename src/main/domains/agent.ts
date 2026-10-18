import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { AgentAction, AgentEvent, AgentRunRequest, AgentStepRecord, AgentStepStatus, AgentTaskRecord } from '@shared/types'
import { logger } from '../logger'
import { getProvider } from '../providers'
import type { ChatTurn } from '../providers/types'
import { JsonStore } from '../store/json-store'
import { coerceAction, describeAction, extractJson, isConsequential, mapCoords } from './agent-plan'
import { automation } from './automation'
import { captureForAgent, type AgentFrame } from './screenshot'
import { settingsDomain } from './settings'

const PLANNER_SYSTEM = `You are Klyro's desktop automation planner. You observe a screenshot of the user's primary display and drive the mouse and keyboard, one small step at a time, to accomplish the user's goal.

Respond with ONLY a single JSON object. No prose. No markdown fences.

Shape:
{
  "type": "move" | "click" | "doubleClick" | "type" | "key" | "scroll" | "wait" | "done" | "ask",
  "x": <number>,                      // pixel X in the screenshot, for move/click/doubleClick/scroll
  "y": <number>,                      // pixel Y in the screenshot
  "button": "left" | "right" | "middle",
  "text": "<string to type>",         // for type
  "keys": "<key combo>",              // for key, e.g. "ctrl+l", "Return", "alt+Tab"
  "dy": <number>,                     // for scroll, positive = down
  "ms": <number>,                     // for wait, milliseconds
  "summary": "<what was accomplished>", // for done
  "question": "<what you need from the user>", // for ask
  "requiresConfirmation": <boolean>,
  "reason": "<short human-readable explanation>"
}

Rules:
- Give coordinates in the screenshot's own pixel space (its size is stated below).
- Each screenshot is taken BEFORE your action; you get a fresh one after acting.
- Do exactly one small, verifiable action per response, then wait for the next screenshot.
- Never type passwords, payment card numbers, or other secrets.
- Set "requiresConfirmation": true for anything that changes state or is hard to undo: sending messages or email, submitting forms, deleting data, making purchases, accepting dialogs, changing settings.
- If the goal is already achieved, respond {"type":"done","summary":"..."}.
- If you are blocked and need the user, respond {"type":"ask","question":"..."}.
- Never repeat an action that already failed; try a different approach.
- Always include "reason".`

interface PendingConfirmation {
  resolve: (approved: boolean) => void
}

interface TaskState {
  tasks: AgentTaskRecord[]
}

class AgentRunner {
  private readonly store = new JsonStore<TaskState>('agent-tasks.json', { tasks: [] })
  private runId: string | null = null
  private goal: string | null = null
  private controller: AbortController | null = null
  private pendingConfirmation: PendingConfirmation | null = null

  status(): { running: boolean; runId: string | null; goal: string | null } {
    return { running: this.runId !== null, runId: this.runId, goal: this.goal }
  }

  tasks(): AgentTaskRecord[] {
    return this.store.get().tasks
  }

  confirm(runId: string, approved: boolean): void {
    if (this.runId !== runId) return
    const pending = this.pendingConfirmation
    this.pendingConfirmation = null
    pending?.resolve(approved)
  }

  cancel(): void {
    this.controller?.abort()
    const pending = this.pendingConfirmation
    this.pendingConfirmation = null
    pending?.resolve(false)
  }

  private emit(event: AgentEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.agentEvent, event)
    }
  }

  private remember(record: AgentTaskRecord): void {
    this.store.update((draft) => {
      draft.tasks = [record, ...draft.tasks].slice(0, 100)
    })
  }

  private async askForConfirmation(index: number, action: AgentAction, reason: string): Promise<boolean> {
    const runId = this.runId
    if (!runId) return false
    this.emit({ type: 'needsConfirmation', runId, index, action, reason })
    return new Promise<boolean>((resolve) => {
      this.pendingConfirmation = { resolve }
    })
  }

  private async plan(goal: string, frame: AgentFrame, history: string[]): Promise<AgentAction> {
    const settings = settingsDomain.get()
    const providerId = settings.activeProvider
    const provider = getProvider(providerId)
    const providerSettings = settings.providers[providerId]

    const prompt = [
      `Goal: ${goal}`,
      '',
      `The screenshot is ${frame.imageWidth} x ${frame.imageHeight} pixels (display: ${frame.name}).`,
      '',
      'Steps so far:',
      history.length ? history.map((line, i) => `${i + 1}. ${line}`).join('\n') : '(none)',
      '',
      'What is the single next action? Respond with JSON only.'
    ].join('\n')

    const turns: ChatTurn[] = [
      { role: 'user', text: prompt, images: [{ dataUrl: frame.dataUrl, mime: 'image/png' }] }
    ]

    let text = ''
    for await (const delta of provider.chat({
      model: providerSettings.model,
      baseUrl: providerSettings.baseUrl,
      apiKey: settingsDomain.apiKey(providerId),
      system: PLANNER_SYSTEM,
      turns,
      temperature: 0.1,
      maxTokens: 700,
      signal: this.controller?.signal
    })) {
      text += delta
    }
    return coerceAction(extractJson(text))
  }

  private mapToScreen(action: AgentAction, frame: AgentFrame): AgentAction {
    return mapCoords(action, frame.imageWidth, frame.imageHeight, frame.screenWidth, frame.screenHeight)
  }

  async run(request: AgentRunRequest): Promise<void> {
    if (this.runId) throw new Error('A task is already running.')

    const caps = await automation.capabilities()
    if (!caps.available) {
      const hint = caps.installHint ? ` Install a backend, e.g.: ${caps.installHint}` : ''
      throw new Error(`Desktop automation is unavailable on this system.${hint}`)
    }

    const runId = randomUUID()
    const goal = request.goal.trim()
    if (!goal) throw new Error('A goal is required.')

    const settings = settingsDomain.get()
    const maxSteps = Math.min(Math.max(request.maxSteps ?? settings.agentMaxSteps, 1), 30)
    const confirmConsequential = settings.agentConfirmConsequential

    this.runId = runId
    this.goal = goal
    this.controller = new AbortController()

    const startedAt = Date.now()
    const steps: AgentStepRecord[] = []
    const history: string[] = []
    this.emit({ type: 'start', runId, goal })

    const finish = (outcome: AgentTaskRecord['outcome'], summary: string): void => {
      this.remember({ id: runId, goal, startedAt, finishedAt: Date.now(), outcome, summary, steps })
    }

    const recordStep = (index: number, action: AgentAction, status: AgentStepStatus, detail?: string): void => {
      const entry: AgentStepRecord = { index, action, status, detail }
      const existing = steps.findIndex((s) => s.index === index)
      if (existing >= 0) steps[existing] = entry
      else steps.push(entry)
      this.emit({ type: 'step', runId, index, action, status, detail })
    }

    try {
      for (let index = 0; index < maxSteps; index++) {
        if (this.controller.signal.aborted) {
          this.emit({ type: 'cancelled', runId })
          finish('cancelled', 'Cancelled by the user.')
          return
        }

        const frame = await captureForAgent()
        const planned = await this.plan(goal, frame, history)

        if (this.controller.signal.aborted) {
          this.emit({ type: 'cancelled', runId })
          finish('cancelled', 'Cancelled by the user.')
          return
        }

        if (planned.type === 'done') {
          const summary = planned.summary ?? 'Task complete.'
          recordStep(index, planned, 'executed', summary)
          this.emit({ type: 'done', runId, summary })
          finish('done', summary)
          return
        }

        if (planned.type === 'ask') {
          const summary = planned.question ?? 'The agent needs more information.'
          recordStep(index, planned, 'executed', summary)
          this.emit({ type: 'done', runId, summary })
          finish('done', summary)
          return
        }

        recordStep(index, planned, 'planned', planned.reason)

        if (confirmConsequential && isConsequential(planned)) {
          const approved = await this.askForConfirmation(
            index,
            planned,
            planned.reason ?? 'This action may change the state of your computer.'
          )
          if (this.controller.signal.aborted) {
            this.emit({ type: 'cancelled', runId })
            finish('cancelled', 'Cancelled by the user.')
            return
          }
          if (!approved) {
            recordStep(index, planned, 'skipped', 'Declined by the user')
            history.push(`Step ${index + 1}: SKIPPED by user — ${describeAction(planned)}`)
            continue
          }
        }

        const actionable = this.mapToScreen(planned, frame)
        recordStep(index, planned, 'executing')
        try {
          const detail = await automation.perform(actionable)
          recordStep(index, planned, 'executed', detail)
          history.push(`${describeAction(planned)} -> ${detail}`)
        } catch (error) {
          const message = (error as Error).message
          recordStep(index, planned, 'failed', message)
          history.push(`${describeAction(planned)} -> FAILED: ${message}`)
        }
      }

      const summary = `Stopped after ${maxSteps} steps without finishing.`
      this.emit({ type: 'error', runId, message: summary })
      finish('step-limit', summary)
    } catch (error) {
      if (this.controller?.signal.aborted) {
        this.emit({ type: 'cancelled', runId })
        finish('cancelled', 'Cancelled by the user.')
      } else {
        const message = (error as Error).message || 'The task failed.'
        logger.error('Agent task failed', message)
        this.emit({ type: 'error', runId, message })
        finish('error', message)
      }
    } finally {
      this.runId = null
      this.goal = null
      this.controller = null
      this.pendingConfirmation = null
    }
  }
}

export const agentRunner = new AgentRunner()
