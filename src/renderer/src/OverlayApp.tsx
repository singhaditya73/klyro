import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Copy,
  Check,
  Eye,
  EyeOff,
  Headphones,
  Info,
  Loader2,
  Mic,
  Monitor,
  RefreshCcw,
  ScanEye,
  Square,
  TriangleAlert
} from 'lucide-react'
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
  type SilenceWatcher
} from './lib/listen'
import type { Attachment } from '@shared/types'
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

export default function OverlayApp() {
  const [text, setText] = useState('')
  const [answer, setAnswer] = useState('')
  /** The question as it was asked, so the answer has a subject. */
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  /** The interview this overlay is recording into, when it is recording one. */
  const [interviewId, setInterviewId] = useState<string | null>(null)
  const interviewRef = useRef<string | null>(null)
  interviewRef.current = interviewId
  const [privateMode, setPrivateMode] = useState<{ supported: boolean; enabled: boolean } | null>(null)
  const [mode, setMode] = useState<AssistMode>('idle')
  const [transcript, setTranscript] = useState<string[]>([])
  const [autoAnswer, setAutoAnswer] = useState(true)
  const [assistNote, setAssistNote] = useState<string | null>(null)
  /** A provider failure, shown as an error rather than as a hint. */
  const [errorText, setErrorText] = useState<string | null>(null)
  const [assistSource, setAssistSource] = useState<'System audio' | 'Microphone' | null>(null)
  // A screen capture waiting to be sent with the next question.
  const [capture, setCapture] = useState<{ dataUrl: string; name: string } | null>(null)
  // Conversation mode: continuous listening, speech-triggered answers.
  const [talkState, setTalkState] = useState<'idle' | 'listening' | 'hearing' | 'thinking'>('idle')
  const [level, setLevel] = useState(0)
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
  const [timing, setTiming] = useState<{ ms: number; totalMs: number; model?: string; cached?: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

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
  }, [answer, question, transcript, capture, overlaySources, mode, talkState, timing, resizeToContent])

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
      if (document.visibilityState === 'visible') void syncProvider()
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
        setAnswer('')
        talkRef.current.answering = true
        // The conversation mode has its own status line; a typed question does
        // not need one.
        if (talkRef.current.timer !== null) setTalkState('thinking')
      } else if (event.type === 'delta') {
        setAnswer((prev) => prev + event.text)
      } else if (event.type === 'done' || event.type === 'error') {
        setBusy(false)
        talkRef.current.answering = false
        if (talkRef.current.timer !== null) setTalkState('listening')
        if (event.type === 'done') {
          setTiming({ ms: event.ms ?? 0, totalMs: event.totalMs ?? 0, model: event.model, cached: event.cached })
        }
        if (event.type === 'error') setErrorText(event.message)
        // Once the answer landed and nothing is still recording, the overlay
        // can go back to hiding on blur.
        if (modeRef.current === 'idle') void window.klyro.setRecordingSticky(false)
      }
    })
    return () => {
      offChat()
      offSettings?.()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadCatalogue, resizeToContent, syncProvider])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && modeRef.current === 'idle') void window.klyro.hideOverlay()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      teardownRecording()
    }
  }, [])

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
      // Windows: capture the output bus (loopback) so the question audio is
      // heard even over headphones. The video track the OS-processed grant
      // requires is discarded immediately — only audio is kept.
      if (isWindows) {
        const loopback = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        if (loopback.getAudioTracks().length > 0) {
          loopback.getVideoTracks().forEach((track) => track.stop())
          streamRef.current = new MediaStream(loopback.getAudioTracks())
          setAssistSource('System audio')
        } else {
          loopback.getTracks().forEach((track) => track.stop())
          throw new Error('no loopback track')
        }
      } else if (isLinux) {
        // Linux: PulseAudio/PipeWire expose the default output's monitor as a
        // regular input device ("Monitor of …") — the same source Pluely
        // records from via @DEFAULT_MONITOR@. Chromium hears the playback bus,
        // which includes the headphone feed. Device labels only populate after
        // a microphone grant, so take a throwaway mic grant first.
        const grant = await navigator.mediaDevices.getUserMedia({ audio: true })
        grant.getTracks().forEach((track) => track.stop())
        const devices = await navigator.mediaDevices.enumerateDevices()
        const monitor = devices.find(
          (device) => device.kind === 'audioinput' && /monitor/i.test(device.label)
        )
        if (monitor) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: monitor.deviceId } }
          })
          streamRef.current = stream
          setAssistSource('System audio')
        } else {
          throw new Error('no monitor source')
        }
      } else {
        throw new Error('loopback unsupported here')
      }
    } catch (error) {
      // macOS: loopback is unavailable (needs a virtual device such as
      // BlackHole); Linux without a monitor source or with denied access;
      // any other failure: fall back to the microphone, which hears the room
      // but not the output bus.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      setAssistSource('Microphone')
      if (isWindows) {
        setAssistNote('System audio was unavailable; recording the microphone instead.')
      } else if (isLinux) {
        setAssistNote(
          /no monitor source/.test(String((error as Error).message))
            ? 'No "Monitor of…" audio source found — meeting audio is routed to a device Chromium cannot see. Check your sound settings (pavucontrol) and retry; using the microphone meanwhile.'
            : 'Recording the microphone instead of system output.'
        )
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
    answering: false
  })

  /** Answer a spoken question, with the screen attached when possible. */
  const askSpoken = useCallback(async (spoken: string): Promise<void> => {
    if (!spoken.trim()) return
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
    if (!utteranceWorthAsking(duration) || pieces.length === 0) {
      setTalkState('listening')
      return
    }
    const blob = new Blob(pieces, { type: talk.recorder?.mimeType || 'audio/webm' })
    try {
      const buffer = await blob.arrayBuffer()
      const result = await window.klyro.transcribe(buffer, blob.type)
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
    setTalkState('idle')
    setLevel(0)
  }, [])

  const startTalking = useCallback(async (): Promise<void> => {
    setAssistNote(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
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
        if (event.data.size > 0) talk.chunks.push(event.data)
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
            // An utterance starts: remember where the audio begins.
            talk.speaking = true
            talk.startedAt = now
            talk.mark = talk.chunks.length
            setTalkState('hearing')
          }
          talk.lastVoiceAt = now
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
    return (await window.klyro.transcribe(buffer, mimeRef.current)).text.trim()
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
      setTranscript([`Q: ${question}`])
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
  async function startListening(): Promise<void> {
    try {
      // The interview starts here: everything heard from now on is written
      // down, with the answers Klyro gives.
      const session = await window.klyro.interviewsStart({})
      setInterviewId(session.id)
      await openStream()
      modeRef.current = 'listening'
      setMode('listening')
      setTranscript([])
      setAnswer('')
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
        const utterance = assembler.takeEndedUtterance(watcher)
        if (!utterance) return
        void handleQuestion(utterance)
      }, 100)
    } catch (error) {
      setAssistNote((error as Error).message)
      teardownRecording()
    }
  }

  /**
   * A question was heard. Transcribe it, show it, and answer it.
   */
  async function handleQuestion(utterance: Blob): Promise<void> {
    try {
      const text = await transcribeBlob(utterance)
      if (!text) return
      const next = [...transcript.slice(-7), text]
      setTranscript(next)
      if (autoRef.current && !busyRef.current && looksLikeQuestion(text)) {
        setQuestion(text)
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

  return (
    <div className={`overlay${privateMode?.enabled ? ' overlay--private' : ''}`} ref={rootRef}>
      <div className="overlay__inner" ref={innerRef}>
      <header className="overlay__head">
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
      </header>

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
          </span>
        )}

        {assistSource && <span className="overlay__source">{assistSource}</span>}

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

        <span className="overlay__toolbar-hint">Esc to close · Enter to ask</span>
      </div>

      {talkState !== 'idle' && (
        <div className="overlay__talk" aria-live="polite">
          <span className={`overlay__talk-dot overlay__talk-dot--${talkState}`} aria-hidden="true" />
          <span className="overlay__talk-label">
            {talkState === 'listening'
              ? 'Listening — speak whenever you like'
              : talkState === 'hearing'
                ? 'Hearing you…'
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

      {(question || hasAnswer || errorText || busy) && (
        <section className="overlay__response" ref={responseRef} aria-live="polite">
          {question && (
            <div className="overlay__question">
              <span className="overlay__question-label">Asked</span>
              <span>{question}</span>
            </div>
          )}

          <div className={`overlay__answer${assistNote && !hasAnswer ? ' overlay__answer--error' : ''}`}>
            {hasAnswer ? (
              <div className="overlay__answer-text" ref={answerTextRef}>
                {answer}
              </div>
            ) : errorText ? (
              <div className="row" style={{ alignItems: 'flex-start', gap: 6 }}>
                <TriangleAlert className="icon icon--xs" style={{ marginTop: 3, flexShrink: 0 }} aria-hidden="true" />
                <span>{errorText}</span>
              </div>
            ) : busy ? (
              <span className="overlay__waiting">
                <span className="overlay__waiting-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>Thinking…</span>
              </span>
            ) : null}
          </div>

          <footer className="overlay__footer">
            {timing && (
              <>
                {timing.cached ? (
                  <span className="overlay__timing-badge overlay__timing-badge--cached">instant replay</span>
                ) : (
                  <span className="overlay__timing-badge">{(timing.ms / 1000).toFixed(2)}s</span>
                )}
                {timing.model && <span>{timing.model}</span>}
                {timing.cached ? (
                  <span>same question, same screen</span>
                ) : timing.totalMs > 0 ? (
                  <span>complete in {(timing.totalMs / 1000).toFixed(1)}s</span>
                ) : null}
              </>
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
        </section>
      )}
      </div>
    </div>
  )
}
