import { Suspense, lazy, useState } from 'react'
import { ChatView } from './components/ChatView'
import { Sidebar } from './components/Sidebar'
import { useAgent } from './hooks/useAgent'
import { useChat } from './hooks/useChat'

// Panels are loaded on first open: their code (and the data they fetch) stays out
// of the startup path.
const AgentPanel = lazy(() => import('./components/AgentPanel').then((module) => ({ default: module.AgentPanel })))
const KnowledgePanel = lazy(() =>
  import('./components/KnowledgePanel').then((module) => ({ default: module.KnowledgePanel }))
)
const SettingsPanel = lazy(() =>
  import('./components/SettingsPanel').then((module) => ({ default: module.SettingsPanel }))
)
const StudioPanel = lazy(() => import('./components/StudioPanel').then((module) => ({ default: module.StudioPanel })))

export default function App() {
  const chat = useChat()
  const agent = useAgent()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)

  return (
    <div className={`app${agentOpen ? ' app--agent' : ''}`}>
      <Sidebar
        summaries={chat.summaries}
        activeId={chat.activeId}
        search={chat.search}
        setSearch={chat.setSearch}
        openConversation={chat.openConversation}
        newConversation={chat.newConversation}
        deleteConversation={chat.deleteConversation}
        agentRunning={agent.running}
        onOpenAgent={() => setAgentOpen(true)}
        onOpenKnowledge={() => setKnowledgeOpen(true)}
        onOpenStudio={() => setStudioOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ChatView
        messages={chat.messages}
        streamingId={chat.streamingId}
        contexts={chat.contexts}
        hasMore={chat.hasMore}
        onLoadEarlier={chat.loadEarlier}
        onSend={chat.send}
        onStop={chat.stop}
      />
      <Suspense fallback={null}>
        {agentOpen ? <AgentPanel agent={agent} onClose={() => setAgentOpen(false)} /> : null}
        {knowledgeOpen ? <KnowledgePanel onClose={() => setKnowledgeOpen(false)} /> : null}
        {studioOpen ? <StudioPanel onClose={() => setStudioOpen(false)} /> : null}
        {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
      </Suspense>
    </div>
  )
}
