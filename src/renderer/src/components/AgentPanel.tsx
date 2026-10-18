import type { AgentController } from '../hooks/useAgent'
import { describeAction, STATUS_ICON } from '../lib/agent'
import { timeAgo } from '../lib/format'
import { useModal } from '../hooks/useModal'
import { useState } from 'react'
import { X, Play, Pause, StopCircle, Loader2, AlertCircle, CheckCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import KlyroMark from '../assets/logo/klyro-mark.svg'

interface Props {
  agent: AgentController
  onClose: () => void
}

export function AgentPanel({ agent, onClose }: Props) {
  const { caps } = agent
  const panelRef = useModal(onClose)
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <aside className="agent-panel" ref={panelRef} role="complementary" aria-label="Desktop agent" tabIndex={-1}>
      <div className="agent-panel__head">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src={KlyroMark} alt="" style={{ width: 24, height: 24 }} aria-hidden="true" />
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Desktop Agent</h2>
        </div>
        <button className="btn btn--icon btn--icon-sm btn--ghost" aria-label="Close the agent panel" onClick={onClose}>
          <X className="icon icon--sm" aria-hidden="true" />
        </button>
      </div>

      {caps && !caps.available ? (
        <div className="agent-panel__warning">
          <strong>Automation unavailable</strong>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Klyro drives your mouse and keyboard through an external backend. None is installed on this
            {caps.session === 'wayland' ? ' Wayland' : caps.session === 'x11' ? ' X11' : ''} session.
          </p>
          {caps.missing.length && <p className="muted" style={{ margin: '8px 0 0' }}><strong>Missing:</strong> {caps.missing.join(', ')}</p>}
          {caps.installHint && <code className="agent-panel__code">{caps.installHint}</code>}
          <button className="btn btn--sm" style={{ marginTop: '10px' }} onClick={() => void agent.refreshCaps()}>
            <Loader2 className="icon icon--xs" aria-hidden="true" />
            <span>Re-check</span>
          </button>
        </div>
      ) : null}

      {caps && caps.available ? (
        <div className="agent-panel__caps">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle className="icon icon--sm" style={{ color: 'var(--success)' }} aria-hidden="true" />
            <span>Backend: <strong>{caps.backends.join(', ')}</strong></span>
          </div>
          {caps.limitations.map((note, index) => (
            <div key={index} className="muted" style={{ fontSize: '12px', marginTop: '4px' }}>
              {note}
            </div>
          ))}
        </div>
      ) : null}

      <label className="field">
        <span className="field__label">What should Klyro do?</span>
        <textarea
          rows={3}
          placeholder="e.g. Open the calculator and compute 42 &times; 17"
          value={agent.goal}
          disabled={agent.running}
          onChange={(event) => agent.setGoal(event.target.value)}
          className="field"
        />
      </label>

      <div className="agent-panel__actions">
        {agent.running ? (
          <button className="btn btn--danger" onClick={agent.stop} aria-label="Stop agent">
            <StopCircle className="icon icon--sm" aria-hidden="true" />
            <span>Stop</span>
          </button>
        ) : (
          <button
            className="btn btn--primary"
            disabled={!caps?.available || !agent.goal.trim()}
            onClick={() => void agent.start()}
            aria-label="Run agent task"
          >
            <Play className="icon icon--sm" aria-hidden="true" />
            <span>Run task</span>
          </button>
        )}
        {agent.running && agent.paused ? (
          <button className="btn" onClick={agent.resume} aria-label="Resume agent">
            <Play className="icon icon--sm" aria-hidden="true" />
            <span>Resume</span>
          </button>
        ) : null}
        {agent.running && !agent.paused ? (
          <button className="btn btn--ghost" onClick={agent.pause} aria-label="Pause agent">
            <Pause className="icon icon--sm" aria-hidden="true" />
            <span>Pause</span>
          </button>
        ) : null}
        <span className="muted" style={{ fontSize: '12px' }}>
          {agent.running ? (agent.paused ? 'Paused' : 'Working&hellip;') : 'Idle'}
        </span>
      </div>

      {agent.pending ? (
        <div className="agent-panel__warning" style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-hover)' }}>
          <strong>Confirm action</strong>
          <p style={{ margin: '6px 0 0', fontSize: '13px' }}>{describeAction(agent.pending.action)}</p>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: '12px' }}>{agent.pending.reason}</p>
          <div className="agent-panel__actions" style={{ marginTop: '12px' }}>
            <button className="btn btn--primary" onClick={() => agent.decide(true)}>
              <CheckCircle className="icon icon--sm" aria-hidden="true" />
              <span>Approve</span>
            </button>
            <button className="btn btn--ghost" onClick={() => agent.decide(false)}>
              <X className="icon icon--sm" aria-hidden="true" />
              <span>Decline</span>
            </button>
          </div>
        </div>
      ) : null}

      <div className="agent-panel__steps">
        {agent.steps.length === 0 ? (
          <div className="muted" style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No steps yet. Describe a task and click Run task.
          </div>
        ) : (
          agent.steps.map((step) => (
            <div key={step.index} className={`agent-step agent-step--${step.status}`}>
              <span className="agent-step__icon" style={{ color: step.status === 'executed' ? 'var(--success)' : step.status === 'failed' ? 'var(--danger)' : step.status === 'pending' ? 'var(--warning)' : 'var(--text-muted)' }}>
                {STATUS_ICON[step.status]}
              </span>
              <div className="agent-step__body">
                <div className="agent-step__title">{describeAction(step.action)}</div>
                {step.detail && <div className="agent-step__detail">{step.detail}</div>}
                {step.verified !== undefined && (
                  <div className="agent-step__detail" style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className={step.verified ? 'success' : 'danger'} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                      {step.verified ? <CheckCircle className="icon icon--xs" aria-hidden="true" /> : <AlertCircle className="icon icon--xs" aria-hidden="true" />}
                      Screen {step.verified ? 'changed as expected' : 'did not change as expected'}
                    </span>
                    {step.screenChanged !== undefined && (
                      <span style={{ color: step.screenChanged ? 'var(--success)' : 'var(--text-muted)', fontSize: '11px' }}>
                        {step.screenChanged ? '&#183; Screen changed' : '&#183; No screen change'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {agent.outcome && (
        <div className={`agent-panel__outcome agent-panel__outcome--${agent.outcome.kind}`}>
          {agent.outcome.message}
        </div>
      )}

      <div style={{ marginTop: '8px' }}>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => setHistoryOpen(!historyOpen)}
          style={{ width: '100%', justifyContent: 'space-between' }}
          aria-expanded={historyOpen}
        >
          <span>
            <Clock className="icon icon--sm" aria-hidden="true" />
            <span style={{ marginLeft: '8px' }}>Recent tasks</span>
          </span>
          {historyOpen ? <ChevronUp className="icon icon--sm" aria-hidden="true" /> : <ChevronDown className="icon icon--sm" aria-hidden="true" />}
        </button>
        {historyOpen && agent.tasks.length > 0 && (
          <div className="agent-panel__history" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {agent.tasks.slice(0, 5).map((task) => (
              <div key={task.id} className="agent-panel__task">
                <div className="agent-panel__task-goal">{task.goal}</div>
                <div className="agent-panel__task-meta">
                  <span>{task.outcome}</span>
                  <span>&#183;</span>
                  <span>{task.steps.length} steps</span>
                  <span>&#183;</span>
                  <span>
                    <Clock className="icon icon--xs" aria-hidden="true" />
                    {timeAgo(task.finishedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {historyOpen && agent.tasks.length === 0 && (
          <div className="muted" style={{ padding: '16px', textAlign: 'center' }}>No task history yet.</div>
        )}
      </div>
    </aside>
  )
}

