import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Copy,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  Headphones,
  History,
  Info,
  Loader2,
  Mic,
  Minus,
  Monitor,
  RefreshCcw,
  ScanEye,
  Square,
  Trash2,
  TriangleAlert,
  X,
  Sparkles,
  FileText,
  ShieldAlert,
  Zap,
  Calendar,
  Compass,
  Ghost,
  Smartphone,
  Keyboard,
  LayoutDashboard
} from 'lucide-react'
import { RsvpReader } from './components/RsvpReader'
import {
  createSilenceWatcher,
  createLevelWatcher,
  UtteranceAssembler,
  type LevelWatcher,
  isNoAnswer,
  isSpeech,
  listenPrompt,
  looksLikeQuestion,
  pickRecordMimeType,
  rmsFromTimeDomain,
  snippetPrompt,
  utteranceEnded,
  utteranceWorthAsking,
  decodeAudioToPcm16kBuffer,
  HARDWARE_AUDIO_CONSTRAINTS,
  type SilenceWatcher
} from './lib/listen'
import { createDualAudioStream } from './lib/audio-mixer'
import { diarizer } from './lib/diarization'
import type { Attachment, CalendarEvent } from '@shared/types'
import { ModelPicker, type PickerGroup } from './components/ModelPicker'
import { recentModels, rememberModel } from './lib/recent'
import { knownModelNames, rememberModelNames } from './lib/modelNames'
import { StatusDot } from './components/ui'
import KlyroMark from './assets/logo/klyro-mark.svg'

type AssistMode = 'idle' | 'recording' | 'listening'

/** How small the recorded slices are: the finer, the sooner a question ends. */
const SLICE_MS = 250

/** The window is sized by its content, between these two heights. */
const MIN_OVERLAY_HEIGHT = 150
const MAX_OVERLAY_HEIGHT = 520

export interface SessionTiming {
  ms: number
  totalMs: number
  model?: string
  cached?: boolean
  e2eMs?: number
  budgetMet?: boolean
  fallback?: { from: string; to: string; reason: string }
}

export interface SessionTurn {
  id: string
  question: string
  answer: string
  timing?: SessionTiming | null
}

function RenderAnswerWithCitations({ text }: { text: string }): React.ReactElement | null {
  if (!text) return null
  const citationRegex = /\[Source:\s*([^\]]+)\]/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = citationRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const sourceLabel = match[1].trim()
    parts.push(
      <span
        key={`${match.index}-${sourceLabel}`}
        className="overlay__citation-badge"
        title={`Verified knowledge source: ${sourceLabel}`}
      >
        <span className="overlay__citation-icon" aria-hidden="true">📄</span>
        <span>{sourceLabel}</span>
      </span>
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <>{parts}</>
}

