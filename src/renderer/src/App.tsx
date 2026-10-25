import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Blocks, Brain, Clock, Cpu, House, Keyboard, PanelLeft, Settings, ShieldCheck, Zap } from 'lucide-react'
import { useHashRoute, type Route } from './hooks/useHashRoute'
import KlyroMark from './assets/logo/klyro-mark.svg'

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
const HomeView = lazy(() => import('./components/HomeView').then((module) => ({ default: module.HomeView })))
const ModelsView = lazy(() => import('./components/ModelsView').then((module) => ({ default: module.ModelsView })))
const KnowledgeView = lazy(() => import('./components/KnowledgeView').then((module) => ({ default: module.KnowledgeView })))
const InterviewsView = lazy(() => import('./components/InterviewsView').then((module) => ({ default: module.InterviewsView })))
const IntegrationsView = lazy(() => import('./components/IntegrationsView').then((module) => ({ default: module.IntegrationsView })))
const SettingsView = lazy(() => import('./components/SettingsView').then((module) => ({ default: module.SettingsView })))
const PrivacyView = lazy(() => import('./components/PrivacyView').then((module) => ({ default: module.PrivacyView })))
const Onboarding = lazy(() => import('./components/Onboarding').then((module) => ({ default: module.Onboarding })))

interface NavItem {
  route: Route
  label: string
  icon: typeof House
}

const WORKSPACE: NavItem[] = [
  { route: 'home', label: 'Home', icon: House },
  { route: 'models', label: 'Models & Agents', icon: Cpu },
  { route: 'knowledge', label: 'Knowledge', icon: Brain },
  { route: 'interviews', label: 'Meetings & Interviews', icon: Clock },
  { route: 'integrations', label: 'Integrations & MCP', icon: Blocks }
]

const MANAGE: NavItem[] = [
  { route: 'settings', label: 'Settings', icon: Settings },
  { route: 'privacy', label: 'Privacy & Data', icon: ShieldCheck }
]

export default function App() {
  const [route, navigate] = useHashRoute()
  const [navOpen, setNavOpen] = useState(false)
  // A narrow window turns the sidebar into a drawer.
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 980)
  const [shortcut, setShortcut] = useState('CommandOrControl+Shift+Space')
  const [version, setVersion] = useState<string | null>(null)

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
    void window.klyro
      .getSettings()
      .then((settings) => apply(settings?.theme ?? 'system'))
      .catch(() => apply('system'))
    const onChange = (): void => {
      void window.klyro
        .getSettings()
        .then((settings) => apply(settings?.theme ?? 'system'))
        .catch(() => undefined)
    }
    media.addEventListener('change', onChange)
    // A change made in another window (or by the user in Settings) must show
    // up here without a restart.
    // A preload that is a build behind does not have this method: the app
    // still works, it just does not follow the change until it is reopened.
    const offSettings = window.klyro.onSettingsChanged?.(() => {
      void window.klyro
        .getSettings()
        .then((settings) => apply(settings?.theme ?? 'system'))
        .catch(() => undefined)
    })
    return () => {
      cancelled = true
      media.removeEventListener('change', onChange)
      offSettings?.()
    }
  }, [])

  useEffect(() => {
    void window.klyro
      .getSettings()
      .then((settings) => setShortcut(settings?.toggleShortcut || 'CommandOrControl+Shift+Space'))
      .catch(() => undefined)
    void window.klyro
      .getAppInfo()
      .then((info) => setVersion(info.version))
      .catch(() => undefined)
  }, [])

  const go = useCallback(
    (next: Route): void => {
      navigate(next)
      setNavOpen(false)
    },
    [navigate]
  )

  // The drawer follows the window: narrow means the sidebar slides away.
  useEffect(() => {
    const onResize = (): void => {
      const next = window.innerWidth <= 980
      setNarrow((current) => {
        if (current !== next) setNavOpen(false)
        return next
      })
    }
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Escape closes the navigation drawer on a narrow window.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const nav = (items: NavItem[]): React.ReactNode =>
    items.map((item) => {
      const Icon = item.icon
      const active = route === item.route
      return (
        <button
          key={item.route}
          className={`nav-item${active ? ' nav-item--active' : ''}`}
          aria-current={active ? 'page' : undefined}
          onClick={() => go(item.route)}
        >
          <Icon className="icon icon--sm" aria-hidden="true" />
          <span>{item.label}</span>
        </button>
      )
    })

  return (
    <div className={`app${narrow ? ' app--narrow' : ''}${navOpen ? ' app--nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Sections">
        <div className="sidebar__brand">
          <img src={KlyroMark} alt="" width={22} height={22} aria-hidden="true" />
          <span className="sidebar__brand-name">Klyro</span>
        </div>

        <div className="sidebar__group">
          <div className="sidebar__group-label">Workspace</div>
          {nav(WORKSPACE)}
        </div>

        <div className="sidebar__group">
          <div className="sidebar__group-label">Manage</div>
          {nav(MANAGE)}
        </div>

        <div className="sidebar__footer">
          <button className="btn btn--accent btn--sm" onClick={() => void window.klyro.toggleOverlay?.()}>
            <Zap className="icon icon--xs" aria-hidden="true" />
            <span>Quick ask</span>
          </button>
          <div className="sidebar__version row" style={{ gap: 6 }}>
            <Keyboard className="icon icon--xs" aria-hidden="true" />
            <span>{shortcut}</span>
          </div>
          {version && <div className="sidebar__version">Klyro {version}</div>}
        </div>
      </aside>

      <button
        className="btn btn--icon sidebar-toggle"
        aria-label="Open the navigation"
        aria-expanded={navOpen}
        onClick={() => setNavOpen((open) => !open)}
      >
        <PanelLeft className="icon icon--sm" aria-hidden="true" />
      </button>
      {narrow && navOpen && (
        <div className="sidebar-overlay sidebar-overlay--open" onClick={() => setNavOpen(false)} />
      )}

      <main className="main" role="main">
        <div className="workspace">
          <div className="workspace-content view-in" key={route}>
            <Suspense fallback={<div className="loading-line">Loading…</div>}>
              {route === 'home' && <HomeView onNavigate={go} />}
              {route === 'models' && <ModelsView onNavigate={go} />}
              {route === 'knowledge' && <KnowledgeView />}
              {route === 'interviews' && <InterviewsView />}
              {route === 'integrations' && <IntegrationsView />}
              {route === 'settings' && <SettingsView onNavigate={go} />}
              {route === 'privacy' && <PrivacyView />}
            </Suspense>
          </div>
        </div>
      </main>

      <Suspense fallback={null}>
        <Onboarding onOpenSettings={() => go('settings')} />
      </Suspense>
    </div>
  )
}
