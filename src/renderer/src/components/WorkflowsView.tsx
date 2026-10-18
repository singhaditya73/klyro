import { useState, useEffect } from 'react'
import { Play, StopCircle, Trash2, Clock, ChevronDown, ChevronUp, FileText, CheckCircle, AlertCircle, Loader2, Zap } from 'lucide-react'
import { useStudio } from '../hooks/useStudio'
import KlyroMark from '../assets/logo/klyro-mark.svg'

const h2Style: React.CSSProperties = { margin: '0 0 16px', fontSize: '16px', fontWeight: 600 }
const sectionStyle: React.CSSProperties = { marginBottom: 40 }
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }
const cardStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%' }

export function WorkflowsView() {
  const studio = useStudio()
  const [input, setInput] = useState('')
  const [openRun, setOpenRun] = useState<string | null>(null)

  useEffect(() => {
    studio.setWorkflowInput(input)
  }, [input, studio])

  return (
    <div className="workspace" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <header className="workspace-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={KlyroMark} alt="" style={{ width: 32, height: 32 }} aria-hidden="true" />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Workflows</h1>
        </div>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: '32px 20px', display: 'flex', flexDirection: 'column', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
        <section style={sectionStyle}>
          <h2 style={h2Style}>Run a workflow</h2>
          <div className="field" style={{ marginBottom: 16 }}>
            <span className="field__label">Input</span>
            <textarea
              rows={4}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Input for the workflow (used as {{input}}) — a repo, a question, notes, or a diff…"
              className="field"
              style={{ borderRadius: 'var(--radius-lg)', padding: '14px 16px', fontSize: '14px' }}
            />
          </div>
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
            The input is available as <code style={{ background: 'var(--surface-base)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px' }}>{'{{input}}'}</code> in workflow steps.
          </p>

          {studio.workflowSteps.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              {studio.workflowSteps.map((step) => (
                <div key={step.name} className={'workflow-step' + (step.status === 'done' ? ' workflow-step--done' : step.status === 'failed' ? ' workflow-step--failed' : ' workflow-step--running')}>
                  <div className="workflow-step__icon" style={{ color: step.status === 'done' ? 'var(--success)' : step.status === 'failed' ? 'var(--danger)' : 'var(--warning)' }}>
                    {step.status === 'done' ? <CheckCircle className="icon icon--sm" aria-hidden="true" /> : step.status === 'failed' ? <AlertCircle className="icon icon--sm" aria-hidden="true" /> : <span className="icon icon--sm" style={{ animation: 'blink 1s infinite' }} aria-hidden="true">◐</span>}
                  </div>
                  <div className="workflow-step__body">
                    <div className="workflow-step__title">{step.name}</div>
                    {step.detail && <div className="workflow-step__detail">{step.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {studio.workflowRunning !== null && (
            <div className="provider__actions" style={{ marginBottom: '24px' }}>
              <button className="btn btn--danger" onClick={() => void studio.cancelWorkflow()}>
                <StopCircle className="icon icon--sm" aria-hidden="true" />
                <span>Stop run</span>
              </button>
            </div>
          )}

          {studio.workflowResult && (
            <div style={{ marginTop: '24px', padding: '16px', background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600 }}>Result</h3>
              <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                {studio.workflowResult.status === 'completed'
                  ? 'Saved to a new chat — open the sidebar to continue the conversation.'
                  : `This run ${studio.workflowResult.status}. Steps that finished are shown below.`}
              </p>
              {studio.workflowResult.steps.map((step) => (
                <div key={step.name} className="card" style={{ marginBottom: '8px' }}>
                  <div className="card__row">
                    <span className={step.ok ? 'pill pill--ok' : 'pill pill--danger'}> {step.ok ? 'ok' : 'failed'} </span>
                    <strong>{step.name}</strong>
                  </div>
                  <pre className="code-out">{step.output}</pre>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={sectionStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={h2Style}>Available workflows</h2>
          </div>

          {studio.workflows.length === 0 ? (
            <div className="empty-content" style={{ padding: '48px 24px', background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)' }}>
              <FileText className="empty-content__icon" aria-hidden="true" />
              <h3 className="empty-content__title">No workflows yet</h3>
              <p className="empty-content__text">Workflows let you automate multi-step processes. Built-in workflows will appear here, or you can create custom ones.</p>
            </div>
          ) : (
            <div style={gridStyle}>
              {studio.workflows.map((workflow) => (
                <div key={workflow.id} className="card" style={cardStyle}>
                  <div className="card__row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <strong style={{ flex: 1 }}>{workflow.name}</strong>
                    {workflow.builtin && <span className="pill"><Zap className="icon icon--xs" aria-hidden="true" />Built-in</span>}
                    <span className="pill" style={{ marginLeft: '8px' }}>{workflow.steps.length} step(s)</span>
                    {!workflow.builtin && (
                      <button
                        className="btn btn--icon btn--icon-sm conv__delete"
                        aria-label={'Delete workflow ' + workflow.name}
                        onClick={(e) => { e.stopPropagation(); void studio.deleteWorkflow(workflow.id); }}
                      >
                        <Trash2 className="icon icon--xs" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {workflow.description && <div className="card__text muted" style={{ flex: 1 }}>{workflow.description}</div>}
                  <div className="provider__actions" style={{ marginTop: 'auto', paddingTop: '8px' }}>
                    <button
                      className="btn btn--primary"
                      disabled={studio.workflowRunning !== null}
                      onClick={() => void studio.runWorkflow(workflow.id)}
                      style={{ width: '100%', padding: '12px', fontSize: '14px' }}
                    >
                      {studio.workflowRunning === workflow.id ? (
                        <>
                          <Loader2 className="icon icon--sm" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
                          <span>Running…</span>
                        </>
                      ) : (
                        <>
                          <Play className="icon icon--sm" aria-hidden="true" />
                          <span>Run</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {studio.workflowRuns.length > 0 && (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h2 style={h2Style}>Recent runs</h2>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                Runs are recorded on this device so an interrupted run is never left silently in progress.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {studio.workflowRuns.slice(0, 10).map((run) => (
                <div key={run.id} className="card" onClick={() => setOpenRun(openRun === run.id ? null : run.id)} style={{ cursor: 'pointer' }}>
                  <div className="card__row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={run.status === 'completed' ? 'pill pill--ok' : run.status === 'failed' ? 'pill pill--danger' : 'pill'}> {run.status} </span>
                    <strong>{run.workflowName}</strong>
                    <span className="card__spacer" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '12px' }}>
                        <Clock className="icon icon--xs" aria-hidden="true" />
                        {new Date(run.finishedAt || run.startedAt).toLocaleString()}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '12px' }}>
                        <FileText className="icon icon--xs" aria-hidden="true" />
                        {run.steps.filter((s) => s.status === 'done').length}/{run.steps.length} steps
                      </span>
                    </span>
                    <span className="icon icon--md" style={{ color: 'var(--text-muted)' }}>
                      {openRun === run.id ? <ChevronUp className="icon icon--sm" aria-hidden="true" /> : <ChevronDown className="icon icon--sm" aria-hidden="true" />}
                    </span>
                  </div>
                  {openRun === run.id && (
                    <>
                      {run.error && <div className="card__text" style={{ color: 'var(--danger)', marginTop: '8px' }}>{run.error}</div>}
                      <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {run.steps.map((step) => (
                          <div key={step.name} className={'workflow-step' + (step.status === 'done' ? ' workflow-step--done' : step.status === 'failed' ? ' workflow-step--failed' : '')} style={{ padding: '8px 10px', background: 'var(--surface-base)', borderRadius: 'var(--radius-md)' }}>
                            <div className="workflow-step__icon" style={{ color: step.status === 'done' ? 'var(--success)' : step.status === 'failed' ? 'var(--danger)' : 'var(--text-muted)' }}>
                              {step.status === 'done' ? <CheckCircle className="icon icon--xs" aria-hidden="true" /> : step.status === 'failed' ? <AlertCircle className="icon icon--xs" aria-hidden="true" /> : <span className="icon icon--xs" aria-hidden="true">◐</span>}
                            </div>
                            <div className="workflow-step__body">
                              <div className="workflow-step__title">{step.name}</div>
                              {step.detail && <div className="workflow-step__detail">{step.detail}</div>}
                              <pre className="code-out" style={{ marginTop: 8, maxHeight: 200 }}>{step.output}</pre>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}