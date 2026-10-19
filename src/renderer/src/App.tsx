import { Suspense, lazy, useState, useCallback, useEffect, useRef } from 'react'
import { ChatView } from './components/ChatView'
import { Sidebar } from './components/Sidebar'
import { useChat } from './hooks/useChat'
import { useAgent } from './hooks/useAgent'
import { HomeView } from './components/HomeView'
import { Menu } from 'lucide-react'

type WorkspaceView = 'home' | 'chat' | 'screen' | 'agent' | 'workflows' | 'memory' | 'integrations'

// Sidebar views that correspond to an overlay/side panel rather than a full workspace
const PANEL_VIEWS: Partial<Record<WorkspaceView, string>> = {
  agent: 'agent',
  memory: 'knowledge',
}

// Lazy panels are created once at module scope: a `lazy()` formed inside the
// component body produces a fresh component identity every render, which
// unmounts and remounts the whole panel — visibly resetting focus (the agent
// goal textarea lost its caret after every keystroke) and re-running effects.
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then((module) => ({ default: module.SettingsPanel })))
const AgentPanel = lazy(() => import('./components/AgentPanel').then((module) => ({ default: module.AgentPanel })))
const KnowledgePanel = lazy(() => import('./components/KnowledgePanel').then((module) => ({ default: module.KnowledgePanel })))
const StudioPanel = lazy(() => import('./components/StudioPanel').then((module) => ({ default: module.StudioPanel })))
const WorkflowsView = lazy(() => import('./components/WorkflowsView').then((module) => ({ default: module.WorkflowsView })))
const IntegrationsView = lazy(() => import('./components/IntegrationsView').then((module) => ({ default: module.IntegrationsView })))

