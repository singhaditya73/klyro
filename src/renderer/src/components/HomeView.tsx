import { type WorkspaceView } from '@shared/types'
import {
  Monitor,
  Bot,
  Search,
  FileText,
  ArrowRight,
  Plus,
  HelpCircle,
} from 'lucide-react'
import { timeAgo } from '../lib/format'
import { useChat } from '../hooks/useChat'
import { Composer } from './Composer'
import { OpenCodeConnectCard } from './OpenCodeConnectCard'
import KlyroMark from '../assets/logo/klyro-mark.svg'

interface Props {
  onNewChat: () => Promise<void>
  onOpenView: (view: WorkspaceView) => void
}

interface QuickAction {
  id: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  action: () => void
}

function getTimeOfDay(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

export function HomeView({ onNewChat, onOpenView }: Props) {
  const chat = useChat()
  const quickActions: QuickAction[] = [
    {
      id: 'screen',
      title: 'Ask about my screen',
      description: 'Capture and ask questions about what you see',
      icon: Monitor,
      action: () => onOpenView('screen')
    },
    {
      id: 'memory',
      title: 'Summarize a document',
      description: 'Import a document and get grounded answers',
      icon: FileText,
      action: () => onOpenView('memory')
    },
    {
      id: 'chat',
      title: 'Research a topic',
      description: 'Open a conversation and dig in',
      icon: Search,
      action: () => onOpenView('chat')
    },
    {
      id: 'agent',
      title: 'Start a desktop task',
      description: 'Let the agent drive with your approval',
      icon: Bot,
      action: () => onOpenView('agent')
    }
  ]

  return (
    <div className="workspace" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <header className="workspace-header">
        <h1 className="workspace-header__title">Home</h1>
        <div className="workspace-header__actions">
          <button className="btn btn--primary" onClick={onNewChat} aria-label="New conversation">
            <Plus className="icon icon--sm" aria-hidden="true" />
            <span>New chat</span>
          </button>
        </div>
      </header>

      <div className="workspace-content">
        <section className="hero">
          <div className="hero__badge" aria-hidden="true">
            <img src={KlyroMark} alt="" className="hero__mark" />
          </div>
          <h1 className="hero__title">Good {getTimeOfDay()}.</h1>
          <p className="hero__sub">Ask anything, share your screen, or let Klyro work while you stay in control.</p>
        </section>

        {/* The send action of the hero composer starts the conversation; the
            user is then taken to the Chat workspace where the answer streams. */}
        <section className="hero__composer">
          <Composer
            variant="hero"
            busy={false}
            onSend={async (content, attachments) => {
              await chat.send(content, attachments)
              onOpenView('chat')
            }}
            onStop={chat.stop}
          />
        </section>

        <section style={{ width: '100%', marginBottom: '32px' }}>
          <OpenCodeConnectCard />
        </section>

        <section style={{ width: '100%', marginBottom: '40px' }}>
          <h2 className="section-label">Quick actions</h2>
          <div className="quick-action-grid">
            {quickActions.map((action) => (
              <button key={action.id} className="quick-action" onClick={action.action}>
                <span className="quick-action__icon" aria-hidden="true">
                  <action.icon className="icon icon--md" />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="quick-action__title">{action.title}</span>
                  <span className="quick-action__desc">{action.description}</span>
                </span>
                <ArrowRight className="icon icon--sm quick-action__chevron" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>

        <section style={{ width: '100%', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h2 className="section-label">Recent conversations</h2>
            {chat.summaries.length > 5 && (
              <button className="btn btn--ghost btn--sm" onClick={() => onOpenView('chat')}>
                View all
                <ArrowRight className="icon icon--xs" aria-hidden="true" />
              </button>
            )}
          </div>
          {chat.summaries.length === 0 ? (
            <div className="empty-content">
              <HelpCircle className="empty-content__icon" aria-hidden="true" />
              <h3 className="empty-content__title">No conversations yet</h3>
              <p className="empty-content__text">Your chats appear here. Start one with the composer above.</p>
              <div className="empty-content__actions">
                <button className="btn btn--primary" onClick={onNewChat}>
                  <Plus className="icon icon--sm" aria-hidden="true" />
                  <span>New chat</span>
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {chat.summaries.slice(0, 8).map((summary) => (
                <div key={summary.id} className="card hit recent-card" onClick={() => { chat.openConversation(summary.id); onOpenView('chat'); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chat.openConversation(summary.id); onOpenView('chat'); } }}
                >
                  <div className="card__row" style={{ flexWrap: 'nowrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="card__title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {summary.title || 'New chat'}
                      </div>
                      {summary.preview && (
                        <div className="card__subtitle" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {summary.preview}
                        </div>
                      )}
                    </div>
                    <time style={{ fontSize: '11px', color: 'var(--text-disabled)', whiteSpace: 'nowrap', marginLeft: 12 }}>
                      {timeAgo(summary.updatedAt)}
                    </time>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
