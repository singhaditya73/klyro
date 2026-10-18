import { useCallback, useEffect, useState } from 'react'
import type { AgentAction, AgentStepRecord, AgentTaskRecord, AutomationCapabilities } from '@shared/types'

export interface AgentController {
  caps: AutomationCapabilities | null
  running: boolean
  goal: string
  setGoal: (value: string) => void
  steps: AgentStepRecord[]
  pending: { runId: string; index: number; action: AgentAction; reason: string } | null
  outcome: { kind: 'done' | 'cancelled' | 'error'; message: string } | null
  tasks: AgentTaskRecord[]
  start: () => Promise<void>
  stop: () => void
  decide: (approved: boolean) => void
  refreshCaps: () => Promise<void>
}

export function useAgent(): AgentController {
  const [caps, setCaps] = useState<AutomationCapabilities | null>(null)
  const [running, setRunning] = useState(false)
  const [goal, setGoal] = useState('')
  const [steps, setSteps] = useState<AgentStepRecord[]>([])
  const [pending, setPending] = useState<AgentController['pending']>(null)
  const [outcome, setOutcome] = useState<AgentController['outcome']>(null)
  const [tasks, setTasks] = useState<AgentTaskRecord[]>([])

  const refreshCaps = useCallback(async (): Promise<void> => {
    setCaps(await window.klyro.getAutomationCapabilities())
  }, [])

  const refreshTasks = useCallback(async (): Promise<void> => {
    setTasks(await window.klyro.listAgentTasks())
  }, [])

  useEffect(() => {
    void refreshCaps()
    void refreshTasks()
    void (async () => {
      const status = await window.klyro.getAgentStatus()
      setRunning(status.running)
      if (status.goal) setGoal(status.goal)
    })()
  }, [refreshCaps, refreshTasks])

  useEffect(() => {
    return window.klyro.onAgentEvent((event) => {
      switch (event.type) {
        case 'start':
          setRunning(true)
          setSteps([])
          setPending(null)
          setOutcome(null)
          break
        case 'step':
          setSteps((prev) => {
            const next = [...prev]
            const entry: AgentStepRecord = {
              index: event.index,
              action: event.action,
              status: event.status,
              detail: event.detail
            }
            const existing = next.findIndex((s) => s.index === event.index)
            if (existing >= 0) next[existing] = entry
            else next.push(entry)
            return next
          })
          break
        case 'needsConfirmation':
          setPending({ runId: event.runId, index: event.index, action: event.action, reason: event.reason })
          break
        case 'done':
          setRunning(false)
          setPending(null)
          setOutcome({ kind: 'done', message: event.summary })
          void refreshTasks()
          break
        case 'cancelled':
          setRunning(false)
          setPending(null)
          setOutcome({ kind: 'cancelled', message: 'Task cancelled.' })
          void refreshTasks()
          break
        case 'error':
          setRunning(false)
          setPending(null)
          setOutcome({ kind: 'error', message: event.message })
          void refreshTasks()
          break
      }
    })
  }, [refreshTasks])

  const start = useCallback(async (): Promise<void> => {
    if (!goal.trim() || running) return
    setSteps([])
    setPending(null)
    setOutcome(null)
    setRunning(true)
    try {
      await window.klyro.runAgent({ goal })
    } catch (error) {
      setRunning(false)
      setOutcome({ kind: 'error', message: (error as Error).message })
    }
  }, [goal, running])

  const stop = useCallback((): void => {
    void window.klyro.cancelAgent()
  }, [])

  const decide = useCallback(
    (approved: boolean): void => {
      const current = pending
      if (!current) return
      setPending(null)
      void window.klyro.confirmAgent(current.runId, approved)
    },
    [pending]
  )

  return { caps, running, goal, setGoal, steps, pending, outcome, tasks, start, stop, decide, refreshCaps }
}
