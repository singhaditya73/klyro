import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Monitor, Sparkles, X, Zap } from 'lucide-react'
import KlyroMark from '../assets/logo/klyro-mark.svg'

/**
 * The first twenty seconds.
 *
 * A first-time user does not read feature lists — they need to *see* the
 * product work. This tour does the smallest possible version of that: it
 * captures the screen, asks a question about it, and shows the answer with
 * the real latency, in the user's own hands, in under half a minute.
 */

type Step = 'welcome' | 'try' | 'done'

interface Props {
  /** Opens Settings so the user can add a key or start Ollama. */
  onOpenSettings: () => void
  onOpenIntegrations: () => void
}

const SUGGESTIONS = [
  'What am I looking at right now?',
  'Summarise what is on this screen in one line',
  'What should I do next on this screen?'
]

export function Onboarding({ onOpenSettings, onOpenIntegrations }: Props) {
  const [step, setStep] = useState<Step>('welcome')
  const [ready, setReady] = useState<boolean | null>(null)
  const [needsKey, setNeedsKey] = useState(false)
  const [question, setQuestion] = useState(SUGGESTIONS[0])
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timing, setTiming] = useState<{ ms: number; model?: string } | null>(null)
  const [hotkey, setHotkey] = useState('Ctrl+Shift+Space')
  const conversationRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [settings, providers] = await Promise.all([
          window.klyro.getSettings(),
          window.klyro.listProviders()
        ])
        if (cancelled) return
        if (settings?.toggleShortcut) setHotkey(humanShortcut(settings.toggleShortcut))
        if (settings?.onboardingComplete) {
          setReady(true)
          return
        }
        const active = providers.find((provider) => provider.id === settings?.activeProvider)
        // Ollama needs no key; anything else does.
        setNeedsKey(Boolean(active?.requiresKey) && !active?.hasKey)
        setReady(false)
      } catch {
        if (!cancelled) setReady(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // The user may add a key in Settings and come straight back: re-check.
  useEffect(() => {
    const recheck = (): void => {
      void (async () => {
        try {
          const [settings, providers] = await Promise.all([
            window.klyro.getSettings(),
            window.klyro.listProviders()
          ])
          if (settings?.onboardingComplete) {
            setReady(true)
            return
          }
          const active = providers.find((provider) => provider.id === settings?.activeProvider)
          setNeedsKey(Boolean(active?.requiresKey) && !active?.hasKey)
        } catch {
          // Keep the current state.
        }
      })()
    }
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [])

  // Stream the answer into the tour, exactly like the real chat does.
  useEffect(() => {
    return window.klyro.onChatStream((event) => {
      if (event.type === 'delta') setAnswer((previous) => previous + event.text)
      if (event.type === 'done') {
        setBusy(false)
        setTiming({ ms: event.ms ?? 0, model: event.model })
      }
      if (event.type === 'error') {
        setBusy(false)
        setError(event.message)
      }
    })
  }, [])

  const finish = useCallback(async (): Promise<void> => {
    await window.klyro.updateSettings({ onboardingComplete: true }).catch(() => undefined)
    setReady(true)
  }, [])

  /** The twenty-second proof: capture what is on screen, ask about it, show it. */
  const tryIt = useCallback(async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    setAnswer('')
    setTiming(null)
    try {
      let conversationId = conversationRef.current
      if (!conversationId) {
        const conversation = await window.klyro.createConversation()
        conversationId = conversation.id
        conversationRef.current = conversationId
      }
      const shot = await window.klyro.grabScreen()
      await window.klyro.sendChat({
        conversationId,
        content: question,
        attachments: [{ kind: 'image', mime: 'image/png', dataUrl: shot.dataUrl, label: shot.name }],
        useFastModel: true
      })
    } catch (caught) {
      setBusy(false)
      setError((caught as Error).message)
    }
  }, [busy, question])

  if (ready !== false) return null

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Welcome to Klyro">
      <div className="modal__panel modal__panel--wide onboarding">
        {step === 'welcome' && (
          <>
            <div className="modal__head">
              <div className="onboarding__brand">
                <img src={KlyroMark} alt="" className="onboarding__mark" aria-hidden="true" />
                <span>Welcome to Klyro</span>
              </div>
              <button className="btn btn--icon btn--icon-sm btn--ghost" onClick={() => void finish()} aria-label="Skip the tour" title="Skip the tour">
                <X className="icon icon--sm" aria-hidden="true" />
              </button>
            </div>
            <div className="modal__body onboarding__body">
              <h2 className="onboarding__title">Your AI, over everything you do.</h2>
              <p className="onboarding__lede">
                Klyro answers questions about what is on your screen — without you switching apps, and without
                sending a screenshot anywhere unless you ask it to.
              </p>
              <div className="onboarding__points">
                <div className="onboarding__point">
                  <span className="onboarding__point-icon"><Zap className="icon icon--sm" aria-hidden="true" /></span>
                  <div>
                    <strong>One keypress, anywhere</strong>
                    <span>Press <kbd>{hotkey}</kbd> and Klyro floats over your work.</span>
                  </div>
                </div>
                <div className="onboarding__point">
                  <span className="onboarding__point-icon"><Monitor className="icon icon--sm" aria-hidden="true" /></span>
                  <div>
                    <strong>It sees what you see</strong>
                    <span>Capture the screen, ask a question, get an answer in under a second.</span>
                  </div>
                </div>
                <div className="onboarding__point">
                  <span className="onboarding__point-icon"><Sparkles className="icon icon--sm" aria-hidden="true" /></span>
                  <div>
                    <strong>It works for you</strong>
                    <span>Your own model key, or a fully local model. Nothing is stored off this machine.</span>
                  </div>
                </div>
              </div>
              {needsKey && (
                <div className="notice notice--warning onboarding__notice">
                  <div className="notice__body">
                    <strong>One thing first: a model.</strong>
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      Add a provider key (Groq has a free tier that is fast enough for the overlay), or use
                      something already running on this machine — OpenCode, Ollama or LM Studio — with no key at
                      all.
                    </div>
                    <div className="notice__actions">
                      <button className="btn btn--sm" onClick={onOpenSettings}>
                        <span>Add a key</span>
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={onOpenIntegrations}>
                        <span>See providers</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="modal__foot">
              <button className="btn btn--ghost" onClick={() => void finish()}>
                <span>Skip</span>
              </button>
              {needsKey ? (
                <>
                  <button className="btn btn--ghost" onClick={() => setStep('try')}>
                    <span>Try anyway</span>
                  </button>
                  <button className="btn btn--primary" onClick={onOpenSettings}>
                    <span>Add a key</span>
                  </button>
                </>
              ) : (
                <button className="btn btn--primary" onClick={() => setStep('try')}>
                  <span>Show me</span>
                </button>
              )}
            </div>
          </>
        )}

        {step === 'try' && (
          <>
            <div className="modal__head">
              <div className="onboarding__brand">
                <img src={KlyroMark} alt="" className="onboarding__mark" aria-hidden="true" />
                <span>Try it now</span>
              </div>
            </div>
            <div className="modal__body onboarding__body">
              <p className="onboarding__lede">
                Klyro will capture the screen, hide itself for the moment of the shot, and send the picture with
                your question to your model. The capture is never stored.
              </p>
              <label className="field" style={{ marginTop: 18 }}>
                <span className="field__label">Ask about this screen</span>
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  className="field"
                  placeholder="What am I looking at right now?"
                />
              </label>
              <div className="onboarding__suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} className="btn btn--ghost btn--sm" onClick={() => setQuestion(suggestion)}>
                    <span>{suggestion}</span>
                  </button>
                ))}
              </div>
              {!answer && !busy && !error && (
                <button className="btn btn--primary onboarding__cta" onClick={() => void tryIt()}>
                  <Monitor className="icon icon--sm" aria-hidden="true" />
                  <span>Capture my screen and ask</span>
                </button>
              )}
              {busy && (
                <div className="onboarding__thinking">
                  <Loader2 className="icon icon--sm spin" aria-hidden="true" />
                  <span>Capturing and asking…</span>
                </div>
              )}
              {error && (
                <div className="notice notice--error" style={{ marginTop: 14 }}>
                  <div className="notice__body">
                    <strong>That did not work</strong>
                    <div style={{ fontSize: 12, marginTop: 2 }}>{error}</div>
                    <div className="notice__actions">
                      <button className="btn btn--sm" onClick={() => void tryIt()}>
                        <span>Try again</span>
                      </button>
                      <button className="btn btn--ghost btn--sm" onClick={onOpenSettings}>
                        <span>Open Settings</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {answer && (
                <div className="onboarding__answer">
                  <div className="onboarding__answer-label">
                    <Check className="icon icon--xs" aria-hidden="true" />
                    <span>Klyro answered</span>
                    {timing && <span className="onboarding__answer-time">{(timing.ms / 1000).toFixed(2)}s</span>}
                  </div>
                  <p>{answer}</p>
                </div>
              )}
            </div>
            <div className="modal__foot">
              <button className="btn btn--ghost" onClick={() => setStep('welcome')}>
                <span>Back</span>
              </button>
              <button className="btn btn--primary" onClick={() => void finish()} disabled={!answer && !error}>
                <span>Start using Klyro</span>
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div className="modal__body onboarding__body onboarding__done">
            <div className="onboarding__done-mark">
              <Check className="icon icon--lg" aria-hidden="true" />
            </div>
            <h2 className="onboarding__title">You are set.</h2>
            <p className="onboarding__lede">
              Press <kbd>{hotkey}</kbd> anywhere to bring Klyro up. Everything else is in Settings.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}



/**
 * Turn an Electron accelerator into something a person would say out loud:
 * "CommandOrControl+Shift+Space" becomes "Ctrl+Shift+Space" (or "Cmd+Shift+Space"
 * on a Mac).
 */
function humanShortcut(accelerator: string): string {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
  return accelerator
    .split('+')
    .map((part) => {
      const key = part.trim()
      if (key === 'CommandOrControl' || key === 'CmdOrCtrl') return isMac ? 'Cmd' : 'Ctrl'
      if (key === 'Command') return 'Cmd'
      if (key === 'Control') return 'Ctrl'
      if (key === 'Shift') return 'Shift'
      if (key === 'Alt') return isMac ? 'Option' : 'Alt'
      if (key === 'Space') return 'Space'
      return key.length === 1 ? key.toUpperCase() : key
    })
    .join('+')
}
