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
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react'
import { timeAgo } from '../lib/format'
import KlyroMark from '../assets/logo/klyro-mark.svg'
import { useState } from 'react'

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
  /** Plain-language explanation, shown as a tooltip. */
  hint?: string
}

export function Sidebar(props: Props) {
  // Destructive chat deletion is two-step: the first click arms the button,
  // the second (clicking the same item again) actually deletes it.
  const [armedDelete, setArmedDelete] = useState<string | null>(null)
  const navItems: NavItem[] = [
    { id: 'home', label: 'Home', icon: <HomeIcon />, onClick: props.onOpenHome },
    { id: 'chat', label: 'Chat', icon: <MessageSquareIcon />, onClick: props.onOpenChat },
    {
      id: 'screen',
      label: 'Screen',
      icon: <MonitorIcon />,
      onClick: props.onOpenScreen,
      hint: 'Ask about what is on your screen: capture it, then ask a question about the picture'
    },
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

      <div className="sidebar__actions">
        <button
          className={`btn btn--primary${props.collapsed ? ' btn--icon' : ''}`}
          onClick={props.newConversation}
          aria-label="New conversation"
          title={props.collapsed ? 'New chat' : undefined}
        >
          <Plus className="icon icon--sm" aria-hidden="true" />
          <span className="btn__label">New chat</span>
        </button>
      </div>

      {!props.collapsed && (
        <div className="sidebar__search-wrapper">
          <input
            className="sidebar__search"
            placeholder="Search chats…"
            value={props.search}
            onChange={(event) => props.setSearch(event.target.value)}
            aria-label="Search conversations"
          />
          {props.search && (
            <button
              className="search-clear sidebar__search-clear"
              onClick={() => props.setSearch('')}
              aria-label="Clear search"
            >
              <X className="icon icon--xs" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {!props.collapsed && (
        <nav className="sidebar__nav sidebar__nav--chats" aria-label="Conversations">
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
                  <time className="conversation-item__time">{timeAgo(summary.updatedAt)}</time>
                  <div className="conversation-item__actions">
                    <button
                      className={`btn btn--icon btn--icon-sm${summary.id === armedDelete ? ' btn--danger' : ''}`}
                      title={summary.id === armedDelete ? 'Click again to delete' : 'Delete chat'}
                      aria-label={
                        summary.id === armedDelete
                          ? `Confirm deletion of chat ${summary.title}`
                          : `Delete chat ${summary.title}`
                      }
                      aria-pressed={summary.id === armedDelete}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (summary.id === armedDelete) {
                          void props.deleteConversation(summary.id)
                          setArmedDelete(null)
                        } else {
                          setArmedDelete(summary.id)
                        }
                      }}
                    >
                      <Trash2 className="icon icon--xs" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {summary.preview && <div className="conversation-item__preview">{summary.preview}</div>}
              </div>
            ))}
            {props.summaries.length === 0 ? (
              <div className="conversation-empty">No chats yet. Start a new conversation.</div>
            ) : null}
          </div>
        </nav>
      )}

      <div className="sidebar__section sidebar__section--workspaces">
        {!props.collapsed && <h3 className="sidebar__section-title">Workspaces</h3>}
        {/* Always visible: in collapsed mode this is the icon rail, so the
            workspaces (and their names, via title tooltips on the buttons)
            remain reachable at every sidebar width. */}
        <nav className="sidebar__nav" aria-label="Workspaces">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item${props.activeView === item.id ? ' nav-item--active' : ''}`}
              onClick={item.onClick}
              aria-current={props.activeView === item.id ? 'true' : undefined}
              title={props.collapsed ? item.label : item.hint}
              aria-label={props.collapsed ? item.label : undefined}
            >
              <span className="nav-item__icon">{item.icon}</span>
              <span className="nav-item__label">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="sidebar__footer">
        <div className="sidebar__footer-row">
          <button
            className="btn"
            onClick={props.onOpenSettings}
            aria-label="Settings"
            title={props.collapsed ? 'Settings' : undefined}
          >
            <Settings2 className="icon icon--sm" aria-hidden="true" />
            <span className="btn__label">Settings</span>
          </button>
          {!props.collapsed && (
            <button
              className="btn btn--icon"
              onClick={props.onToggleCollapse}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="icon icon--sm" aria-hidden="true" />
            </button>
          )}
        </div>
        {props.collapsed && (
          <button
            className="btn btn--icon"
            onClick={props.onToggleCollapse}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            style={{ marginTop: 8 }}
          >
            <PanelLeftOpen className="icon icon--sm" aria-hidden="true" />
          </button>
        )}
      </div>
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