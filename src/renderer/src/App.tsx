import { useState } from 'react'
import { ChatView } from './components/ChatView'
import { SettingsPanel } from './components/SettingsPanel'
import { Sidebar } from './components/Sidebar'
import { useChat } from './hooks/useChat'

export default function App() {
  const chat = useChat()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className="app">
      <Sidebar
        summaries={chat.summaries}
        activeId={chat.activeId}
        search={chat.search}
        setSearch={chat.setSearch}
        openConversation={chat.openConversation}
        newConversation={chat.newConversation}
        deleteConversation={chat.deleteConversation}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <ChatView
        messages={chat.messages}
        streamingId={chat.streamingId}
        onSend={chat.send}
        onStop={chat.stop}
      />
      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  )
}
