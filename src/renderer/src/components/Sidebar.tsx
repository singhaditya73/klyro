import type { ConversationSummary } from '@shared/types'
import { timeAgo } from '../lib/format'

interface Props {
  summaries: ConversationSummary[]
  activeId: string | null
  search: string
  setSearch: (value: string) => void
  openConversation: (id: string) => Promise<void>
  newConversation: () => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  agentRunning: boolean
  onOpenAgent: () => void
  onOpenKnowledge: () => void
  onOpenSettings: () => void
}

export function Sidebar(props: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="logo" />
        <div className="sidebar__brand-text">
          <div className="brand-name">Klyro</div>
          <div className="brand-tag">Your AI. Your entire computer.</div>
        </div>
      </div>

      <button className="btn btn--primary" onClick={() => void props.newConversation()}>
        + New chat
      </button>

      <input
        className="sidebar__search"
        placeholder="Search chats…"
        value={props.search}
        onChange={(event) => props.setSearch(event.target.value)}
      />

      <div className="sidebar__list">
        {props.summaries.map((summary) => (
          <div
            key={summary.id}
            className={`conv${summary.id === props.activeId ? ' conv--active' : ''}`}
            onClick={() => void props.openConversation(summary.id)}
          >
            <div className="conv__title">{summary.title}</div>
            <div className="conv__preview">{summary.preview || `${summary.messageCount} messages`}</div>
            <div className="conv__meta">{timeAgo(summary.updatedAt)}</div>
            <button
              className="conv__delete"
              title="Delete chat"
              onClick={(event) => {
                event.stopPropagation()
                void props.deleteConversation(summary.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
        {props.summaries.length === 0 ? <div className="sidebar__empty">No chats yet</div> : null}
      </div>

      <button className="btn sidebar__agent" onClick={props.onOpenAgent}>
        {props.agentRunning ? '◐ Agent running…' : '🖥️ Agent'}
      </button>
      <button className="btn sidebar__agent" onClick={props.onOpenKnowledge}>
        🧠 Knowledge
      </button>
      <button className="btn sidebar__settings" onClick={props.onOpenSettings}>
        ⚙️ Settings
      </button>
    </aside>
  )
}
