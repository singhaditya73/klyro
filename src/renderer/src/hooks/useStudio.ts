import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CodeActionKind,
  CodeCitation,
  MeetingRecord,
  MeetingSegment,
  ProjectStatus,
  WorkflowRecord
} from '@shared/types'

export interface StudioController {
  project: ProjectStatus | null
  indexing: boolean
  codeOutput: string
  codeCitations: CodeCitation[]
  codeBusy: boolean
  runCodeAction: (kind: CodeActionKind, code: string, question?: string) => Promise<void>
  indexProject: () => Promise<void>
  clearProject: () => Promise<void>

  meetings: MeetingRecord[]
  recording: boolean
  liveSegments: MeetingSegment[]
  seconds: number
  meetingBusy: boolean
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  saveMeeting: (title: string) => Promise<void>
  summarizeMeeting: (id: string) => Promise<void>
  deleteMeeting: (id: string) => Promise<void>
  discardRecording: () => void
  transcribeError: string | null

  workflows: WorkflowRecord[]
  workflowInput: string
  setWorkflowInput: (value: string) => void
  workflowRunning: string | null
  workflowSteps: { name: string; status: 'running' | 'done' | 'failed'; detail?: string }[]
  workflowResult: { conversationId: string; steps: { name: string; output: string; ok: boolean }[] } | null
  runWorkflow: (id: string) => Promise<void>
  deleteWorkflow: (id: string) => Promise<void>

  error: string | null
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return ''
}

export function useStudio(): StudioController {
  const [project, setProject] = useState<ProjectStatus | null>(null)
  const [indexing, setIndexing] = useState(false)
  const [codeOutput, setCodeOutput] = useState('')
  const [codeCitations, setCodeCitations] = useState<CodeCitation[]>([])
  const [codeBusy, setCodeBusy] = useState(false)

  const [meetings, setMeetings] = useState<MeetingRecord[]>([])
  const [recording, setRecording] = useState(false)
  const [liveSegments, setLiveSegments] = useState<MeetingSegment[]>([])
  const [seconds, setSeconds] = useState(0)
  const [meetingBusy, setMeetingBusy] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)

  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([])
  const [workflowInput, setWorkflowInput] = useState('')
  const [workflowRunning, setWorkflowRunning] = useState<string | null>(null)
  const [workflowSteps, setWorkflowSteps] = useState<StudioController['workflowSteps']>([])
  const [workflowResult, setWorkflowResult] = useState<StudioController['workflowResult']>(null)

  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const startedAtRef = useRef(0)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const timerRef = useRef<number | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setProject(await window.klyro.projectStatus())
    setMeetings(await window.klyro.meetingList())
    setWorkflows(await window.klyro.workflowList())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return window.klyro.onWorkflowEvent((event) => {
      switch (event.type) {
        case 'start':
          setWorkflowSteps([])
          setWorkflowResult(null)
          break
        case 'step':
          setWorkflowSteps((prev) => {
            const next = [...prev]
            const entry = { name: event.name, status: event.status, detail: event.detail }
            const existing = next.findIndex((step) => step.name === event.name)
            if (existing >= 0) next[existing] = entry
            else next.push(entry)
            return next
          })
          break
        case 'error':
          setError(event.message)
          break
        default:
          break
      }
    })
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const runCodeAction = useCallback(
    async (kind: CodeActionKind, code: string, question?: string): Promise<void> => {
      setError(null)
      setCodeBusy(true)
      setCodeOutput('')
      setCodeCitations([])
      try {
        const result = await window.klyro.codeAssist({ kind, code, question })
        setCodeOutput(result.text)
        setCodeCitations(result.citations)
      } catch (caught) {
        setError((caught as Error).message)
      } finally {
        setCodeBusy(false)
      }
    },
    []
  )

  const indexProject = useCallback(async (): Promise<void> => {
    setError(null)
    setIndexing(true)
    try {
      setProject(await window.klyro.projectIndex())
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setIndexing(false)
    }
  }, [])

  const clearProject = useCallback(async (): Promise<void> => {
    setProject(await window.klyro.projectClear())
  }, [])

  const handleChunk = useCallback(async (blob: Blob): Promise<void> => {
    try {
      const buffer = await blob.arrayBuffer()
      const result = await window.klyro.transcribe(buffer, blob.type || 'audio/webm')
      const text = result.text.trim()
      if (text) setLiveSegments((prev) => [...prev, { at: Date.now() - startedAtRef.current, text }])
    } catch (caught) {
      setTranscribeError((caught as Error).message)
    }
  }, [])

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null)
    setTranscribeError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      streamRef.current = stream
      recorderRef.current = recorder
      startedAtRef.current = Date.now()
      setLiveSegments([])
      setSeconds(0)

      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return
        queueRef.current = queueRef.current.then(() => handleChunk(event.data))
      }
      recorder.start(15000)
      setRecording(true)
      timerRef.current = window.setInterval(() => {
        setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }, 1000)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [handleChunk])

  const stopRecording = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current
    if (recorder) {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        recorder.stop()
      })
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
    recorderRef.current = null
    streamRef.current = null
    await queueRef.current
    setRecording(false)
  }, [])

  const saveMeeting = useCallback(
    async (title: string): Promise<void> => {
      if (liveSegments.length === 0) {
        setError('There is no transcript to save yet.')
        return
      }
      setMeetingBusy(true)
      try {
        setMeetings(
          await window.klyro.meetingSave({
            title,
            startedAt: startedAtRef.current,
            endedAt: Date.now(),
            segments: liveSegments
          })
        )
        setLiveSegments([])
      } catch (caught) {
        setError((caught as Error).message)
      } finally {
        setMeetingBusy(false)
      }
    },
    [liveSegments]
  )

  const summarizeMeeting = useCallback(async (id: string): Promise<void> => {
    setError(null)
    setMeetingBusy(true)
    try {
      setMeetings(await window.klyro.meetingSummarize(id))
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setMeetingBusy(false)
    }
  }, [])

  const deleteMeeting = useCallback(async (id: string): Promise<void> => {
    setMeetings(await window.klyro.meetingDelete(id))
  }, [])

  const discardRecording = useCallback((): void => {
    setLiveSegments([])
    setSeconds(0)
  }, [])

  const runWorkflow = useCallback(
    async (id: string): Promise<void> => {
      setError(null)
      setWorkflowRunning(id)
      setWorkflowSteps([])
      setWorkflowResult(null)
      try {
        const result = await window.klyro.workflowRun(id, workflowInput)
        setWorkflowResult({ conversationId: result.conversationId, steps: result.steps })
      } catch (caught) {
        setError((caught as Error).message)
      } finally {
        setWorkflowRunning(null)
      }
    },
    [workflowInput]
  )

  const deleteWorkflow = useCallback(async (id: string): Promise<void> => {
    try {
      setWorkflows(await window.klyro.workflowDelete(id))
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [])

  return {
    project,
    indexing,
    codeOutput,
    codeCitations,
    codeBusy,
    runCodeAction,
    indexProject,
    clearProject,
    meetings,
    recording,
    liveSegments,
    seconds,
    meetingBusy,
    startRecording,
    stopRecording,
    saveMeeting,
    summarizeMeeting,
    deleteMeeting,
    discardRecording,
    transcribeError,
    workflows,
    workflowInput,
    setWorkflowInput,
    workflowRunning,
    workflowSteps,
    workflowResult,
    runWorkflow,
    deleteWorkflow,
    error
  }
}