export default function OverlayApp() {
  const [text, setText] = useState('')
  const [answer, setAnswer] = useState('')
  /** The question as it was asked, so the answer has a subject. */
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<SessionTurn[]>([])
  const [copiedHistoryId, setCopiedHistoryId] = useState<string | null>(null)
  const currentTurnRef = useRef<{
    question: string
    answer: string
    timing: SessionTiming | null
    e2eMs?: number
    budgetMet?: boolean
  }>({
    question: '',
    answer: '',
    timing: null
  })

  const archiveCurrentTurnIfAny = useCallback(() => {
    const cur = currentTurnRef.current
    if (cur.question && cur.answer && !isNoAnswer(cur.answer)) {
      setHistory((prev) => {
        const last = prev[prev.length - 1]
        if (last && last.question === cur.question && last.answer === cur.answer) return prev
        return [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            question: cur.question,
            answer: cur.answer,
            timing: cur.timing
          }
        ]
      })
    }
  }, [])

  const [busy, setBusy] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  /** The interview this overlay is recording into, when it is recording one. */
  const [interviewId, setInterviewId] = useState<string | null>(null)
  const interviewRef = useRef<string | null>(null)
  interviewRef.current = interviewId
  const [lastFinishedInterviewId, setLastFinishedInterviewId] = useState<string | null>(null)
  const [showScratchpad, setShowScratchpad] = useState(false)
  const [scratchpadText, setScratchpadText] = useState('')
  const [talkRatioPct, setTalkRatioPct] = useState(0)
  const talkTicksRef = useRef(0)
  const totalTicksRef = useRef(0)
  const [privateMode, setPrivateMode] = useState<{ supported: boolean; enabled: boolean } | null>(null)
  const [ghostMode, setGhostMode] = useState(false)
  const [decoyMode, setDecoyMode] = useState(false)
  const [prompterMode, setPrompterMode] = useState(false)
  const [zeroFocus, setZeroFocus] = useState(false)
  const [showRsvp, setShowRsvp] = useState(false)
  const [showRemoteHudModal, setShowRemoteHudModal] = useState(false)
  const [remoteHudUrl, setRemoteHudUrl] = useState<string | null>(null)
  const [humanizing, setHumanizing] = useState(false)
  const lastEscPressRef = useRef(0)
  const [mode, setMode] = useState<AssistMode>('idle')
  const [transcript, setTranscript] = useState<string[]>([])
  const [autoAnswer, setAutoAnswer] = useState(true)
  const [assistNote, setAssistNote] = useState<string | null>(null)
  /** A provider failure, shown as an error rather than as a hint. */
  const [errorText, setErrorText] = useState<string | null>(null)
  const [assistSource, setAssistSource] = useState<string | null>(null)
  const audioCleanupRef = useRef<(() => void) | null>(null)
  const audioFeaturesRef = useRef<(() => { micEnergy: number; sysEnergy: number; sysFft?: Uint8Array }) | null>(null)
  // A screen capture waiting to be sent with the next question.
  const [capture, setCapture] = useState<{ dataUrl: string; name: string } | null>(null)
  // Conversation mode: continuous listening, speech-triggered answers.
  const [talkState, setTalkState] = useState<'idle' | 'listening' | 'hearing' | 'thinking'>('idle')
  const [level, setLevel] = useState(0)
  const [partialText, setPartialText] = useState('')
  // Screens and windows to choose from (instant capture turned off).
  const [overlaySources, setOverlaySources] = useState<Array<{ id: string; name: string; thumbnail: string }> | null>(null)
  // The provider the overlay answers with, and the model it uses.
  const [overlayProvider, setOverlayProvider] = useState('')
  const [overlayModel, setOverlayModel] = useState('')
  /** Something the user should know about the provider in use. */
  const [providerNote, setProviderNote] = useState<string | null>(null)
  /** Whether the model in use can read a picture. */
  const [vision, setVision] = useState<'yes' | 'no' | 'unknown'>('unknown')
  /** The models used recently, offered first in the picker. */
  const [recent, setRecent] = useState<string[]>([])
  /** The names models had when they were last listed, by id. */
  const [knownNames, setKnownNames] = useState<Record<string, string>>({})
  /** The name of the provider in use, for the chip. */
  const [providerLabel, setProviderLabel] = useState('')
  // Every connected provider's models, loaded when the picker opens.
  const [catalogue, setCatalogue] = useState<PickerGroup[]>([])
  const [catalogueNote, setCatalogueNote] = useState<string | null>(null)
  const [catalogueLoading, setCatalogueLoading] = useState(false)
  // True while a capture is in flight — the shot takes a moment, so say so.
  const [capturing, setCapturing] = useState(false)
  // How long the last answer took, and whether it was replayed instantly.
  const [timing, setTiming] = useState<SessionTiming | null>(null)
  const [copied, setCopied] = useState(false)
  const [upcomingMeeting, setUpcomingMeeting] = useState<CalendarEvent | null>(null)
  const utteranceEndedAtRef = useRef<number | null>(null)
  const firstTokenReceivedRef = useRef(false)
  const [streamingE2e, setStreamingE2e] = useState<number | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const responseRef = useRef<HTMLElement | null>(null)
  const answerTextRef = useRef<HTMLDivElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const mimeRef = useRef('audio/webm')
  const gateRef = useRef<SilenceWatcher | null>(null)
  /** The room's level, while the listen mode is running. */
  const levelRef = useRef<LevelWatcher | null>(null)
  /** The recorded slices, waiting to become a question. */
  const assemblerRef = useRef<UtteranceAssembler | null>(null)
  /** The poll that notices a question has ended. */
  const listenTimerRef = useRef<number | null>(null)
  const tokenBufferRef = useRef('')
  const tokenRafIdRef = useRef<number | null>(null)
  const speculativeBusyRef = useRef(false)
  const modeRef = useRef<AssistMode>('idle')
  const busyRef = useRef(false)
  const autoRef = useRef(true)
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const lastQuestionRef = useRef('')
  const isWindows = /Win/i.test(navigator.platform)
  const isLinux = /Linux/i.test(navigator.platform) && !isWindows

  /**
   * Re-read the provider in use.
   *
   * The overlay window is created at launch and stays alive while it is hidden,
   * so a provider connected afterwards in the control panel would otherwise be
   * invisible here until the app restarted. It re-syncs whenever it is shown.
   */
  const syncProvider = useCallback(async (): Promise<void> => {
    try {
      const settings = await window.klyro.getSettings()
      const provider = settings.providers[settings.activeProvider]
      setOverlayProvider(settings.activeProvider)
      // An empty fast model means "the same model as the chat", so that is
      // what the picker shows.
      setOverlayModel(provider?.fastModel || provider?.model || '')
      // A provider that is missing its key cannot answer, and the user should
      // know before they ask.
      const providers = await window.klyro.listProviders().catch(() => [])
      const active = providers.find((entry) => entry.id === settings.activeProvider)
      setProviderNote(
        active && active.requiresKey && !active.hasKey
          ? `${active.label} has no key yet — add one in Models & Agents.`
          : null
      )
      setVision(active?.vision ?? 'unknown')
    } catch {
      // Keep the last known provider; it still answers.
    }
  }, [])

  /** Ask every connected provider for its models — when the menu opens. */
  const loadCatalogue = useCallback(async (): Promise<void> => {
    setCatalogueLoading(true)
    try {
      const groups = await window.klyro.overlayCatalogue()
      setCatalogue(groups)
      // Remember what the models are called: an agent IDE can be closed and a
      // local server can be stopped while the model stays the same, and the
      // chip should still say "Claude Opus 4.6".
      rememberModelNames(groups.flatMap((group) => group.models))
      setKnownNames(knownModelNames())
      // The chip names the provider when the model itself has no name.
      const settings = await window.klyro.getSettings().catch(() => null)
      const active = groups.find((group) => group.id === settings?.activeProvider)
      if (active) setProviderLabel(active.label)
      setCatalogueNote(
        groups.length === 0
          ? 'No provider is connected yet. Connect one in the control panel.'
          : null
      )
    } catch (error) {
      setCatalogueNote((error as Error).message)
    } finally {
      setCatalogueLoading(false)
    }
  }, [])

  /**
   * Size the window to the content.
   *
   * The idle overlay is a small box; an answer makes it taller, and the
   * answer scrolls inside once it reaches the limit. The window follows the
   * content instead of the content following the window.
   */
  const resizeToContent = useCallback((): void => {
    const inner = innerRef.current
    if (!inner) return
    // The wrapper is as tall as its content wants to be; the window follows it.
    const wanted = inner.scrollHeight
    const height = Math.max(MIN_OVERLAY_HEIGHT, Math.min(MAX_OVERLAY_HEIGHT, Math.round(wanted)))
    void window.klyro.resizeOverlay?.(height)
  }, [])

  useLayoutEffect(() => {
    resizeToContent()
  }, [answer, question, history, transcript, capture, overlaySources, mode, talkState, timing, upcomingMeeting, resizeToContent])

  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight
    }
  }, [history, answer, question, busy])

  /**
   * Make room for the model menu.
   *
   * The overlay is a small window; a menu that hangs below the chip is
   * clipped by the window's own edge. The window grows for as long as the
   * menu is open, and shrinks back to its content when it closes.
   */
  const growForMenu = useCallback((): void => {
    const base = innerRef.current?.scrollHeight ?? MIN_OVERLAY_HEIGHT
    void window.klyro.resizeOverlay?.(Math.min(MAX_OVERLAY_HEIGHT, Math.max(base + 220, 350)))
  }, [])

  const shrinkAfterMenu = useCallback((): void => {
    resizeToContent()
  }, [resizeToContent])

  const startResize = useCallback(
    (axis: 'x' | 'y' | 'both') => (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.screenX
      const startY = e.screenY
      const startWidth = window.innerWidth
      const startHeight = window.innerHeight

      const onPointerMove = (moveEv: PointerEvent) => {
        const deltaX = moveEv.screenX - startX
        const deltaY = moveEv.screenY - startY
        const newWidth = axis === 'y' ? undefined : Math.max(420, Math.min(1400, Math.round(startWidth + deltaX)))
        const newHeight = axis === 'x' ? window.innerHeight : Math.max(MIN_OVERLAY_HEIGHT, Math.min(MAX_OVERLAY_HEIGHT, Math.round(startHeight + deltaY)))
        void window.klyro.resizeOverlay?.(newHeight, newWidth)
      }

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
    },
    []
  )

  useEffect(() => {
    setRecent(recentModels())
    setKnownNames(knownModelNames())
    void window.klyro.privateModeStatus().then(setPrivateMode).catch(() => setPrivateMode(null))
    void syncProvider()
    // Load the names in the background so the chip shows "Claude Sonnet 4"
    // instead of a raw id; the list is refreshed again when it is opened.
    void loadCatalogue()
    // The hotkey shows and focuses the overlay; both events mean "settings may
    // have changed while I was hidden".
    const onFocus = (): void => {
      void syncProvider()
      // The window may have been shown with a stale height: measure again.
      resizeToContent()
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void syncProvider()
        return
      }
      // A hidden overlay must not keep the microphone open: there is no UI
      // left to stop it. This is what makes "hide everything" a pause rather
      // than a silent recording session.
      if (modeRef.current !== 'idle') void stopListening()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    // The control panel can change the provider or the model at any time.
    const offSettings = window.klyro.onSettingsChanged?.(() => {
      void syncProvider()
      void loadCatalogue()
    })
    const offChat = window.klyro.onChatStream((event) => {
      if (event.type === 'start') {
        if (tokenRafIdRef.current !== null) {
          window.cancelAnimationFrame(tokenRafIdRef.current)
          tokenRafIdRef.current = null
        }
        tokenBufferRef.current = ''
        setAnswer('')
        currentTurnRef.current.answer = ''
        talkRef.current.answering = true
        firstTokenReceivedRef.current = false
        setStreamingE2e(null)
        // The conversation mode has its own status line; a typed question does
        // not need one.
        if (talkRef.current.timer !== null) setTalkState('thinking')
      } else if (event.type === 'delta') {
        if (!firstTokenReceivedRef.current) {
          firstTokenReceivedRef.current = true
          const e2e = utteranceEndedAtRef.current ? Date.now() - utteranceEndedAtRef.current : undefined
          currentTurnRef.current.e2eMs = e2e
          currentTurnRef.current.budgetMet = e2e !== undefined ? e2e <= 2000 : undefined
          if (e2e !== undefined) setStreamingE2e(e2e)
        }
        currentTurnRef.current.answer += event.text
        tokenBufferRef.current += event.text
        if (tokenRafIdRef.current === null) {
          tokenRafIdRef.current = window.requestAnimationFrame(() => {
            tokenRafIdRef.current = null
            const pending = tokenBufferRef.current
            tokenBufferRef.current = ''
            if (pending) {
              setAnswer((prev) => prev + pending)
            }
          })
        }
      } else if (event.type === 'done' || event.type === 'error') {
        if (tokenRafIdRef.current !== null) {
          window.cancelAnimationFrame(tokenRafIdRef.current)
          tokenRafIdRef.current = null
        }
        if (tokenBufferRef.current) {
          const pending = tokenBufferRef.current
          tokenBufferRef.current = ''
          setAnswer((prev) => prev + pending)
        }
        setBusy(false)
        talkRef.current.answering = false
        setStreamingE2e(null)
        if (talkRef.current.timer !== null) setTalkState('listening')
        if (event.type === 'done') {
          const timingObj: SessionTiming = {
            ms: event.ms ?? 0,
            totalMs: event.totalMs ?? 0,
            model: event.model,
            cached: event.cached,
            e2eMs: currentTurnRef.current.e2eMs,
            budgetMet: currentTurnRef.current.budgetMet,
            fallback: event.fallback
          }
          currentTurnRef.current.timing = timingObj
          setTiming(timingObj)
        }
        if (event.type === 'error') setErrorText(event.message)
        // Once the answer landed and nothing is still recording, the overlay
        // can go back to hiding on blur.
        if (modeRef.current === 'idle') void window.klyro.setRecordingSticky(false)
      }
    })
    return () => {
      if (tokenRafIdRef.current !== null) {
        window.cancelAnimationFrame(tokenRafIdRef.current)
        tokenRafIdRef.current = null
      }
      offChat()
      offSettings?.()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadCatalogue, resizeToContent, syncProvider])

  useEffect(() => {
    void window.klyro.remoteHudStatus?.().then((res) => {
      if (res?.running && res.url) setRemoteHudUrl(res.url)
    })
    const offReset = window.klyro.onEmergencyReset?.(() => {
      // Panic is a full stop, not just a hidden window: release the mic and
      // forget the session so nothing keeps recording behind the curtain.
      teardownRecording()
      modeRef.current = 'idle'
      busyRef.current = false
      setMode('idle')
      setInterviewId(null)
      setBusy(false)
      setAnswer('')
      setQuestion('')
      setTranscript([])
      setTiming(null)
      setErrorText(null)
      setDecoyMode(false)
      setPrompterMode(false)
      setGhostMode(false)
      setZeroFocus(false)
      setShowRsvp(false)
      setShowRemoteHudModal(false)
      setRemoteHudUrl(null)
    })
    const offGhost = window.klyro.onGhostModeChanged?.((ghost) => {
      setGhostMode(ghost)
    })
    const offZeroFocus = window.klyro.onZeroFocusChanged?.((zf) => {
      setZeroFocus(zf)
    })
    return () => {
      offReset?.()
      offGhost?.()
      offZeroFocus?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        const now = Date.now()
        // Double-tap Escape (<350ms) triggers panic killswitch
        if (now - lastEscPressRef.current < 350) {
          void window.klyro.panicKillswitch?.()
          return
        }
        lastEscPressRef.current = now
        if (showRsvp) {
          setShowRsvp(false)
          return
        }
        if (showRemoteHudModal) {
          setShowRemoteHudModal(false)
          return
        }
        if (decoyMode) {
          setDecoyMode(false)
          return
        }
        if (modeRef.current === 'idle') void window.klyro.hideOverlay()
      } else if (event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        setDecoyMode((prev) => !prev)
      } else if (event.altKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setPrompterMode((prev) => {
          const next = !prev
          if (next) void window.klyro.snapToNotch?.()
          return next
        })
      } else if (event.altKey && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        setShowRsvp((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [decoyMode, showRsvp, showRemoteHudModal])

  // Release the microphone when the overlay goes away — once, on unmount. This
  // cleanup used to live in the key handler effect above, so toggling decoy,
  // RSVP, or the phone panel mid-meeting stopped the recording.
  useEffect(() => {
    return () => teardownRecording()
  }, [])

  /** Periodically check for upcoming or active meetings (1 minute before call). */
  useEffect(() => {
    let cancelled = false
    const checkUpcoming = async (): Promise<void> => {
      if (modeRef.current !== 'idle') return
      // A hidden overlay must not keep enumerating desktop windows every 30
      // seconds: there is no prompt to show, and the scan can touch the OS
      // capture permission. It runs again as soon as the overlay is visible.
      if (document.visibilityState !== 'visible') return
      try {
        const next = await window.klyro.calendarGetUpcoming?.()
        if (!cancelled) {
          setUpcomingMeeting(next || null)
        }
      } catch {
        // Ignored
      }
    }

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void checkUpcoming()
    }

    void checkUpcoming()
    const timer = window.setInterval(() => {
      void checkUpcoming()
    }, 12000)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [mode])

  // Private-mode toggle (eye): keep the overlay out of captures and shares.
  async function togglePrivate(): Promise<void> {
    if (!privateMode) return
    const next = !privateMode.enabled
    setPrivateMode({ ...privateMode, enabled: next })
    try {
      await window.klyro.updateSettings({ overlayPrivateMode: next })
    } catch {
      setPrivateMode((prev) => (prev ? { ...prev, enabled: !next } : prev))
    }
  }

  function teardownRecording(): void {
    // Conversation mode holds an open microphone: it must be released with the
    // overlay, or the mic stays hot after the window is gone.
    stopTalking()
    recorderRef.current?.state === 'recording' && recorderRef.current.stop()
    audioCleanupRef.current?.()
    audioCleanupRef.current = null
    audioFeaturesRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
    gateRef.current?.dispose()
    gateRef.current = null
    if (listenTimerRef.current !== null) {
      window.clearInterval(listenTimerRef.current)
      listenTimerRef.current = null
    }
    levelRef.current?.dispose()
    levelRef.current = null
    assemblerRef.current = null
    chainRef.current = Promise.resolve()
    void window.klyro.setRecordingSticky(false)
  }

  async function openStream(): Promise<void> {
    setAssistNote(null)
    try {
      const dual = await createDualAudioStream(isWindows, isLinux)
      streamRef.current = dual.stream
      audioCleanupRef.current = dual.cleanup
      audioFeaturesRef.current = dual.getAudioFeatures ?? null
      setAssistSource(dual.label)
      if (dual.note) {
        setAssistNote(dual.note)
      }
    } catch {
      // Fallback: pure microphone if system audio loopback and mixer fail
      const stream = await navigator.mediaDevices.getUserMedia({ audio: HARDWARE_AUDIO_CONSTRAINTS })
      streamRef.current = stream
      audioFeaturesRef.current = () => ({ micEnergy: 0.05, sysEnergy: 0 })
      setAssistSource('Microphone')
      if (isWindows) {
        setAssistNote('System audio loopback unavailable; recording microphone only.')
      } else if (isLinux) {
        setAssistNote('No system monitor audio detected; recording microphone only.')
      }
    }
    const mimeType = pickRecordMimeType()
    const stream2 = streamRef.current
    if (!stream2) throw new Error('Nothing to record from.')
    // Level watcher: lets listen mode skip transcription on silence-only
    // chunks so a quiet meeting costs zero provider calls.
    gateRef.current?.dispose()
    gateRef.current = createSilenceWatcher(stream2)
    const recorder = mimeType ? new MediaRecorder(stream2, { mimeType }) : new MediaRecorder(stream2)
    mimeRef.current = recorder.mimeType || mimeType || 'audio/webm'
    chunksRef.current = []
    recorderRef.current = recorder
    await window.klyro.setRecordingSticky(true)
  }

  function stopRecorder(): Promise<Blob> {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(new Blob(chunksRef.current, { type: mimeRef.current }))
    return new Promise((resolve) => {
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        recorderRef.current = null
        resolve(new Blob(chunksRef.current, { type: mimeRef.current }))
      }
      recorder.stop()
    })
  }

  /** Send one framed prompt; the answer streams into the box. */
  async function askAssist(content: string): Promise<void> {
    if (busyRef.current) return
    let id = conversationId
    if (!id) {
      const conversation = await window.klyro.createConversation()
      id = conversation.id
      setConversationId(id)
    }
    busyRef.current = true
    setBusy(true)
    setAssistNote(null)
    try {
      await window.klyro.sendChat({
        conversationId: id,
        content,
        attachments: captureAttachments(),
        useFastModel: true,
        interviewId: interviewRef.current ?? undefined,
        source: 'text'
      })
      setCapture(null)
    } catch (error) {
      busyRef.current = false
      setBusy(false)
      setAssistNote((error as Error).message)
    }
  }

  /** The pending capture, as a chat attachment (undefined when there is none). */
  function captureAttachments(): Attachment[] | undefined {
    if (!capture) return undefined
    return [{ kind: 'image', mime: 'image/png', dataUrl: capture.dataUrl, label: capture.name }]
  }

  /**
   * Capture what is on screen. Klyro hides its own windows for the moment of
   * the capture, so the picture shows the app you are working in — and the
   * capture travels with your question to a vision model.
   *
   * With instant capture on (the default) this is a single click: the display
   * below the overlay is captured and attached. With it off, a compact list of
   * screens and windows appears so the user can choose.
   */
  async function captureScreen(): Promise<void> {
    if (busyRef.current || capturing) return
    setAssistNote(null)
    setCapturing(true)
    try {
      const settings = await window.klyro.getSettings()
      if (settings?.screenAutoCapture !== false) {
        const shot = await window.klyro.grabScreen()
        setCapture({ dataUrl: shot.dataUrl, name: shot.name })
        setAssistNote('Captured what is below Klyro — ask your question.')
        window.setTimeout(() => inputRef.current?.focus(), 30)
        return
      }
      setOverlaySources(await window.klyro.listCaptureSources())
    } catch (error) {
      setAssistNote((error as Error).message)
    } finally {
      setCapturing(false)
    }
  }

  /** Pick a specific screen or window (instant capture turned off). */
  async function captureSource(id: string): Promise<void> {
    setOverlaySources(null)
    try {
      const shot = await window.klyro.grabScreen(id)
      setCapture({ dataUrl: shot.dataUrl, name: shot.name })
      window.setTimeout(() => inputRef.current?.focus(), 30)
    } catch (error) {
      setAssistNote((error as Error).message)
    }
  }

  /* ---------------------------------------------------------------------
   * Conversation mode: talk to Klyro like a person.
   *
   * The microphone stays open; a level watcher decides when an utterance
   * starts and ends. When it ends, the clip is transcribed and answered —
   * with the screen attached, so the answer is about what you are looking at
   * while you say it. Speak again while the answer is still streaming and the
   * answer is cut off: you interrupted, and the new words are the question.
   * -------------------------------------------------------------------- */

  const talkRef = useRef<{
    stream: MediaStream | null
    recorder: MediaRecorder | null
    analyser: AnalyserNode | null
    context: AudioContext | null
    buffer: Uint8Array<ArrayBuffer> | null
    chunks: Blob[]
    mark: number
    speaking: boolean
    lastVoiceAt: number
    startedAt: number
    timer: number | null
    answering: boolean
    lastPartialAt: number
    partialBusy: boolean
  }>({
    stream: null,
    recorder: null,
    analyser: null,
    context: null,
    buffer: null,
    chunks: [],
    mark: 0,
    speaking: false,
    lastVoiceAt: 0,
    startedAt: 0,
    timer: null,
    answering: false,
    lastPartialAt: 0,
    partialBusy: false
  })

  /** Answer a spoken question, with the screen attached when possible. */
  const askSpoken = useCallback(async (spoken: string): Promise<void> => {
    if (!spoken.trim()) return
    archiveCurrentTurnIfAny()
    currentTurnRef.current = { question: spoken, answer: '', timing: null }
    setAnswer('')
    setQuestion(spoken)
    setTiming(null)
    setTalkState('thinking')
    try {
      let id = conversationId
      if (!id) {
        const conversation = await window.klyro.createConversation()
        id = conversation.id
        setConversationId(id)
      }
      let attachments: Attachment[] | undefined
      try {
        const shot = await window.klyro.grabScreen()
        attachments = [{ kind: 'image', mime: 'image/png', dataUrl: shot.dataUrl, label: shot.name }]
      } catch {
        // No screen? Answer from the words alone.
      }
      await window.klyro.sendChat({
        conversationId: id,
        content: spoken,
        attachments,
        useFastModel: true,
        interviewId: interviewRef.current ?? undefined,
        source: 'voice'
      })
    } catch (error) {
      setTalkState('listening')
      setAssistNote((error as Error).message)
    }
  }, [conversationId])

  /** Transcribe the finished utterance and ask it. */
  const flushUtterance = useCallback(async (): Promise<void> => {
    const talk = talkRef.current
    const duration = Date.now() - talk.startedAt
    const pieces = talk.chunks.slice(talk.mark)
    talk.chunks.length = 0
    talk.mark = 0
    talk.speaking = false
    setPartialText('')
    if (!utteranceWorthAsking(duration) || pieces.length === 0) {
      setTalkState('listening')
      return
    }
    const blob = new Blob(pieces, { type: talk.recorder?.mimeType || 'audio/webm' })
    try {
      const buffer = await blob.arrayBuffer()
      const pcmBuffer = await decodeAudioToPcm16kBuffer(blob).catch(() => null)
      const result = await window.klyro.transcribe(buffer, blob.type, pcmBuffer || undefined)
      const spoken = result.text.trim()
      if (!spoken) {
        setTalkState('listening')
        return
      }
      setTranscript((previous) => [...previous, spoken].slice(-8))
      await askSpoken(spoken)
    } catch (error) {
      setTalkState('listening')
      setAssistNote((error as Error).message)
    }
  }, [askSpoken])

  const stopTalking = useCallback((): void => {
    const talk = talkRef.current
    if (talk.timer !== null) window.clearInterval(talk.timer)
    talk.timer = null
    talk.recorder?.state === 'recording' && talk.recorder.stop()
    talk.recorder = null
    talk.stream?.getTracks().forEach((track) => track.stop())
    talk.stream = null
    void talk.context?.close().catch(() => undefined)
    talk.context = null
    talk.analyser = null
    talk.chunks = []
    talk.speaking = false
    talk.lastPartialAt = 0
    talk.partialBusy = false
    setPartialText('')
    setTalkState('idle')
    setLevel(0)
  }, [])

  const startTalking = useCallback(async (): Promise<void> => {
    setAssistNote(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: HARDWARE_AUDIO_CONSTRAINTS })
      const talk = talkRef.current
      talk.stream = stream

      // Level watcher for speech detection.
      const AudioCtor = window.AudioContext
      if (AudioCtor) {
        const context = new AudioCtor()
        const analyser = context.createAnalyser()
        analyser.fftSize = 2048
        context.createMediaStreamSource(stream).connect(analyser)
        talk.context = context
        talk.analyser = analyser
        talk.buffer = new Uint8Array(new ArrayBuffer(analyser.fftSize))
      }

      // Continuous recorder: chunks are sliced per utterance by the mark.
      const mimeType = pickRecordMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      talk.recorder = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          talk.chunks.push(event.data)
          // In-memory rolling circular buffer: keep max 16 idle slices (~4s) before speech starts
          if (!talk.speaking && talk.chunks.length > 16) {
            talk.chunks.shift()
          }
        }
      }
      recorder.start(250)

      setTalkState('listening')
      talk.timer = window.setInterval(() => {
        if (!talk.analyser || !talk.buffer) return
        talk.analyser.getByteTimeDomainData(talk.buffer)
        const rms = rmsFromTimeDomain(talk.buffer)
        setLevel(Math.min(1, rms * 12))
        const now = Date.now()
        if (isSpeech(rms)) {
          if (!talk.speaking) {
            // An utterance starts: remember where the audio begins with preroll.
            talk.speaking = true
            talk.startedAt = now
            talk.mark = Math.max(0, talk.chunks.length - 2)
            talk.lastPartialAt = now
            setTalkState('hearing')
            // Smart speculative pre-warming: wake model on voice detection
            void window.klyro.prewarmTranscribe?.()
          }
          talk.lastVoiceAt = now

          // Partial Streaming Whisper: interim transcription while speaker is talking
          if (!talk.partialBusy && now - talk.lastPartialAt > 750) {
            const livePieces = talk.chunks.slice(talk.mark)
            if (livePieces.length >= 2) {
              talk.partialBusy = true
              talk.lastPartialAt = now
              const liveBlob = new Blob(livePieces, { type: talk.recorder?.mimeType || 'audio/webm' })
              decodeAudioToPcm16kBuffer(liveBlob)
                .then(async (pcm) => {
                  const arr = await liveBlob.arrayBuffer()
                  const res = await window.klyro.transcribe(arr, liveBlob.type, pcm)
                  if (res?.text && talk.speaking) {
                    setPartialText(res.text.trim())
                  }
                })
                .catch(() => undefined)
                .finally(() => {
                  talk.partialBusy = false
                })
            }
          }
          return
        }
        if (talk.speaking) {
          if (utteranceEnded(true, now - talk.lastVoiceAt)) {
            void flushUtterance()
            return
          }
        }
        // Barge-in: speaking while the answer is still streaming cuts it off.
        if (talk.answering && isSpeech(rms)) {
          talk.answering = false
          void window.klyro.abortChat()
        }
      }, 100)
    } catch (error) {
      setAssistNote(`Microphone unavailable: ${(error as Error).message}`)
      stopTalking()
    }
  }, [flushUtterance, stopTalking])

  async function transcribeBlob(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer()
    const pcm = await decodeAudioToPcm16kBuffer(blob).catch(() => null)
    return (await window.klyro.transcribe(buffer, mimeRef.current, pcm || undefined)).text.trim()
  }

  // ---------------------------------------------------------------------
  // Snippet mode: press once when a question starts, once when it ends.
  // ---------------------------------------------------------------------
  async function startSnippet(): Promise<void> {
    try {
      // The interview starts first: a snippet is part of an interview, and
      // the question and the answer are written down.
      if (!interviewRef.current) {
        const session = await window.klyro.interviewsStart({})
        setInterviewId(session.id)
      }
      await openStream()
      recorderRef.current?.start()
      modeRef.current = 'recording'
      setMode('recording')
    } catch (error) {
      setAssistNote((error as Error).message)
      teardownRecording()
    }
  }

  async function endSnippet(): Promise<void> {
    modeRef.current = 'idle'
    setMode('idle')
    const blob = await stopRecorder()
    try {
      const question = await transcribeBlob(blob)
      if (!question) {
        setAssistNote('Nothing was said in that clip.')
        return
      }
      archiveCurrentTurnIfAny()
      currentTurnRef.current = { question, answer: '', timing: null }
      setTranscript([`Q: ${question}`])
      void window.klyro.remoteHudTranscript?.(`Q: ${question}`)?.catch(() => undefined)
      setQuestion(question)
      await askAssist(snippetPrompt(question))
    } catch (error) {
      setAssistNote((error as Error).message)
    }
  }

  // ---------------------------------------------------------------------
  // Listen mode: continuous chunks; transcription chains so calls never
  // overlap, and a question auto-triggers an answer (cheap heuristic gate).
  // ---------------------------------------------------------------------
  async function startListening(meetingContext?: {
    title: string
    company?: string
    attendees?: string[]
    meetingUrl?: string
  }): Promise<void> {
    try {
      const company = meetingContext?.company || ''
      const role = meetingContext?.title || ''
      const session = await window.klyro.interviewsStart({ company, role })
      setInterviewId(session.id)

      if (meetingContext) {
        const attendeesStr = meetingContext.attendees?.length
          ? meetingContext.attendees.join(', ')
          : 'None listed'
        const prefillNotes = `Title: ${meetingContext.title}\nCompany: ${company || 'N/A'}\nParticipants: ${attendeesStr}\nMeeting Link: ${meetingContext.meetingUrl || 'N/A'}\n\nObjectives & Notes:\n- `
        await window.klyro.interviewsUpdate({
          id: session.id,
          company,
          role,
          notes: prefillNotes,
          tags: company ? [company] : []
        })
      }

      diarizer.reset()
      if (meetingContext?.attendees) {
        diarizer.setAttendees(meetingContext.attendees)
      }

      await openStream()
      modeRef.current = 'listening'
      setMode('listening')
      setTranscript([])
      setAnswer('')
      talkTicksRef.current = 0
      totalTicksRef.current = 0
      setTalkRatioPct(0)
      setScratchpadText('')
      setShowScratchpad(false)
      const recorder = recorderRef.current
      if (!recorder) return
      // The room is watched, and the audio is recorded in small slices, so a
      // question is handed over the moment it ends — not when a recording
      // chunk happens to finish.
      const watcher = createLevelWatcher(streamRef.current as MediaStream)
      levelRef.current = watcher
      const assembler = new UtteranceAssembler()
      assemblerRef.current = assembler
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return
        assembler.push(new Blob([event.data], { type: mimeRef.current }))
      }
      recorder.start(SLICE_MS)
      // Every 100 ms: has the question just ended?
      listenTimerRef.current = window.setInterval(() => {
        if (watcher?.isVoiced?.()) {
          void window.klyro.prewarmTranscribe?.()
          talkTicksRef.current++

          // Speculative streaming STT & prefix warm-up:
          // If utterance has been voiced for >1.2s, grab speculative prefix to warm up Whisper decoding
          if (!speculativeBusyRef.current) {
            const prefixBlob = assembler.takeSpeculativePrefix(watcher, 1200)
            if (prefixBlob) {
              speculativeBusyRef.current = true
              decodeAudioToPcm16kBuffer(prefixBlob)
                .then(async (pcm) => {
                  const arr = await prefixBlob.arrayBuffer()
                  await window.klyro.transcribe(arr, prefixBlob.type, pcm)
                })
                .catch(() => undefined)
                .finally(() => {
                  speculativeBusyRef.current = false
                })
            }
          }
        }
        totalTicksRef.current++
        if (totalTicksRef.current % 10 === 0 && totalTicksRef.current > 0) {
          setTalkRatioPct(Math.round((talkTicksRef.current / totalTicksRef.current) * 100))
        }
        const utterance = assembler.takeEndedUtterance(watcher)
        if (!utterance) return
        void handleQuestion(utterance)
      }, 100)
    } catch (error) {
      setAssistNote((error as Error).message)
      teardownRecording()
    }
  }

  async function startMeetingCoPilot(meeting: CalendarEvent): Promise<void> {
    try {
      await window.klyro.calendarDismiss?.(meeting.id)
      setUpcomingMeeting(null)
      await startListening({
        title: meeting.title,
        company: meeting.company,
        attendees: meeting.attendees,
        meetingUrl: meeting.meetingUrl
      })
      setAssistNote(`In-call co-pilot started for "${meeting.title}". Dual recording active.`)
    } catch (err) {
      setAssistNote((err as Error).message)
    }
  }

  async function dismissUpcomingMeeting(id: string): Promise<void> {
    try {
      setUpcomingMeeting(null)
      await window.klyro.calendarDismiss?.(id)
    } catch {
      // Ignored
    }
  }

  /**
   * A question was heard. Transcribe it, show it, and answer it.
   */
  async function handleQuestion(utterance: Blob): Promise<void> {
    const speechEndedAt = Date.now()
    utteranceEndedAtRef.current = speechEndedAt

    // Extract real-time audio channel features for local speaker diarization
    const features = audioFeaturesRef.current?.() || { micEnergy: 0.05, sysEnergy: 0 }
    const assignment = diarizer.identifySpeaker(features.micEnergy, features.sysEnergy, features.sysFft)

    try {
      const text = await transcribeBlob(utterance)
      if (!text) return

      // Dynamic name attribution if someone self-introduced
      diarizer.adaptSpeakerNames(text)
      const wordCount = text.split(/\s+/).filter(Boolean).length
      diarizer.recordSpeakerWords(assignment.speakerId, wordCount)

      const taggedLine = `[${assignment.label}]: ${text}`
      const next = [...transcript.slice(-7), taggedLine]
      setTranscript(next)
      // Mirror the live transcript to the phone HUD, not just the answer.
      void window.klyro.remoteHudTranscript?.(taggedLine)?.catch(() => undefined)

      if (interviewRef.current) {
        void window.klyro.interviewsAddTranscript?.({ id: interviewRef.current, line: taggedLine })
      }

      if (autoRef.current && !busyRef.current && looksLikeQuestion(text)) {
        archiveCurrentTurnIfAny()
        currentTurnRef.current = { question: taggedLine, answer: '', timing: null }
        setQuestion(taggedLine)
        setAnswer('')
        setBusy(true)
        await askAssist(listenPrompt(next))
      }
    } catch (error) {
      const message = (error as Error).message
      setAssistNote(message)
      // A provider that cannot transcribe will not transcribe the next
      // question either: stop listening and say so once, instead of showing
      // the same error for every question in the meeting.
      if (/not supported|cannot transcribe|transcription/i.test(message)) {
        await stopListening()
      }
    }
  }

  async function stopListening(): Promise<void> {
    const finishedId = interviewRef.current
    if (finishedId) {
      setLastFinishedInterviewId(finishedId)
      if (scratchpadText.trim()) {
        void window.klyro.interviewsUpdate({ id: finishedId, notes: scratchpadText.trim() })
      }
    }
    modeRef.current = 'idle'
    setMode('idle')
    await stopRecorder()
    if (listenTimerRef.current !== null) {
      window.clearInterval(listenTimerRef.current)
      listenTimerRef.current = null
    }
    levelRef.current?.dispose()
    levelRef.current = null
    assemblerRef.current = null
    chainRef.current = Promise.resolve()
    void window.klyro.setRecordingSticky(false)
  }

  /** Ask the question in the box. */
  async function ask(): Promise<void> {
    const content = text.trim()
    if (!content || busyRef.current) return
    utteranceEndedAtRef.current = Date.now()
    archiveCurrentTurnIfAny()
    currentTurnRef.current = { question: content, answer: '', timing: null }
    lastQuestionRef.current = content
    let id = conversationId
    if (!id) {
      const conversation = await window.klyro.createConversation()
      id = conversation.id
      setConversationId(id)
    }
    setQuestion(content)
    setAnswer('')
    setTiming(null)
    setAssistNote(null)
    setErrorText(null)
    setBusy(true)
    busyRef.current = true
    setText('')
    try {
      await window.klyro.sendChat({
        conversationId: id,
        content,
        attachments: captureAttachments(),
        useFastModel: true,
        interviewId: interviewRef.current ?? undefined,
        source: 'text'
      })
      setCapture(null)
    } catch (error) {
      setAssistNote((error as Error).message)
    } finally {
      setBusy(false)
      busyRef.current = false
    }
  }

  /** Ask the last question again. */
  async function retry(): Promise<void> {
    const content = lastQuestionRef.current
    if (!content || busyRef.current) return
    archiveCurrentTurnIfAny()
    currentTurnRef.current = { question: content, answer: '', timing: null }
    setAnswer('')
    setTiming(null)
    setBusy(true)
    busyRef.current = true
    try {
      let id = conversationId
      if (!id) {
        const conversation = await window.klyro.createConversation()
        id = conversation.id
        setConversationId(id)
      }
      await window.klyro.sendChat({
        conversationId: id,
        content,
        useFastModel: true,
        interviewId: interviewRef.current ?? undefined,
        source: 'text'
      })
    } catch (error) {
      setAssistNote((error as Error).message)
    } finally {
      setBusy(false)
      busyRef.current = false
    }
  }

  /** Copy the answer to the clipboard. */
  async function copyAnswer(): Promise<void> {
    if (!answer) return
    try {
      await navigator.clipboard.writeText(answer)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setAssistNote('The clipboard is not available here.')
    }
  }

  const assistBusy = mode !== 'idle'
  const recording = mode === 'recording' || mode === 'listening'
  const hasAnswer = Boolean(answer) && !isNoAnswer(answer)

  const glowClass = talkState === 'hearing'
    ? ' overlay--glow-hearing'
    : busy || talkState === 'thinking'
    ? ' overlay--glow-thinking'
    : mode === 'listening' || talkState === 'listening'
    ? ' overlay--glow-listening'
    : mode === 'recording'
    ? ' overlay--glow-recording'
    : ''

  return (
    <div
      className={`overlay${privateMode?.enabled ? ' overlay--private' : ''}${prompterMode ? ' overlay--prompter' : ''}${ghostMode ? ' overlay--ghost' : ''}${glowClass}`}
      ref={rootRef}
    >
      <div className="overlay__inner" ref={innerRef}>
        {decoyMode ? (
          <div
            className="overlay__decoy"
            onClick={() => setDecoyMode(false)}
            title="Click anywhere or press Alt+D to return to Klyro"
          >
            <div className="overlay__decoy-header">
              <span className="overlay__decoy-title">Meeting_Notes - Notepad</span>
              <div className="overlay__decoy-menu">
                <span>File</span>
                <span>Edit</span>
                <span>Format</span>
                <span>View</span>
                <span>Help</span>
              </div>
              <button
                type="button"
                className="overlay__decoy-close"
                onClick={(e) => {
                  e.stopPropagation()
                  setDecoyMode(false)
                }}
                aria-label="Exit camouflage"
              >
                ×
              </button>
            </div>
            <div className="overlay__decoy-content">
              <div className="overlay__decoy-line">Weekly Sync &amp; Objectives — Q4 Review:</div>
              <div className="overlay__decoy-line">• Team architecture roadmap and staging release verification</div>
              <div className="overlay__decoy-line">• Review open action items and tickets from previous sprint</div>
              <div className="overlay__decoy-line">• Client sync: discuss enterprise security &amp; procurement timeline</div>
              <div className="overlay__decoy-line">• Next milestone scheduled for Thursday 10:00 AM</div>
              <div className="overlay__decoy-cursor" />
            </div>
            <div className="overlay__decoy-footer">
              <span>Ln 5, Col 42</span>
              <span>100%</span>
              <span>Windows (CRLF)</span>
              <span>UTF-8</span>
            </div>
          </div>
        ) : (
          <>
            {ghostMode && (
              <div
                className="overlay__ghost-banner"
                onClick={() => {
                  setGhostMode(false)
                  void window.klyro.setGhostMode?.(false)
                }}
                title="Ghost mode active: click to restore regular interaction"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Ghost className="icon icon--xs" />
                  <span>Ghost Mode Active (Click-through)</span>
                </div>
                <span style={{ fontSize: 11, opacity: 0.8 }}>Press Ctrl+Shift+G to restore</span>
              </div>
            )}
            <header className="overlay__head">
        <div className="overlay__drag-grip" title="Drag to move anywhere on screen" aria-hidden="true">
          <GripVertical className="icon icon--xs" />
        </div>
        <img src={KlyroMark} alt="" className="overlay__mark" aria-hidden="true" />
        <span className="overlay__brand">Klyro</span>
        {overlayProvider && (
          <ModelPicker
            groups={catalogue}
            value={overlayModel}
            variant="chip"
            loading={catalogueLoading}
            note={catalogueNote}
            recent={recent}
            knownNames={knownNames}
            contextLabel={providerLabel}
            onOpen={() => {
              void syncProvider()
              void loadCatalogue()
              growForMenu()
            }}
            onClose={shrinkAfterMenu}
            onRefresh={() => void loadCatalogue()}
            onChange={(next, providerId) => {
              // A model from another provider switches the overlay to that
              // provider; the control panel uses the same choice.
              const target = providerId || overlayProvider
              setOverlayModel(next)
              setOverlayProvider(target)
              setRecent(rememberModel(next))
              void (async () => {
                try {
                  const settings = await window.klyro.getSettings()
                  await window.klyro.updateSettings({
                    activeProvider: target,
                    providers: {
                      ...settings.providers,
                      [target]: { ...settings.providers[target], fastModel: next }
                    }
                  })
                } catch {
                  // The choice still shows; the next answer uses the old model.
                }
              })()
            }}
          />
        )}
        {vision === 'yes' && (
          <span className="overlay__state" title="This model can read the screen you share with it.">
            <ScanEye className="icon icon--xs" aria-hidden="true" />
            <span className="overlay__state-label">Reads images</span>
          </span>
        )}
        {providerNote && (
          <span className="overlay__state" title={providerNote}>
            <StatusDot state="warn" />
            <span className="overlay__state-label">No key</span>
          </span>
        )}
        {privateMode && (
          <button
            className="btn btn--icon btn--icon-sm btn--ghost"
            onClick={() => void togglePrivate()}
            disabled={!privateMode.supported}
            aria-pressed={privateMode.enabled}
            aria-label="Private mode: hide this overlay from screen captures and shares"
            title={
              privateMode.supported
                ? 'Private mode — keep this overlay out of screen shares and screenshots'
                : 'Private mode is not supported on Linux/X11: any capture of the whole display still shows this overlay'
            }
          >
            {privateMode.enabled ? <EyeOff className="icon icon--sm" aria-hidden="true" /> : <Eye className="icon icon--sm" aria-hidden="true" />}
          </button>
        )}
        <button
          type="button"
          className="btn btn--icon btn--icon-sm btn--ghost"
          onClick={() => void window.klyro.showMainWindow?.()}
          title="Open the Klyro control panel"
          aria-label="Open control panel"
        >
          <LayoutDashboard className="icon icon--sm" aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`btn btn--icon btn--icon-sm ${prompterMode ? 'btn--accent' : 'btn--ghost'}`}
          onClick={async () => {
            const next = !prompterMode
            setPrompterMode(next)
            if (next) await window.klyro.snapToNotch?.()
          }}
          title={prompterMode ? 'Exit Notch Teleprompter' : 'Snap under webcam (Direct Eye Contact Teleprompter) · Alt+P'}
          aria-label="Notch Teleprompter"
        >
          <Compass className="icon icon--sm" aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`btn btn--icon btn--icon-sm ${ghostMode ? 'btn--accent' : 'btn--ghost'}`}
          onClick={async () => {
            const next = !ghostMode
            setGhostMode(next)
            await window.klyro.setGhostMode?.(next)
          }}
          title={ghostMode ? 'Exit Ghost Mode' : 'Ghost Click-Through Mode (Transparent + Mouse Passthrough) · Ctrl+Shift+G'}
          aria-label="Ghost Mode"
        >
          <Ghost className="icon icon--sm" aria-hidden="true" />
        </button>

        <button
          type="button"
          className="btn btn--icon btn--icon-sm btn--ghost"
          onClick={() => setDecoyMode(true)}
          title="Emergency Decoy Camouflage (Notepad skin) · Alt+D"
          aria-label="Decoy Mode"
        >
          <FileText className="icon icon--sm" aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`btn btn--icon btn--icon-sm ${remoteHudUrl ? 'btn--accent' : 'btn--ghost'}`}
          onClick={async () => {
            try {
              if (!remoteHudUrl) {
                const res = await window.klyro.remoteHudStart?.()
                if (res?.url) setRemoteHudUrl(res.url)
              }
              setShowRemoteHudModal(!showRemoteHudModal)
            } catch (error) {
              setAssistNote(`Ghost Phone could not start: ${(error as Error).message}`)
            }
          }}
          title={remoteHudUrl ? `Ghost Phone Live at ${remoteHudUrl} (Click for controls)` : 'Start Ghost Phone Remote Mirror (Zero On-Screen Footprint)'}
          aria-label="Ghost Phone HUD"
        >
          <Smartphone className="icon icon--sm" aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`btn btn--icon btn--icon-sm ${zeroFocus ? 'btn--accent' : 'btn--ghost'}`}
          onClick={async () => {
            const next = !zeroFocus
            setZeroFocus(next)
            await window.klyro.setZeroFocus?.(next)
          }}
          title={zeroFocus ? 'Disable Zero-Focus (Overlay never steals focus)' : 'Zero-Focus Window (WS_EX_NOACTIVATE / stealth invisible focus)'}
          aria-label="Zero Focus"
        >
          <ShieldAlert className="icon icon--sm" aria-hidden="true" />
        </button>

        {hasAnswer && (
          <button
            type="button"
            className={`btn btn--icon btn--icon-sm ${showRsvp ? 'btn--accent' : 'btn--ghost'}`}
            onClick={() => setShowRsvp(!showRsvp)}
            title={showRsvp ? 'Close RSVP Eye-Gaze Flasher' : 'RSVP Eye-Gaze Reduction Flasher (Read answer at single focal point) · Alt+R'}
            aria-label="RSVP Flasher"
          >
            <Zap className="icon icon--sm" aria-hidden="true" />
          </button>
        )}

        <div className="overlay__controls">
          <button
            type="button"
            className="overlay__control-btn overlay__control-btn--minimize"
            onClick={() => void window.klyro.minimizeOverlay?.()}
            title="Minimize overlay"
            aria-label="Minimize"
          >
            <Minus className="icon icon--xs" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="overlay__control-btn overlay__control-btn--close"
            onClick={() => void window.klyro.hideOverlay()}
            title="Close overlay"
            aria-label="Close"
          >
            <X className="icon icon--xs" aria-hidden="true" />
          </button>
        </div>
      </header>

      {showRemoteHudModal && remoteHudUrl && (
        <div className="overlay__hud-modal">
          <div className="overlay__hud-modal-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Smartphone className="icon icon--xs" style={{ color: 'var(--accent)' }} />
              <strong>Ghost Phone Remote Mirror</strong>
            </div>
            <button
              type="button"
              className="btn btn--icon btn--icon-xs btn--ghost"
              onClick={() => setShowRemoteHudModal(false)}
            >
              <X className="icon icon--xs" />
            </button>
          </div>
          <p className="overlay__hud-modal-desc">
            Open this on your phone or tablet propped below your screen for <strong>zero laptop windows</strong>:
          </p>
          <div className="overlay__hud-modal-link">
            <code>{remoteHudUrl}</code>
            <button
              type="button"
              className="btn btn--quiet btn--xs"
              onClick={() => void navigator.clipboard.writeText(remoteHudUrl)}
            >
              Copy Link
            </button>
          </div>
          <div className="overlay__hud-modal-actions">
            <button
              type="button"
              className="btn btn--primary btn--xs"
              onClick={() => {
                setShowRemoteHudModal(false)
                void window.klyro.hideOverlay?.()
              }}
              title="Hide overlay now. Live answers continue streaming to your phone."
            >
              Hide Laptop Screen (Pure Phone Mode)
            </button>
          </div>
        </div>
      )}

      {upcomingMeeting && mode === 'idle' && (
        <div className="overlay__meeting-banner" role="status">
          <div className="overlay__meeting-banner-main">
            <div className="overlay__meeting-banner-icon">
              <Calendar className="icon icon--xs" />
            </div>
            <div className="overlay__meeting-banner-details">
              <div className="overlay__meeting-banner-title">
                {upcomingMeeting.title}
                {upcomingMeeting.company ? (
                  <span className="overlay__meeting-banner-company"> · {upcomingMeeting.company}</span>
                ) : null}
              </div>
              <div className="overlay__meeting-banner-sub">
                <span className="overlay__meeting-banner-status">
                  {upcomingMeeting.statusText || 'Starting now'}
                </span>
                {upcomingMeeting.attendees && upcomingMeeting.attendees.length > 0 ? (
                  <span className="overlay__meeting-banner-participants">
                    {' '}· {upcomingMeeting.attendees.length} participant{upcomingMeeting.attendees.length > 1 ? 's' : ''}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="overlay__meeting-banner-actions">
            <button
              type="button"
              className="btn btn--primary btn--xs overlay__meeting-banner-start"
              onClick={() => void startMeetingCoPilot(upcomingMeeting)}
              title="1-click start dual recording and pre-fill meeting details"
            >
              <Zap className="icon icon--xs" />
              <span>Start in-call co-pilot</span>
            </button>
            <button
              type="button"
              className="btn btn--icon btn--icon-xs btn--ghost"
              onClick={() => void dismissUpcomingMeeting(upcomingMeeting.id)}
              title="Dismiss prompt"
              aria-label="Dismiss"
            >
              <X className="icon icon--xs" />
            </button>
          </div>
        </div>
      )}

      <div className="overlay__composer">
        <textarea
          ref={inputRef}
          className="overlay__input"
          rows={1}
          value={text}
          placeholder={assistBusy ? 'Assist runs in this box…' : 'Ask anything…'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void ask()
            }
          }}
        />
        {busy ? (
          <button className="btn btn--danger overlay__ask" onClick={() => void window.klyro.abortChat()}>
            <Square className="icon icon--sm" aria-hidden="true" />
            <span>Stop</span>
          </button>
        ) : (
          <button className="btn btn--primary overlay__ask" onClick={() => void ask()} disabled={!text.trim()}>
            <span>Ask</span>
          </button>
        )}
      </div>

      <div className="overlay__toolbar" role="group" aria-label="Meeting assist">
        {mode === 'idle' && (
          <>
            <button
              className={`overlay__tool${capture ? ' overlay__tool--on' : ''}`}
              onClick={() => void captureScreen()}
              disabled={busy || capturing}
              title="Capture what is on screen and ask about it"
              aria-label="Capture screen"
            >
              {capturing ? (
                <Loader2 className="icon icon--xs spin" aria-hidden="true" />
              ) : (
                <Monitor className="icon icon--xs" aria-hidden="true" />
              )}
              <span>{capture ? 'Captured' : 'Screen'}</span>
            </button>
            <button
              className={`overlay__tool${talkState !== 'idle' ? ' overlay__tool--on' : ''}`}
              onClick={() => {
                if (talkState === 'idle') void startTalking()
                else stopTalking()
              }}
              disabled={busy}
              title="Talk to Klyro — it answers when you stop speaking"
              aria-label="Talk to Klyro"
            >
              <Mic className="icon icon--xs" aria-hidden="true" />
              <span>{talkState === 'idle' ? 'Talk' : 'Stop talking'}</span>
            </button>
            <button
              className="overlay__tool"
              onClick={() => void startSnippet()}
              disabled={busy || talkState !== 'idle'}
              title="Record one question: press once when it starts, once when it ends"
              aria-label="Record a question"
            >
              <Mic className="icon icon--xs" aria-hidden="true" />
              <span>Record</span>
            </button>
            <button
              className="overlay__tool"
              onClick={() => void startListening()}
              disabled={busy || talkState !== 'idle'}
              title="Listen to the meeting and answer the questions you hear"
              aria-label="Listen to the meeting"
            >
              <Headphones className="icon icon--xs" aria-hidden="true" />
              <span>Listen</span>
            </button>
          </>
        )}

        {mode === 'recording' && (
          <button className="overlay__tool overlay__tool--record" onClick={() => void endSnippet()}>
            <Square className="icon icon--xs" aria-hidden="true" />
            <span>Stop &amp; answer</span>
          </button>
        )}

        {mode === 'listening' && (
          <button className="overlay__tool overlay__tool--record" onClick={() => void stopListening()}>
            <Square className="icon icon--xs" aria-hidden="true" />
            <span>Stop listening</span>
          </button>
        )}

        {recording && (
          <span className="overlay__recording" role="status">
            <span className="overlay__recdot" aria-hidden="true" />
            {mode === 'recording' ? 'Recording' : 'Listening'}
            {mode === 'listening' && (
              <span className="overlay__waveform" title="Live audio activity" aria-hidden="true">
                <span className="overlay__waveform-bar" />
                <span className="overlay__waveform-bar" />
                <span className="overlay__waveform-bar" />
                <span className="overlay__waveform-bar" />
                <span className="overlay__waveform-bar" />
              </span>
            )}
          </span>
        )}

        {assistSource && (
          <span
            className={`overlay__source ${assistSource.includes('Dual') ? 'overlay__source--dual' : ''}`}
            title="Bot-free meeting recording source"
          >
            {assistSource.includes('Dual') ? (
              <Headphones className="icon icon--xs" aria-hidden="true" />
            ) : (
              <Mic className="icon icon--xs" aria-hidden="true" />
            )}
            <span>{assistSource}</span>
          </span>
        )}

        {mode === 'listening' && (
          <label className="overlay__tool" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoAnswer}
              onChange={(event) => {
                autoRef.current = event.target.checked
                setAutoAnswer(event.target.checked)
              }}
            />
            <span>Auto-answer</span>
          </label>
        )}

        {assistNote && (
          <span className="overlay__note" role="status">
            <Info className="icon icon--xs" aria-hidden="true" />
            <span>{assistNote}</span>
          </span>
        )}

        {history.length > 0 && mode === 'idle' && (
          <span className="overlay__session-badge" title="Questions asked in this session">
            <History className="icon icon--xs" aria-hidden="true" />
            <span>{history.length + (question ? 1 : 0)} in thread</span>
          </span>
        )}

        <span className="overlay__toolbar-hint">Esc to close · Enter to ask</span>
      </div>

      {mode === 'listening' && (
        <div className="overlay__copilot-bar">
          <button
            type="button"
            className="overlay__copilot-chip"
            disabled={busy || transcript.length === 0}
            onClick={async () => {
              const summaryContext = transcript.slice(-12).join('\n')
              if (!summaryContext) return
              archiveCurrentTurnIfAny()
              currentTurnRef.current = { question: 'Catch me up on what was just said', answer: '', timing: null }
              setQuestion('Catch me up on what was just said')
              setAnswer('')
              await askAssist(`In 3 concise, high-impact bullet points, summarize what was just discussed in this meeting:\n\n${summaryContext}`)
            }}
            title="3-bullet summary of the recent discussion so you never miss a beat"
          >
            <Zap className="icon icon--xs" style={{ color: 'var(--accent)' }} aria-hidden="true" />
            <span>Catch Me Up</span>
          </button>

          <button
            type="button"
            className="overlay__copilot-chip"
            disabled={busy || transcript.length === 0}
            onClick={async () => {
              const recent = transcript.slice(-4).join('\n')
              if (!recent) return
              archiveCurrentTurnIfAny()
              currentTurnRef.current = { question: 'Suggest response to objection', answer: '', timing: null }
              setQuestion('Suggest response to objection')
              setAnswer('')
              await askAssist(`The meeting attendee voiced this objection or point:\n"${recent}"\n\nProvide 2 tactful, persuasive, and professional ways to overcome this objection:`)
            }}
            title="Instant diplomatic responses to customer objections or skepticism"
          >
            <ShieldAlert className="icon icon--xs" style={{ color: 'var(--warning)' }} aria-hidden="true" />
            <span>Objection Helper</span>
          </button>

          <button
            type="button"
            className={`overlay__copilot-chip ${showScratchpad ? 'overlay__copilot-chip--active' : ''}`}
            onClick={() => setShowScratchpad(!showScratchpad)}
            title="Jot private notes live that automatically merge into the CRM recap"
          >
            <FileText className="icon icon--xs" aria-hidden="true" />
            <span>{showScratchpad ? 'Hide Notes' : 'Live Notes'}</span>
            {scratchpadText.trim() && <span className="overlay__copilot-dot" aria-hidden="true" />}
          </button>

          {talkRatioPct > 0 && (
            <span className="overlay__pacing-badge" title="Live audio active speaking percentage">
              <Mic className="icon icon--xs" aria-hidden="true" />
              <span>Audio: {talkRatioPct}%</span>
            </span>
          )}
        </div>
      )}

      {mode === 'listening' && showScratchpad && (
        <div className="overlay__scratchpad">
          <textarea
            rows={2}
            placeholder="Jot private notes live (will be blended into the final CRM notes)…"
            value={scratchpadText}
            onChange={(e) => {
              const val = e.target.value
              setScratchpadText(val)
              if (interviewRef.current) {
                void window.klyro.interviewsUpdate({ id: interviewRef.current, notes: val })
              }
            }}
          />
        </div>
      )}

      {lastFinishedInterviewId && (
        <div className="overlay__meeting-end-banner" role="status">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles className="icon icon--xs" style={{ color: 'var(--accent)' }} aria-hidden="true" />
            <span>Meeting captured · CRM Notes ready to build</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="btn btn--primary btn--xs"
              onClick={async () => {
                if (lastFinishedInterviewId) {
                  const targetId = lastFinishedInterviewId
                  setLastFinishedInterviewId(null)
                  await window.klyro.interviewsGenerateCrmNotes({ id: targetId })
                }
              }}
            >
              <span>Generate Notes</span>
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--xs"
              onClick={() => setLastFinishedInterviewId(null)}
              aria-label="Dismiss"
            >
              <X className="icon icon--xs" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {talkState !== 'idle' && (
        <div className="overlay__talk" aria-live="polite">
          <span className={`overlay__talk-dot overlay__talk-dot--${talkState}`} aria-hidden="true" />
          <span className="overlay__talk-label">
            {talkState === 'listening'
              ? 'Listening — speak whenever you like'
              : talkState === 'hearing'
                ? partialText ? `“${partialText}…”` : 'Hearing you…'
                : 'Thinking…'}
          </span>
          <span className="overlay__meter" aria-hidden="true">
            <span className="overlay__meter-fill" style={{ width: `${Math.round(Math.min(1, level) * 100)}%` }} />
          </span>
        </div>
      )}

      {transcript.length > 0 && (
        <div className="overlay__transcript" aria-live="polite">
          {transcript.slice(-3).map((line, index) => (
            <div key={`${index}-${line.slice(0, 24)}`} className="overlay__line">
              {line}
            </div>
          ))}
        </div>
      )}

      {overlaySources && (
        <div className="overlay__sources">
          {overlaySources.map((source) => (
            <button key={source.id} className="overlay__source-card" onClick={() => void captureSource(source.id)}>
              <img src={source.thumbnail} alt={source.name} />
              <span>{source.name}</span>
            </button>
          ))}
          <button className="btn btn--icon btn--icon-sm btn--ghost" onClick={() => setOverlaySources(null)} aria-label="Cancel">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}

      {capture && (
        <div className="overlay__capture">
          <img src={capture.dataUrl} alt={`Captured: ${capture.name}`} />
          <div className="overlay__capture-text">
            <strong>Screen captured</strong>
            <span>{capture.name} — attached to your next question</span>
          </div>
          <button
            className="btn btn--icon btn--icon-sm btn--ghost"
            onClick={() => setCapture(null)}
            aria-label="Remove the screen capture"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}

      {(history.length > 0 || question || hasAnswer || errorText || busy) && (
        <section className="overlay__response" ref={responseRef} aria-live="polite">
          {history.length > 0 && (
            <div className="overlay__session-header">
              <span className="overlay__session-title">
                <History className="icon icon--xs" aria-hidden="true" />
                <span>Session Thread ({history.length + (question ? 1 : 0)})</span>
              </span>
              <button
                type="button"
                className="btn btn--quiet btn--xs"
                onClick={() => {
                  setHistory([])
                  currentTurnRef.current = { question: '', answer: '', timing: null }
                }}
                title="Clear session history"
              >
                <Trash2 className="icon icon--xs" aria-hidden="true" />
                <span>Clear</span>
              </button>
            </div>
          )}

          {/* Previous turns from this session */}
          {history.map((turn) => (
            <div key={turn.id} className="overlay__turn">
              <div className="overlay__turn-user">
                <div className="overlay__user-bubble">{turn.question}</div>
              </div>
              <div className="overlay__turn-assistant">
                <div className="overlay__answer">
                  <div className="overlay__answer-text">
                    <RenderAnswerWithCitations text={turn.answer} />
                  </div>
                </div>
                <div className="overlay__turn-footer">
                  {turn.timing && (
                    <>
                      <span className="overlay__timing-badge">
                        {turn.timing.cached ? 'instant' : `${(turn.timing.ms / 1000).toFixed(2)}s`}
                      </span>
                      {turn.timing.model && <span className="overlay__model-tag">{turn.timing.model}</span>}
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn--quiet btn--xs"
                    onClick={async () => {
                      await navigator.clipboard.writeText(turn.answer)
                      setCopiedHistoryId(turn.id)
                      window.setTimeout(() => setCopiedHistoryId(null), 1500)
                    }}
                    title="Copy answer"
                  >
                    {copiedHistoryId === turn.id ? (
                      <Check className="icon icon--xs" aria-hidden="true" />
                    ) : (
                      <Copy className="icon icon--xs" aria-hidden="true" />
                    )}
                    <span>{copiedHistoryId === turn.id ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Active / latest turn */}
          {(question || hasAnswer || errorText || busy) && (
            <div className="overlay__turn overlay__turn--current">
              {question && (
                <div className="overlay__turn-user">
                  <div className="overlay__user-bubble">{question}</div>
                </div>
              )}

              <div className="overlay__turn-assistant">
                <div className={`overlay__answer${assistNote && !hasAnswer ? ' overlay__answer--error' : ''}`}>
                  {showRsvp && hasAnswer ? (
                    <RsvpReader text={answer} onClose={() => setShowRsvp(false)} />
                  ) : hasAnswer ? (
                    <div className="overlay__answer-text" ref={answerTextRef}>
                      <RenderAnswerWithCitations text={answer} />
                    </div>
                  ) : errorText ? (
                    <div className="row" style={{ alignItems: 'flex-start', gap: 6 }}>
                      <TriangleAlert className="icon icon--xs" style={{ marginTop: 3, flexShrink: 0 }} aria-hidden="true" />
                      <span>{errorText}</span>
                    </div>
                  ) : busy ? (
                    <div className="overlay__optimistic-skeleton" aria-label="Generating response…">
                      <div className="overlay__skeleton-bar overlay__skeleton-bar--title" />
                      <div className="overlay__skeleton-bar overlay__skeleton-bar--body" />
                      <div className="overlay__skeleton-bar overlay__skeleton-bar--short" />
                    </div>
                  ) : null}
                </div>

                <footer className="overlay__footer">
                  {timing && (
                    <div className="overlay__timing-cluster">
                      {timing.cached ? (
                        <span className="overlay__timing-badge overlay__timing-badge--cached">instant replay</span>
                      ) : (
                        <>
                          {timing.e2eMs !== undefined && (
                            <span
                              className={`overlay__timing-badge ${timing.budgetMet ? 'overlay__timing-badge--budget-ok' : 'overlay__timing-badge--budget-warn'}`}
                              title={`Speech end → first token on screen: ${(timing.e2eMs / 1000).toFixed(2)}s (Budget: <2.0s)`}
                            >
                              ⚡ {(timing.e2eMs / 1000).toFixed(2)}s E2E
                            </span>
                          )}
                          <span className="overlay__timing-badge" title="Model time to first token">
                            {(timing.ms / 1000).toFixed(2)}s TTFT
                          </span>
                        </>
                      )}
                      {timing.fallback && (
                        <span
                          className="overlay__timing-badge overlay__timing-badge--fallback"
                          title={`Fell back from ${timing.fallback.from} to ${timing.fallback.to} (${timing.fallback.reason})`}
                        >
                          ⚡ {timing.fallback.to}
                        </span>
                      )}
                      {timing.model && <span className="overlay__model-tag">{timing.model}</span>}
                      {timing.cached ? (
                        <span>same question, same screen</span>
                      ) : timing.totalMs > 0 ? (
                        <span>complete in {(timing.totalMs / 1000).toFixed(1)}s</span>
                      ) : null}
                    </div>
                  )}
                  {busy && hasAnswer && (
                    <span className="overlay__streaming-indicator">
                      <Zap className="icon icon--xs" />
                      <span>Streaming live{streamingE2e ? ` (${(streamingE2e / 1000).toFixed(2)}s)` : ''}…</span>
                    </span>
                  )}
                  {!timing && !busy && !hasAnswer && !errorText && (
                    <span>Answers stay on this machine unless you use a hosted provider.</span>
                  )}
                  <div className="overlay__actions">
                    {hasAnswer && (
                      <>
                        <button className="btn btn--quiet btn--xs" onClick={() => void copyAnswer()} title="Copy the answer">
                          {copied ? <Check className="icon icon--xs" aria-hidden="true" /> : <Copy className="icon icon--xs" aria-hidden="true" />}
                          <span>{copied ? 'Copied' : 'Copy'}</span>
                        </button>
                        <button
                          className={`btn btn--quiet btn--xs ${humanizing ? 'btn--accent' : ''}`}
                          onClick={async () => {
                            if (humanizing || !answer) return
                            try {
                              setHumanizing(true)
                              await window.klyro.humanizeType?.(answer)
                            } catch {
                              setAssistNote('Humanizer keystroke simulation failed')
                            } finally {
                              setHumanizing(false)
                            }
                          }}
                          disabled={humanizing}
                          title="Humanizer Stealth Keystroke Injector (Simulates human typing with biological cadence, bypassing anti-paste interview portals)"
                        >
                          <Keyboard className="icon icon--xs" aria-hidden="true" />
                          <span>{humanizing ? 'Typing…' : 'Humanize Type'}</span>
                        </button>
                        <button
                          className="btn btn--quiet btn--xs"
                          onClick={() => void retry()}
                          disabled={busy || !lastQuestionRef.current}
                          title="Ask the same question again"
                        >
                          <RefreshCcw className="icon icon--xs" aria-hidden="true" />
                          <span>Retry</span>
                        </button>
                      </>
                    )}
                  </div>
                </footer>
              </div>
            </div>
          )}
        </section>
      )}
      <div
        className="overlay__resize-edge-e"
        onPointerDown={startResize('x')}
        aria-hidden="true"
        title="Drag edge to resize width"
      />
      <div
        className="overlay__resize-edge-s"
        onPointerDown={startResize('y')}
        aria-hidden="true"
        title="Drag edge to resize height"
      />
      <div
        className="overlay__resize-corner"
        onPointerDown={startResize('both')}
        aria-hidden="true"
        title="Drag corner to resize"
      />
          </>
        )}
      </div>
    </div>
  )
}
