import type { ConversationSummary } from '@shared/types'
import {
  Plus,
  MessageSquare,
  Monitor,
  Bot,
  Workflow,
  Brain,
  Blocks,
  Settings2,
  Trash2,
} from 'lucide-react'
import { timeAgo } from '../lib/format'
import KlyroMark from '../assets/logo/klyro-mark.svg'

interface Props {
  summaries: ConversationSummary[]
  activeId: string | null
  search: string
  setSearch: (value: string) => void
  openConversation: (id: string) => Promise<void>
  newConversation: () => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  onOpenHome: () => void
  onOpenChat: () => void
  onOpenScreen: () => void
  onOpenAgent: () => void
  onOpenWorkflows: () => void
  onOpenMemory: () => void
  onOpenIntegrations: () => void
  onOpenSettings: () => void
  activeView: string
  collapsed?: boolean
  onToggleCollapse: () => void
}

type NavItem = {
  id: string
  label: string
  icon: React.ReactNode
  onClick: () => void
}

export function Sidebar(props: Props) {
  const navItems: NavItem[] = [
    { id: 'home', label: 'Home', icon: <HomeIcon />, onClick: props.onOpenHome },
    { id: 'chat', label: 'Chat', icon: <MessageSquareIcon />, onClick: props.onOpenChat },
    { id: 'screen', label: 'Screen', icon: <MonitorIcon />, onClick: props.onOpenScreen },
    { id: 'agent', label: 'Agent', icon: <BotIcon />, onClick: props.onOpenAgent },
    { id: 'workflows', label: 'Workflows', icon: <WorkflowIcon />, onClick: props.onOpenWorkflows },
    { id: 'memory', label: 'Memory', icon: <BrainIcon />, onClick: props.onOpenMemory },
    { id: 'integrations', label: 'Integrations', icon: <BlocksIcon />, onClick: props.onOpenIntegrations },
  ]

  return (
    <aside className={`sidebar${props.collapsed ? ' sidebar--collapsed' : ''}`} role="navigation" aria-label="Main navigation">
      <div className="sidebar__brand" aria-label="Klyro">
        <img src={KlyroMark} alt="" className="logo" aria-hidden="true" />
        {!props.collapsed && (
          <div className="sidebar__brand-text">
            <div className="brand-name">Klyro</div>
            <div className="brand-tag">Your AI workspace</div>
          </div>
        )}
      </div>

      {!props.collapsed && (
        <div className="sidebar__actions">
          <button className="btn btn--primary" onClick={props.newConversation} aria-label="New conversation">
            <Plus className="icon icon--sm" aria-hidden="true" />
            <span className="btn__label">New chat</span>
          </button>
        </div>
      )}

      {!props.collapsed && (
        <div className="sidebar__search-wrapper">
          <input
            className="sidebar__search"
            placeholder="Search chats…"
            value={props.search}
            onChange={(event) => props.setSearch(event.target.value)}
            aria-label="Search conversations"
          />
        </div>
      )}

      <nav className="sidebar__nav" aria-label="Conversations">
        <h3 className="sidebar__section-title">Chats</h3>
        <div className="conversation-list">
          {props.summaries.map((summary) => (
            <div
              key={summary.id}
              className={`conversation-item${summary.id === props.activeId ? ' conversation-item--active' : ''}`}
              onClick={() => void props.openConversation(summary.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void props.openConversation(summary.id); } }}
              aria-current={summary.id === props.activeId ? 'true' : undefined}
              aria-label={summary.title}
            >
              <div className="conversation-item__header">
                <span className="conversation-item__title">{summary.title || 'New chat'}</span>
                <div className="conversation-item__actions">
                  <button
                    className="btn btn--icon btn--icon-sm conv__delete"
                    title="Delete chat"
                    aria-label={`Delete chat ${summary.title}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      void props.deleteConversation(summary.id)
                    }}
                  >
                    <Trash2 className="icon icon--xs" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="conversation-item__preview">{summary.preview || `${summary.messageCount} messages`}</div>
              <div className="conversation-item__meta">
                <time>{timeAgo(summary.updatedAt)}</time>
              </div>
            </div>
          ))}
          {props.summaries.length === 0 ? (
            <div className="conversation-empty">No chats yet. Start a new conversation.</div>
          ) : null}
        </div>
      </nav>

      {!props.collapsed && (
        <>
          <div className="sidebar__section">
            <h3 className="sidebar__section-title">Workspaces</h3>
            <nav className="sidebar__nav" aria-label="Workspaces">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item${props.activeView === item.id ? ' nav-item--active' : ''}`}
                  onClick={item.onClick}
                  aria-current={props.activeView === item.id ? 'true' : undefined}
                >
                  <span className="nav-item__icon">{item.icon}</span>
                  <span className="nav-item__label">{item.label}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="sidebar__footer">
            <button
              className="btn"
              onClick={props.onOpenSettings}
              aria-label="Settings"
            >
              <Settings2 className="icon icon--sm" aria-hidden="true" />
              <span className="btn__label">Settings</span>
            </button>
          </div>
        </>
      )}
    </aside>
  )
}

// Icon components for consistent sizing
function HomeIcon() { return <MessageSquare className="icon icon--md" aria-hidden="true" /> }
function MessageSquareIcon() { return <MessageSquare className="icon icon--md" aria-hidden="true" /> }
function MonitorIcon() { return <Monitor className="icon icon--md" aria-hidden="true" /> }
function BotIcon() { return <Bot className="icon icon--md" aria-hidden="true" /> }
function WorkflowIcon() { return <Workflow className="icon icon--md" aria-hidden="true" /> }
function BrainIcon() { return <Brain className="icon icon--md" aria-hidden="true" /> }
function BlocksIcon() { return <Blocks className="icon icon--md" aria-hidden="true" /> }