export default function App() {
  const chat = useChat()
  const agent = useAgent()
  const [activeView, setActiveView] = useState<WorkspaceView>('home')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Set when the user asks for a screen capture: chat opens with the source
  // picker ready, so "ask about my screen" is a two-click path.
  const [captureArmed, setCaptureArmed] = useState(false)

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

  // Below 1080px the sidebar is a drawer: it is always shown expanded, and
  // the rail (collapsed) mode is a desktop-only affordance.
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)')
    const update = (): void => setNarrow(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  // Keep track of open panels
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({
    settings: false,
    agent: false,
    knowledge: false,
    studio: false,
  })

  // Dialog a11y: remember what opened a panel and return focus there when the
  // last panel closes (close button, Escape, or opening a different panel).
  const panelInvokerRef = useRef<HTMLElement | null>(null)
  const wasAnyPanelOpen = useRef(false)
  useEffect(() => {
    const anyOpen = Object.values(openPanels).some(Boolean)
    if (wasAnyPanelOpen.current && !anyOpen) {
      const invoker = panelInvokerRef.current
      if (invoker && invoker.isConnected) invoker.focus()
      panelInvokerRef.current = null
    }
    wasAnyPanelOpen.current = anyOpen
  }, [openPanels])

  // Full-workspace views swap `activeView`; agent/memory/settings/studio open as panels
  const closeAllPanels = useCallback(() => {
    setOpenPanels({ settings: false, agent: false, knowledge: false, studio: false })
  }, [])

  const togglePanel = useCallback((panel: string) => {
    setOpenPanels(prev => ({ ...prev, [panel]: !prev[panel] }))
  }, [])

  // Open exactly one panel: close any open panel first, then open the requested one.
  const openPanel = useCallback((panel: string) => {
    const invoker = document.activeElement
    if (invoker instanceof HTMLElement && invoker !== document.body) panelInvokerRef.current = invoker
    closeAllPanels()
    setOpenPanels(prev => ({ ...prev, [panel]: true }))
  }, [closeAllPanels])

  const handleSidebarAction = useCallback((view: WorkspaceView, panel?: string) => {
    setSidebarOpen(false)
    const panelKey = panel ?? PANEL_VIEWS[view]
    if (panelKey) {
      openPanel(panelKey)
      return
    }
    closeAllPanels()
    // "Screen" is not a separate page any more: it is chat with the screen
    // picker already open, so the capture and the answer live in one place.
    if (view === 'screen') {
      setActiveView('chat')
      setCaptureArmed(true)
      return
    }
    setActiveView(view)
  }, [openPanel, closeAllPanels])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        handleSidebarAction('chat')
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        chat.newConversation()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        openPanel('settings')
      }
      if (e.key === 'Escape') {
        if (sidebarOpen) setSidebarOpen(false)
        closeAllPanels()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sidebarOpen, chat, handleSidebarAction, openPanel, closeAllPanels])

  const renderWorkspace = () => {
    switch (activeView) {
      case 'home':
        return <HomeView onNewChat={chat.newConversation} onOpenView={handleSidebarAction} />
      case 'chat':
      case 'screen':
        return (
          <ChatView
            messages={chat.messages}
            streamingId={chat.streamingId}
            contexts={chat.contexts}
            hasMore={chat.hasMore}
            onLoadEarlier={chat.loadEarlier}
            onSend={chat.send}
            onStop={chat.stop}
            onNewChat={() => void chat.newConversation()}
            pendingTool={chat.pendingTool}
            onRespondTool={(approved) => void chat.respondTool(approved)}
            captureArmed={captureArmed}
            onCaptureHandled={() => setCaptureArmed(false)}
            onCaptureRequested={() => setCaptureArmed(true)}
          />
        )
      // 'agent' and 'memory' render as side panels/overlays above the active workspace
      case 'workflows':
        return (
          <Suspense fallback={null}>
            <WorkflowsView />
          </Suspense>
        )
      case 'integrations':
        return (
          <Suspense fallback={null}>
            <IntegrationsView />
          </Suspense>
        )
      default:
        return <HomeView onNewChat={chat.newConversation} onOpenView={handleSidebarAction} />
    }
  }

  return (
    <div className={`app${openPanels.agent ? ' app--agent' : ''}${sidebarOpen ? ' app--nav-open' : ''}`}>
      {/* Mobile sidebar toggle */}
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open navigation"
        aria-expanded={sidebarOpen}
      >
        <Menu className="icon icon--md" aria-hidden="true" />
      </button>

      {/* Sidebar overlay for mobile */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' sidebar-overlay--open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      <Sidebar
        summaries={chat.summaries}
        activeId={chat.activeId}
        search={chat.search}
        setSearch={chat.setSearch}
        openConversation={async (id: string) => {
          // Opening a chat from the sidebar should take you to it — loading a
          // conversation without changing the view looks like nothing happened.
          await chat.openConversation(id)
          setActiveView('chat')
        }}
        newConversation={chat.newConversation}
        deleteConversation={chat.deleteConversation}
        onOpenHome={() => handleSidebarAction('home')}
        onOpenChat={() => handleSidebarAction('chat')}
        onOpenScreen={() => handleSidebarAction('screen')}
        onOpenAgent={() => handleSidebarAction('agent')}
        onOpenWorkflows={() => handleSidebarAction('workflows')}
        onOpenMemory={() => handleSidebarAction('memory')}
        onOpenIntegrations={() => handleSidebarAction('integrations')}
        onOpenSettings={() => openPanel('settings')}
        activeView={activeView}
        collapsed={sidebarCollapsed && !narrow}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <main className="main" role="main">
        <div key={activeView} className="workspace view-in">
          {renderWorkspace()}
        </div>
      </main>

      <Suspense fallback={null}>
        {openPanels.settings && <SettingsPanel onClose={() => togglePanel('settings')} />}
        {openPanels.agent && <AgentPanel agent={agent} onClose={() => togglePanel('agent')} />}
        {openPanels.knowledge && <KnowledgePanel onClose={() => togglePanel('knowledge')} />}
        {openPanels.studio && <StudioPanel onClose={() => togglePanel('studio')} />}
      </Suspense>
    </div>
  )
}