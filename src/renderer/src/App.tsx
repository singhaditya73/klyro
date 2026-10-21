import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { IntegrationsView } from './components/IntegrationsView'
import { Clock, Keyboard, ShieldCheck } from 'lucide-react'

/**
 * The control panel.
 *
 * The overlay is the product: a hotkey opens it, you ask a question, you get
 * an answer. This window is everything around that — which models and agents
 * you can use, what is stored, what has been sent to the cloud, and the
 * settings. It is meant to be opened rarely and configured once.
 */

// Lazy panels are created once at module scope: a `lazy()` formed inside the
// component body produces a fresh component identity every render, which
// unmounts and remounts the whole panel — visibly resetting focus.
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then((module) => ({ default: module.SettingsPanel })))
const KnowledgePanel = lazy(() => import('./components/KnowledgePanel').then((module) => ({ default: module.KnowledgePanel })))
const Interviews = lazy(() => import('./components/InterviewsPanel').then((module) => ({ default: module.InterviewsPanel })))
const Onboarding = lazy(() => import('./components/Onboarding').then((module) => ({ default: module.Onboarding })))

type Panel = 'settings' | 'knowledge' | 'interviews'

export default function App() {
  const [openPanel, setOpenPanel] = useState<Panel | null>(null)
  const [shortcut, setShortcut] = useState('CommandOrControl+Shift+Space')

  // Theme: 'system' follows the OS, the others are explicit. The attribute is
  // applied to <html> so the whole design system flips in one paint.
  useEffect(() => {
    let cancelled = false
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = (theme: 'system' | 'dark' | 'light'): void => {
      if (cancelled) return
      const resolved = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme
      document.documentElement.dataset.theme = resolved
    }
    void window.klyro.getSettings().then((settings) => apply(settings?.theme ?? 'system')).catch(() => apply('system'))
    const onChange = (): void => {
      void window.klyro.getSettings().then((settings) => apply(settings?.theme ?? 'system')).catch(() => undefined)
    }
    media.addEventListener('change', onChange)
    return () => {
      cancelled = true
      media.removeEventListener('change', onChange)
    }
  }, [])

  useEffect(() => {
    void window.klyro
      .getSettings()
      .then((settings) => setShortcut(settings?.toggleShortcut || 'CommandOrControl+Shift+Space'))
      .catch(() => undefined)
  }, [])

  const open = useCallback((panel: Panel) => setOpenPanel(panel), [])
  const close = useCallback(() => setOpenPanel(null), [])

  // Escape closes the panel that is open.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpenPanel(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="app">
      <main className="main" role="main">
        <div className="workspace view-in">
          <div className="workspace-content">
          <section className="card" style={{ marginBottom: 20 }}>
            <div className="card__row" style={{ flexWrap: 'wrap', gap: 16 }}>
              <span className="icon-tile">
                <Keyboard className="icon icon--md" aria-hidden="true" />
              </span>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="card__title">Ask anything, without leaving the app</div>
                <div className="card__subtitle">
                  Press <kbd>{shortcut}</kbd> and Klyro opens the overlay. Ask about the screen or the meeting, and the
                  answer comes back in place — invisible to the people you are talking to.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn--ghost btn--sm" onClick={() => open('interviews')}>
                  <Clock className="icon icon--xs" aria-hidden="true" />
                  <span>Interviews</span>
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => open('knowledge')}>
                  <ShieldCheck className="icon icon--xs" aria-hidden="true" />
                  <span>What Klyro knows</span>
                </button>
                <button className="btn btn--primary btn--sm" onClick={() => open('settings')}>
                  <span>Settings</span>
                </button>
              </div>
            </div>
          </section>

          <IntegrationsView onOpenSettings={() => open('settings')} />
          </div>
        </div>
      </main>

      <Suspense fallback={null}>
        <Onboarding onOpenSettings={() => open('settings')} />
        {openPanel === 'settings' && <SettingsPanel onClose={close} />}
        {openPanel === 'knowledge' && <KnowledgePanel onClose={close} />}
        {openPanel === 'interviews' && <Interviews onClose={close} />}
      </Suspense>
    </div>
  )
}
