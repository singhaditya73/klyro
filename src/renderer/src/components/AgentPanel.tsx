import type { AgentController } from '../hooks/useAgent'
import { describeAction, STATUS_ICON } from '../lib/agent'
import { timeAgo } from '../lib/format'

interface Props {
  agent: AgentController
  onClose: () => void
}

export function AgentPanel({ agent, onClose }: Props) {
  const { caps } = agent

  return (
    <aside className="agent">
      <div className="agent__head">
        <h2>Desktop agent</h2>
        <button className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {caps && !caps.available ? (
        <div className="agent__warning">
          <strong>Automation unavailable</strong>
          <p className="muted">
            Klyro drives your mouse and keyboard through an external backend. None is installed on this
            {caps.session === 'wayland' ? ' Wayland' : caps.session === 'x11' ? ' X11' : ''} session.
          </p>
          {caps.missing.length ? <p className="muted">Missing: {caps.missing.join(', ')}</p> : null}
          {caps.installHint ? <code className="agent__code">{caps.installHint}</code> : null}
          <button className="btn" onClick={() => void agent.refreshCaps()}>
            Re-check
          </button>
        </div>
      ) : null}

      {caps && caps.available ? (
        <div className="agent__caps">
          Backend: <strong>{caps.backends.join(', ')}</strong>
          {caps.limitations.map((note, index) => (
            <div key={index} className="muted">
              {note}
            </div>
          ))}
        </div>
      ) : null}

      <label className="field">
        What should Klyro do?
        <textarea
          rows={3}
          placeholder="e.g. Open the calculator and compute 42 × 17"
          value={agent.goal}
          disabled={agent.running}
          onChange={(event) => agent.setGoal(event.target.value)}
        />
      </label>

      <div className="agent__actions">
        {agent.running ? (
          <button className="btn btn--danger" onClick={agent.stop}>
            Stop
          </button>
        ) : (
          <button
            className="btn btn--primary"
            disabled={!caps?.available || !agent.goal.trim()}
            onClick={() => void agent.start()}
          >
            Run task
          </button>
        )}
        <span className="muted">{agent.running ? 'Working…' : 'Idle'}</span>
      </div>

      {agent.pending ? (
        <div className="agent__confirm">
          <strong>Confirm action</strong>
          <p>{describeAction(agent.pending.action)}</p>
          <p className="muted">{agent.pending.reason}</p>
          <div className="agent__actions">
            <button className="btn btn--primary" onClick={() => agent.decide(true)}>
              Approve
            </button>
            <button className="btn btn--ghost" onClick={() => agent.decide(false)}>
              Decline
            </button>
          </div>
        </div>
      ) : null}

      <div className="agent__steps">
        {agent.steps.length === 0 ? (
          <div className="muted">No steps yet.</div>
        ) : (
          agent.steps.map((step) => (
            <div key={step.index} className={`step step--${step.status}`}>
              <span className="step__icon">{STATUS_ICON[step.status]}</span>
              <div className="step__body">
                <div className="step__title">{describeAction(step.action)}</div>
                {step.detail ? <div className="step__detail">{step.detail}</div> : null}
              </div>
            </div>
          ))
        )}
      </div>

      {agent.outcome ? (
        <div className={`agent__outcome agent__outcome--${agent.outcome.kind}`}>{agent.outcome.message}</div>
      ) : null}

      {agent.tasks.length > 0 ? (
        <div className="agent__history">
          <h3>Recent tasks</h3>
          {agent.tasks.slice(0, 5).map((task) => (
            <div key={task.id} className="agent__task">
              <div className="agent__task-goal">{task.goal}</div>
              <div className="muted">
                {task.outcome} · {task.steps.length} steps · {timeAgo(task.finishedAt)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  )
}
