import { useState } from 'react'
import { AgentPanel } from './components/AgentPanel'
import { ChatView } from './components/ChatView'
import { KnowledgePanel } from './components/KnowledgePanel'
import { SettingsPanel } from './components/SettingsPanel'
import { Sidebar } from './components/Sidebar'
import { useAgent } from './hooks/useAgent'
import { useChat } from './hooks/useChat'
import { useKnowledge } from './hooks/useKnowledge'

export default function App() {
  const chat = useChat()
  const agent = useAgent()
  const knowledge = useKnowledge()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)

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
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ChatView
        messages={chat.messages}
        streamingId={chat.streamingId}
        contexts={chat.contexts}
        onSend={chat.send}
        onStop={chat.stop}
      />
      {agentOpen ? <AgentPanel agent={agent} onClose={() => setAgentOpen(false)} /> : null}
      {knowledgeOpen ? <KnowledgePanel knowledge={knowledge} onClose={() => setKnowledgeOpen(false)} /> : null}
      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  )
}
