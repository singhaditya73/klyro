import { Suspense, lazy, useState, useCallback, useEffect } from 'react'
import { ChatView } from './components/ChatView'
import { Sidebar } from './components/Sidebar'
import { useChat } from './hooks/useChat'
import { useAgent } from './hooks/useAgent'
import { HomeView } from './components/HomeView'
import { ScreenAssistantView } from './components/ScreenAssistantView'
import { AgentPanel } from './components/AgentPanel'
import { KnowledgePanel } from './components/KnowledgePanel'
import { SettingsPanel } from './components/SettingsPanel'
import { StudioPanel } from './components/StudioPanel'
import { WorkflowsView } from './components/WorkflowsView'
import { IntegrationsView } from './components/IntegrationsView'

type WorkspaceView = 'home' | 'chat' | 'screen' | 'agent' | 'workflows' | 'memory' | 'integrations'

export default function App() {
  const chat = useChat()
  const agent = useAgent()
  const [activeView, setActiveView] = useState<WorkspaceView>('home')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Panels loaded on demand
  const SettingsPanelLazy = lazy(() => import('./components/SettingsPanel').then((module) => ({ default: module.SettingsPanel })))
  const AgentPanelLazy = lazy(() => import('./components/AgentPanel').then((module) => ({ default: module.AgentPanel })))
  const KnowledgePanelLazy = lazy(() => import('./components/KnowledgePanel').then((module) => ({ default: module.KnowledgePanel })))
  const StudioPanelLazy = lazy(() => import('./components/StudioPanel').then((module) => ({ default: module.StudioPanel })))

  // Keep track of open panels
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({
    settings: false,
    agent: false,
    knowledge: false,
    studio: false,
  })

  const closeAllPanels = useCallback(() => {
    setOpenPanels({ settings: false, agent: false, knowledge: false, studio: false })
  }, [])

  const togglePanel = useCallback((panel: string) => {
    setOpenPanels(prev => ({ ...prev, [panel]: !prev[panel] }))
  }, [])

  const handleSidebarAction = useCallback((view: WorkspaceView, panel?: string) => {
    setActiveView(view)
    if (panel) togglePanel(panel)
    closeAllPanels()
    setSidebarOpen(false)
  }, [togglePanel, closeAllPanels])

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
        togglePanel('settings')
      }
      if (e.key === 'Escape') {
        if (sidebarOpen) setSidebarOpen(false)
        closeAllPanels()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [sidebarOpen, chat, handleSidebarAction, togglePanel, closeAllPanels])

  const renderWorkspace = () => {
    switch (activeView) {
      case 'home':
        return <HomeView onNewChat={chat.newConversation} onOpenView={handleSidebarAction} />
      case 'chat':
        return (
          <ChatView
            messages={chat.messages}
            streamingId={chat.streamingId}
            contexts={chat.contexts}
            hasMore={chat.hasMore}
            onLoadEarlier={chat.loadEarlier}
            onSend={chat.send}
            onStop={chat.stop}
          />
        )
      case 'screen':
        return <ScreenAssistantView />
      case 'agent':
        return <AgentPanel agent={agent} onClose={() => togglePanel('agent')} />
      case 'workflows':
        return <WorkflowsView />
      case 'memory':
        return <KnowledgePanel onClose={() => togglePanel('knowledge')} />
      case 'integrations':
        return <IntegrationsView />
      default:
        return <HomeView onNewChat={chat.newConversation} onOpenView={handleSidebarAction} />
    }
  }

  return (
    <div className={`app${openPanels.agent ? ' app--agent' : ''}`}>
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
        openConversation={chat.openConversation}
        newConversation={chat.newConversation}
        deleteConversation={chat.deleteConversation}
        onOpenHome={() => handleSidebarAction('home')}
        onOpenChat={() => handleSidebarAction('chat')}
        onOpenScreen={() => handleSidebarAction('screen')}
        onOpenAgent={() => handleSidebarAction('agent', 'agent')}
        onOpenWorkflows={() => handleSidebarAction('workflows')}
        onOpenMemory={() => handleSidebarAction('memory', 'knowledge')}
        onOpenIntegrations={() => handleSidebarAction('integrations')}
        onOpenSettings={() => togglePanel('settings')}
        activeView={activeView}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <main className="main" role="main">
        <div className="workspace" style={{ transition: 'opacity 140ms ease' }}>
          {renderWorkspace()}
        </div>
      </main>

      <Suspense fallback={null}>
        {openPanels.settings && <SettingsPanelLazy onClose={() => togglePanel('settings')} />}
        {openPanels.agent && <AgentPanelLazy agent={agent} onClose={() => togglePanel('agent')} />}
        {openPanels.knowledge && <KnowledgePanelLazy onClose={() => togglePanel('knowledge')} />}
        {openPanels.studio && <StudioPanelLazy onClose={() => togglePanel('studio')} />}
      </Suspense>
    </div>
  )
}