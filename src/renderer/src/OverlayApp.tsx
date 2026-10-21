import { useCallback, useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Headphones, Loader2, Mic, Monitor, Square, X } from 'lucide-react'
import {
  createSilenceWatcher,
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
import { ModelPicker } from './components/ModelPicker'
import KlyroMark from './assets/logo/klyro-mark.svg'

type AssistMode = 'idle' | 'recording' | 'listening'

const CHUNK_MS = 20000

export default function OverlayApp() {
  const [text, setText] = useState('')
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [privateMode, setPrivateMode] = useState<{ supported: boolean; enabled: boolean } | null>(null)
  const [mode, setMode] = useState<AssistMode>('idle')
  const [transcript, setTranscript] = useState<string[]>([])
  const [autoAnswer, setAutoAnswer] = useState(true)
  const [assistNote, setAssistNote] = useState<string | null>(null)
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
  // True while a capture is in flight — the shot takes a moment, so say so.
  const [capturing, setCapturing] = useState(false)
  // How long the last answer took, and whether it was replayed instantly.
  const [timing, setTiming] = useState<{ ms: number; totalMs: number; model?: string; cached?: boolean } | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const mimeRef = useRef('audio/webm')
  const gateRef = useRef<SilenceWatcher | null>(null)
  const modeRef = useRef<AssistMode>('idle')
  const busyRef = useRef(false)
  const autoRef = useRef(true)
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const isWindows = /Win/i.test(navigator.platform)
  const isLinux = /Linux/i.test(navigator.platform) && !isWindows

  useEffect(() => {
    void window.klyro.privateModeStatus().then(setPrivateMode).catch(() => setPrivateMode(null))
    void window.klyro
      .getSettings()
      .then((settings) => {
        const provider = settings.providers[settings.activeProvider]
        setOverlayProvider(settings.activeProvider)
        // An empty fast model means "the same model as the chat", so that is
        // what the picker shows.
        setOverlayModel(provider?.fastModel || provider?.model || '')
      })
      .catch(() => undefined)
    return window.klyro.onChatStream((event) => {
      if (event.type === 'start') {
        setAnswer('')
        talkRef.current.answering = true
        setTalkState((current) => (current === 'listening' ? current : 'thinking'))
      } else if (event.type === 'delta') {
        setAnswer((prev) => prev + event.text)
      } else if (event.type === 'done' || event.type === 'error') {
        setBusy(false)
        talkRef.current.answering = false
        if (talkRef.current.timer !== null) setTalkState('listening')
        if (event.type === 'done') {
          setTiming({ ms: event.ms ?? 0, totalMs: event.totalMs ?? 0, model: event.model, cached: event.cached })
        }
        if (event.type === 'error') setAssistNote(event.message)
        // Once the answer landed and nothing is still recording, the overlay
        // can go back to hiding on blur.
        if (modeRef.current === 'idle') void window.klyro.setRecordingSticky(false)
      }
    })
  }, [])

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
      await window.klyro.sendChat({ conversationId: id, content, attachments: captureAttachments(), useFastModel: true })
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
      await window.klyro.sendChat({ conversationId: id, content: spoken, attachments, useFastModel: true })
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
        if (!talk.speaking && talk.answering === false) setTalkState((current) => (current === 'hearing' ? current : current))
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
      await openStream()
      modeRef.current = 'listening'
      setMode('listening')
      setTranscript([])
      setAnswer('')
      const recorder = recorderRef.current
      if (!recorder) return
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) void queueChunk(new Blob([event.data], { type: mimeRef.current }))
      }
      recorder.start(CHUNK_MS)
    } catch (error) {
      setAssistNote((error as Error).message)
      teardownRecording()
    }
  }

  async function stopListening(): Promise<void> {
    modeRef.current = 'idle'
    setMode('idle')
    await stopRecorder()
    gateRef.current?.dispose()
    gateRef.current = null
    chainRef.current = Promise.resolve()
    void window.klyro.setRecordingSticky(false)
  }

  function queueChunk(chunk: Blob): Promise<void> {
    const run = async (): Promise<void> => {
      try {
        // The silence gate: a chunk with no voiced sample in its window costs
        // nothing at all (the ~100 ms level poller decides, not the provider).
        if (gateRef.current?.isSilentChunk(CHUNK_MS)) return
        const text = await transcribeBlob(chunk)
        if (!text) return
        const next = [...transcript.slice(-7), text]
        setTranscript(next)
        if (autoRef.current && !busyRef.current && looksLikeQuestion(text)) {
          await askAssist(listenPrompt(next))
        }
      } catch (error) {
        setAssistNote((error as Error).message)
      }
    }
    chainRef.current = chainRef.current.then(run, run)
    return chainRef.current
  }

  const assistBusy = mode !== 'idle'

  return (
    <div className={`overlay${privateMode?.enabled ? ' overlay--private' : ''}`}>
      <div className="overlay__bar">
        <img src={KlyroMark} alt="" className="overlay__mark" aria-hidden="true" />
        <span className="overlay__brand">Klyro</span>
        {overlayProvider && (
          <ModelPicker
            providerId={overlayProvider}
            value={overlayModel}
            variant="chip"
            onChange={(next) => {
              setOverlayModel(next)
              void (async () => {
                try {
                  const settings = await window.klyro.getSettings()
                  await window.klyro.updateSettings({
                    providers: {
                      ...settings.providers,
                      [overlayProvider]: { ...settings.providers[overlayProvider], fastModel: next }
                    }
                  })
                } catch {
                  // The choice still shows; the next answer uses the old model.
                }
              })()
            }}
          />
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
        <input
          ref={inputRef}
          autoFocus
          value={text}
          placeholder={assistBusy ? 'Assist runs in this box…' : 'Ask anything…'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void (async () => {
                const content = text.trim()
                if (!content || busy) return
                let id = conversationId
                if (!id) {
                  const conversation = await window.klyro.createConversation()
                  id = conversation.id
                  setConversationId(id)
                }
                setAnswer('')
                setBusy(true)
                setText('')
                await window.klyro.sendChat({ conversationId: id, content, attachments: captureAttachments(), useFastModel: true })
                setCapture(null)
              })()
            }
          }}
        />
        {busy ? (
          <button className="btn btn--stop" onClick={() => void window.klyro.abortChat()}>
            Stop
          </button>
        ) : (
          <button className="btn btn--primary" onClick={() => void (async (): Promise<void> => {
            const content = text.trim()
            if (!content || busy) return
            let id = conversationId
            if (!id) {
              const conversation = await window.klyro.createConversation()
              id = conversation.id
              setConversationId(id)
            }
            setAnswer('')
            setBusy(true)
            setText('')
            await window.klyro.sendChat({ conversationId: id, content, attachments: captureAttachments(), useFastModel: true })
            setCapture(null)
          })()}
          >
            Ask
          </button>
        )}
      </div>

      <div className="overlay__assist" role="group" aria-label="Meeting assist">
        {assistSource && <span className="overlay__source">{assistSource}</span>}
        {mode === 'idle' && (
          <>
            <button
              className={`btn btn--sm${capture ? ' btn--primary' : ''}`}
              onClick={() => void captureScreen()}
              disabled={busy || capturing}
              title="Capture what is on screen and ask about it"
              aria-label="Capture screen"
            >
              {capturing ? (
                <>
                  <Loader2 className="icon icon--sm overlay__spin" aria-hidden="true" />
                  <span>Capturing…</span>
                </>
              ) : (
                <>
                  <Monitor className="icon icon--sm" aria-hidden="true" />
                  <span>{capture ? 'Captured' : 'Capture screen'}</span>
                </>
              )}
            </button>
            <button
              className={`btn btn--sm${talkState !== 'idle' ? ' btn--primary' : ''}`}
              onClick={() => {
                if (talkState === 'idle') void startTalking()
                else stopTalking()
              }}
              disabled={busy}
              title="Talk to Klyro — it answers when you stop speaking"
              aria-label="Talk to Klyro"
            >
              <Mic className="icon icon--sm" aria-hidden="true" />
              <span>{talkState === 'idle' ? 'Talk' : 'Stop talking'}</span>
            </button>
            <button className="btn btn--sm" onClick={() => void startSnippet()} disabled={busy || talkState !== 'idle'}>
              <Mic className="icon icon--sm" aria-hidden="true" />
              <span>Record question</span>
            </button>
            <button className="btn btn--sm" onClick={() => void startListening()} disabled={busy || talkState !== 'idle'}>
              <Headphones className="icon icon--sm" aria-hidden="true" />
              <span>Listen to meeting</span>
            </button>
          </>
        )}

        {mode === 'recording' && (
          <button className="btn btn--danger" onClick={() => void endSnippet()}>
            <Square className="icon icon--sm" aria-hidden="true" />
            <span className="overlay__recdot" aria-hidden="true" />
            <span>Stop &amp; answer</span>
          </button>
        )}

        {mode === 'listening' && (
          <button className="btn btn--danger" onClick={() => void stopListening()}>
            <Square className="icon icon--sm" aria-hidden="true" />
            <span>Stop listening</span>
          </button>
        )}

        {mode === 'listening' && (
          <label className="overlay__auto">
            <input
              type="checkbox"
              checked={autoAnswer}
              onChange={(event) => {
                autoRef.current = event.target.checked
                setAutoAnswer(event.target.checked)
              }}
            />
            <span>Auto-answer questions</span>
          </label>
        )}

        {(mode !== 'idle' || busy) && <Loader2 className="icon icon--sm overlay__spin" aria-hidden="true" />}
      </div>

      {talkState !== 'idle' && (
        <div className="overlay__talk" aria-live="polite">
          <span className={`overlay__talk-dot overlay__talk-dot--${talkState}`} aria-hidden="true" />
          <span className="overlay__talk-label">
            {talkState === 'listening' ? 'Listening — speak whenever you like' : talkState === 'hearing' ? 'Hearing you…' : 'Thinking…'}
          </span>
          <span className="overlay__meter" aria-hidden="true">
            <span className="overlay__meter-fill" style={{ width: `${Math.round(Math.min(1, level) * 100)}%` }} />
          </span>
        </div>
      )}

      {transcript.length > 0 && (
        <div className="overlay__transcript" aria-live="polite">
          {transcript.slice(-4).map((line, index) => (
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
            <X className="icon icon--xs" aria-hidden="true" />
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
            <X className="icon icon--xs" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="overlay__answer">
        {answer && !isNoAnswer(answer) ? (
          <>
            {answer}
            {timing && (
              <div className="overlay__timing">
                {timing.cached ? (
                  <span className="overlay__timing-badge">instant replay</span>
                ) : (
                  <span className="overlay__timing-badge">{(timing.ms / 1000).toFixed(2)}s</span>
                )}
                {timing.model && <span>{timing.model}</span>}
                {timing.cached ? (
                  <span>same question, same screen</span>
                ) : timing.totalMs > 0 ? (
                  <span>complete in {(timing.totalMs / 1000).toFixed(1)}s</span>
                ) : null}
              </div>
            )}
          </>
        ) : assistNote ? (
          <span className="overlay__note">{assistNote}</span>
        ) : busy ? (
          <span className="muted">…</span>
        ) : (
          <span className="muted">Esc to close · Enter to ask</span>
        )}
      </div>
    </div>
  )
}
