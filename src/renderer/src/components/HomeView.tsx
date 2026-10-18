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
        <section style={{ textAlign: 'center', margin: '32px auto 28px', maxWidth: '720px' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Good {getTimeOfDay()}.
          </h2>
          <p style={{ margin: 0, fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            What would you like to get done?
          </p>
        </section>

        {/* The send action of the hero composer starts the conversation; the
            user is then taken to the Chat workspace where the answer streams. */}
        <section style={{ width: '100%', maxWidth: '760px', margin: '0 auto 36px' }}>
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

        <section style={{ width: '100%', marginBottom: '40px' }}>
          <h2 className="section-label">Quick actions</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
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
                <div
                  key={summary.id}
                  className="card"
                  onClick={() => { chat.openConversation(summary.id); onOpenView('chat'); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chat.openConversation(summary.id); onOpenView('chat'); } }}
                  style={{ cursor: 'pointer', margin: 0, padding: '12px 16px' }}
                >
                  <div className="card__row" style={{ flexWrap: 'nowrap' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="card__title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {summary.title || 'New chat'}
                      </div>
                      <div className="card__subtitle" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {summary.preview || `${summary.messageCount} messages`}
                      </div>
                    </div>
                    <time style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 12 }}>
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
