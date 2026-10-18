import { useState } from 'react'
import type { CodeActionKind } from '@shared/types'
import { useStudio } from '../hooks/useStudio'
import { useModal } from '../hooks/useModal'
import { timeAgo } from '../lib/format'
import { Plus, Play, StopCircle, Clock, ChevronDown, ChevronUp, Trash2, FileText, CheckCircle, AlertCircle, Loader2, Search, RotateCcw, Code, MessageSquare, GitBranch, Zap, X } from 'lucide-react'
import KlyroMark from '../assets/logo/klyro-mark.svg'

interface Props {
  onClose: () => void
}

type Tab = 'code' | 'meetings' | 'workflows'

const CODE_ACTIONS: { kind: CodeActionKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'explain', label: 'Explain', icon: <MessageSquare className="icon icon--sm" aria-hidden="true" /> },
  { kind: 'bugs', label: 'Find bugs', icon: <AlertCircle className="icon icon--sm" aria-hidden="true" /> },
  { kind: 'tests', label: 'Write tests', icon: <CheckCircle className="icon icon--sm" aria-hidden="true" /> },
  { kind: 'refactor', label: 'Refactor', icon: <RotateCcw className="icon icon--sm" aria-hidden="true" /> },
  { kind: 'docs', label: 'Document', icon: <FileText className="icon icon--sm" aria-hidden="true" /> },
]

function clock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0')
}

const h3Style: React.CSSProperties = { margin: '0 0 16px', fontSize: '14px', fontWeight: 600 }
const h4Style: React.CSSProperties = { margin: '0 0 12px', fontSize: '13px', fontWeight: 600 }

export function StudioPanel({ onClose }: Props) {
  const studio = useStudio()
  const panelRef = useModal(onClose)
  const [tab, setTab] = useState<Tab>('code')
  const [snippet, setSnippet] = useState('')
  const [question, setQuestion] = useState('')
  const [editPath, setEditPath] = useState('')
  const [editContent, setEditContent] = useState('')
  const [meetingTitle, setMeetingTitle] = useState('')
  const [openMeeting, setOpenMeeting] = useState<string | null>(null)
  const [openRun, setOpenRun] = useState<string | null>(null)

  return (
    <div className="modal">
      <div className="modal__panel modal__panel--wide" ref={panelRef} role="dialog" aria-modal="true" aria-label="Studio" tabIndex={-1}>
        <div className="modal__head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={KlyroMark} alt="" style={{ width: 24, height: 24 }} aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Studio</h2>
          </div>
          <button
            className="btn btn--icon btn--icon-sm btn--ghost"
            aria-label="Close Studio"
            disabled={studio.recording}
            title={studio.recording ? 'Stop the recording first' : undefined}
            onClick={onClose}
          >
            <X className="icon icon--sm" aria-hidden="true" />
          </button>
        </div>

        <div className="tabs" role="tablist">
          <button className={tab === 'code' ? 'tab tab--active' : 'tab'} role="tab" aria-selected={tab === 'code'} onClick={() => setTab('code')}>
            <Code className="icon icon--sm" aria-hidden="true" />
            <span style={{ marginLeft: 6 }}>Coding</span>
          </button>
          <button className={tab === 'meetings' ? 'tab tab--active' : 'tab'} role="tab" aria-selected={tab === 'meetings'} onClick={() => setTab('meetings')}>
            <MessageSquare className="icon icon--sm" aria-hidden="true" />
            <span style={{ marginLeft: 6 }}>Meetings ({studio.meetings.length})</span>
          </button>
          <button className={tab === 'workflows' ? 'tab tab--active' : 'tab'} role="tab" aria-selected={tab === 'workflows'} onClick={() => setTab('workflows')}>
            <GitBranch className="icon icon--sm" aria-hidden="true" />
            <span style={{ marginLeft: 6 }}>Workflows ({studio.workflows.length})</span>
          </button>
        </div>

        <div className="modal__body">
          {studio.error && <div className="notice notice--error" style={{ marginBottom: 16 }}><AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />{studio.error}</div>}

          {tab === 'code' && (
            <section>
              <h3 style={h3Style}>Project index</h3>
              {studio.project?.root ? (
                <div className="permissions-section">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <strong>{studio.project.root}</strong>
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                    {studio.project.files} files \u00B7 {studio.project.chunks} chunks
                    {studio.project.skipped ? ' \u00B7 ' + studio.project.skipped + ' skipped' : ''}
                    {studio.project.indexedAt ? ' \u00B7 indexed ' + timeAgo(studio.project.indexedAt) : ''}
                  </div>
                  <div className="provider__actions" style={{ gap: 10 }}>
                    <button className="btn" onClick={() => void studio.indexProject()}>
                      <RotateCcw className="icon icon--sm" aria-hidden="true" />
                      <span>Re-index</span>
                    </button>
                    <button className="btn btn--ghost" onClick={() => void studio.clearProject()}>
                      <Trash2 className="icon icon--sm" aria-hidden="true" />
                      <span>Forget project</span>
                    </button>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Indexed files ground code answers, workflow prompts, and normal chat.</div>
                  {studio.project.lastScan && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                      Last scan: {studio.project.lastScan.added} added \u00B7 {studio.project.lastScan.updated} updated \u00B7 {studio.project.lastScan.reused} unchanged \u00B7 {studio.project.lastScan.removed} removed
                    </div>
                  )}
                </div>
              ) : (
                <div className="provider__actions" style={{ gap: 10 }}>
                  <button className="btn btn--primary" disabled={studio.indexing} onClick={() => void studio.indexProject()}>
                    {studio.indexing ? (
                      <>
                        <Loader2 className="icon icon--sm" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
                        <span>Indexing\u2026</span>
                      </>
                    ) : (
                      <>
                        <Plus className="icon icon--sm" aria-hidden="true" />
                        <span>Index a project folder\u2026</span>
                      </>
                    )}
                  </button>
                  <span className="muted">Nothing indexed yet.</span>
                </div>
              )}

              <h3 style={{ ...h3Style, marginTop: 32 }}>Ask about code</h3>
              <label className="field" style={{ marginBottom: 12 }}>
                <span className="field__label">Paste a snippet</span>
                <textarea rows={8} value={snippet} onChange={(event) => setSnippet(event.target.value)} placeholder="Paste the function, file, or diff you want help with\u2026" spellCheck={false} className="field" />
              </label>
              <label className="field" style={{ marginBottom: 16 }}>
                <span className="field__label">Optional question or context</span>
                <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. What does this function do?" className="field" />
              </label>
              <div className="provider__actions" style={{ flexWrap: 'wrap', gap: 10 }}>
                {CODE_ACTIONS.map((action) => (
                  <button key={action.kind} className="btn" disabled={!snippet.trim() || studio.codeBusy} onClick={() => void studio.runCodeAction(action.kind, snippet, question || undefined)}>
                    {action.icon}
                    <span style={{ marginLeft: 6 }}>{action.label}</span>
                  </button>
                ))}
              </div>

              {studio.codeBusy && <div className="muted" style={{ marginTop: 12 }}><Loader2 className="icon icon--sm" style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} aria-hidden="true" />Thinking\u2026</div>}
              {studio.codeCitations.length > 0 && (
                <div className="muted" style={{ marginTop: 12, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Search className="icon icon--xs" aria-hidden="true" />
                  Used: {studio.codeCitations.map((citation) => citation.name + (citation.line > 0 ? ':' + citation.line + (citation.endLine && citation.endLine > citation.line ? '-' + citation.endLine : '') : '')).join(', ')}
                </div>
              )}
              {studio.codeOutput && <pre className="code-out">{studio.codeOutput}</pre>}

              <h3 style={{ ...h3Style, marginTop: 32 }}>Edit a project file</h3>
              <p className="muted" style={{ margin: '0 0 16px', fontSize: 12, lineHeight: 1.5 }}>
                Klyro never writes a file on its own: it shows you the exact diff and waits. A backup is kept so every applied change can be reverted.
              </p>
              <label className="field" style={{ marginBottom: 12 }}>
                <span className="field__label">File path (relative to the indexed project)</span>
                <input value={editPath} onChange={(event) => setEditPath(event.target.value)} placeholder="src/main/index.ts" spellCheck={false} className="field" />
              </label>
              <label className="field" style={{ marginBottom: 16 }}>
                <span className="field__label">Proposed complete contents</span>
                <textarea rows={8} value={editContent} onChange={(event) => setEditContent(event.target.value)} placeholder="Paste the full new contents of the file\u2026" spellCheck={false} className="field" />
              </label>
              <div className="provider__actions" style={{ gap: 10 }}>
                <button className="btn" disabled={!editPath.trim() || !editContent.trim() || studio.patchBusy || !studio.project?.root} onClick={() => void studio.proposePatch(editPath.trim(), editContent)}>
                  {studio.patchBusy ? (
                    <>
                      <Loader2 className="icon icon--sm" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
                      <span>Working\u2026</span>
                    </>
                  ) : (
                    <>
                      <Search className="icon icon--sm" aria-hidden="true" />
                      <span>Preview change</span>
                    </>
                  )}
                </button>
                {!studio.project?.root && <span className="muted">Index a project first.</span>}
              </div>

              {studio.patches.length > 0 && (
                <>
                  <h3 style={{ ...h3Style, marginTop: 32 }}>Changes</h3>
                  {studio.patches.slice(0, 5).map((patch) => (
                    <div key={patch.id} className="card">
                      <div className="card__row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className={patch.status === 'applied' ? 'pill pill--ok' : 'pill'}> {patch.status} </span>
                        <strong>{patch.path}</strong>
                        <span className="muted card__spacer" style={{ fontSize: 11 }}>+{patch.addedLines} / \u2212{patch.removedLines}</span>
                      </div>
                      <pre className="code-out">{patch.diff}</pre>
                      <div className="provider__actions" style={{ marginTop: 12, gap: 8 }}>
                        {patch.status === 'pending' && (
                          <>
                            <button className="btn btn--primary" disabled={studio.patchBusy} onClick={() => void studio.applyPatch(patch.id)}>
                              <CheckCircle className="icon icon--sm" aria-hidden="true" />
                              <span>Apply</span>
                            </button>
                            <button className="btn" disabled={studio.patchBusy} onClick={() => void studio.discardPatch(patch.id)}>
                              <Trash2 className="icon icon--sm" aria-hidden="true" />
                              <span>Discard</span>
                            </button>
                          </>
                        )}
                        {patch.status === 'applied' && (
                          <button className="btn" disabled={studio.patchBusy} onClick={() => void studio.revertPatch(patch.id)}>
                            <RotateCcw className="icon icon--sm" aria-hidden="true" />
                            <span>Revert</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </section>
          )}

          {tab === 'meetings' && (
            <section>
              <h3 style={h3Style}>Record</h3>
              <p className="muted" style={{ margin: '0 0 16px', fontSize: 12, lineHeight: 1.5 }}>
                Audio is transcribed in ~15 second chunks by your configured provider. Everything is stored locally; only the audio needed for transcription leaves the device.
              </p>
              {studio.transcribeError && <div className="notice notice--error" style={{ marginBottom: 16 }}><AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />{studio.transcribeError}</div>}
              {studio.recoveredAt && !studio.recording && (
                <div className="notice notice--warning" style={{ marginBottom: 16 }}>
                  <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
                  Recovered an unsaved transcript from {new Date(studio.recoveredAt).toLocaleString()}. Save it to keep it, or discard it.
                </div>
              )}
              <div className="provider__actions" style={{ gap: 10, flexWrap: 'wrap' }}>
                {studio.recording ? (
                  <button className="btn btn--danger" onClick={() => void studio.stopRecording()}>
                    <StopCircle className="icon icon--sm" aria-hidden="true" />
                    <span>Stop ({clock(studio.seconds)})</span>
                  </button>
                ) : (
                  <button className="btn btn--primary" onClick={() => void studio.startRecording()}>
                    <span className="icon icon--sm" style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', animation: 'blink 1s infinite' }} aria-hidden="true" />
                    <span>Start recording</span>
                  </button>
                )}
                {studio.liveSegments.length > 0 && !studio.recording && (
                  <>
                    <input placeholder="Meeting title" value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} className="field" style={{ minWidth: 200 }} />
                    <button className="btn" disabled={studio.meetingBusy} onClick={() => { void studio.saveMeeting(meetingTitle || 'Untitled meeting'); setMeetingTitle(''); }}>
                      <CheckCircle className="icon icon--sm" aria-hidden="true" />
                      <span>Save transcript</span>
                    </button>
                    <button className="btn btn--ghost" onClick={studio.discardRecording}>
                      <Trash2 className="icon icon--sm" aria-hidden="true" />
                      <span>Discard</span>
                    </button>
                  </>
                )}
              </div>

              {studio.liveSegments.length > 0 && (
                <div className="transcript" style={{ marginTop: 16 }}>
                  {studio.liveSegments.map((segment, index) => (
                    <div key={index} className="transcript__line">
                      <span className="transcript__time">{clock(Math.floor(segment.at / 1000))}</span>
                      <span>{segment.text}</span>
                    </div>
                  ))}
                </div>
              )}

              <h3 style={{ ...h3Style, marginTop: 32 }}>Saved meetings</h3>
              {studio.meetings.length === 0 ? (
                <div className="muted" style={{ padding: '24px', textAlign: 'center' }}>No meetings saved yet.</div>
              ) : (
                studio.meetings.map((meeting) => (
                  <div key={meeting.id} className="card">
                    <div className="card__row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <button className="btn btn--icon btn--icon-sm btn--ghost" onClick={() => setOpenMeeting(openMeeting === meeting.id ? null : meeting.id)} aria-expanded={openMeeting === meeting.id} aria-label="Expand meeting transcript">
                        {openMeeting === meeting.id ? <ChevronUp className="icon icon--sm" aria-hidden="true" /> : <ChevronDown className="icon icon--sm" aria-hidden="true" />}
                      </button>
                      <strong style={{ flex: 1, minWidth: 0 }}>{meeting.title}</strong>
                      <span className="pill">{meeting.segments.length} lines</span>
                      <span className="muted card__spacer" style={{ fontSize: 11 }}>{timeAgo(meeting.createdAt)}</span>
                      <button className="btn btn--sm" disabled={studio.meetingBusy} onClick={() => void studio.summarizeMeeting(meeting.id)}>
                        <Search className="icon icon--xs" aria-hidden="true" />
                        <span>Summarize</span>
                      </button>
                      <button className="btn btn--icon btn--icon-sm btn--ghost conv__delete" aria-label={'Delete meeting ' + meeting.title} onClick={() => void studio.deleteMeeting(meeting.id)}>
                        <Trash2 className="icon icon--xs" aria-hidden="true" />
                      </button>
                    </div>
                    {meeting.summary && <div className="card__text">{meeting.summary}</div>}
                    {meeting.actions.length > 0 && (
                      <ul className="actions" style={{ marginTop: 12 }}>
                        {meeting.actions.map((action, index) => <li key={index}>{action}</li>)}
                      </ul>
                    )}
                    {openMeeting === meeting.id && (
                      <div className="transcript" style={{ marginTop: 12 }}>
                        {meeting.segments.map((segment, index) => (
                          <div key={index} className="transcript__line">
                            <span className="transcript__time">{clock(Math.floor(segment.at / 1000))}</span>
                            <span>{segment.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </section>
          )}

          {tab === 'workflows' && (
            <section>
              <h3 style={h3Style}>Run a workflow</h3>
              <div className="field" style={{ marginBottom: 16 }}>
                <span className="field__label">Input (used as {{input}} \u2014 a repo, a question, notes, or a diff)</span>
                <textarea rows={4} value={studio.workflowInput} onChange={(event) => studio.setWorkflowInput(event.target.value)} className="field" />
              </div>

              {studio.workflowSteps.length > 0 && (
                <div className="workflow-steps" style={{ marginBottom: 24 }}>
                  {studio.workflowSteps.map((step) => (
                    <div key={step.name} className={'workflow-step' + (step.status === 'done' ? ' workflow-step--done' : step.status === 'failed' ? ' workflow-step--failed' : ' workflow-step--running')}>
                      <div className="workflow-step__icon" style={{ color: step.status === 'done' ? 'var(--success)' : step.status === 'failed' ? 'var(--danger)' : 'var(--warning)' }}>
                        {step.status === 'done' ? <CheckCircle className="icon icon--sm" aria-hidden="true" /> : step.status === 'failed' ? <AlertCircle className="icon icon--sm" aria-hidden="true" /> : <span className="icon icon--sm" style={{ animation: 'blink 1s infinite' }} aria-hidden="true">\u25D0</span>}
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
                <div className="provider__actions" style={{ marginBottom: 24 }}>
                  <button className="btn btn--danger" onClick={() => void studio.cancelWorkflow()}>
                    <StopCircle className="icon icon--sm" aria-hidden="true" />
                    <span>Stop run</span>
                  </button>
                </div>
              )}

              {studio.workflowResult && (
                <div style={{ marginTop: 24, padding: 16, background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
                  <h4 style={h4Style}>Result</h4>
                  <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                    {studio.workflowResult.status === 'completed'
                      ? 'Saved to a new chat \u2014 open the sidebar to continue the conversation.'
                      : 'This run ' + studio.workflowResult.status + '. Steps that finished are shown below.'}
                  </p>
                  {studio.workflowResult.steps.map((step) => (
                    <div key={step.name} className="card" style={{ marginBottom: 8 }}>
                      <div className="card__row">
                        <span className={step.ok ? 'pill pill--ok' : 'pill pill--danger'}> {step.ok ? 'ok' : 'failed'} </span>
                        <strong>{step.name}</strong>
                      </div>
                      <pre className="code-out">{step.output}</pre>
                    </div>
                  ))}
                </div>
              )}

              <h3 style={{ ...h3Style, marginTop: 32 }}>Available workflows</h3>
              {studio.workflows.length === 0 ? (
                <div className="empty-content" style={{ padding: '48px 24px', background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xl)' }}>
                  <GitBranch className="empty-content__icon" aria-hidden="true" />
                  <h4 className="empty-content__title">No workflows yet</h4>
                  <p className="empty-content__text">Workflows let you automate multi-step processes. Built-in workflows will appear here, or you can create custom ones.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                  {studio.workflows.map((workflow) => (
                    <div key={workflow.id} className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                      <div className="card__row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <strong style={{ flex: 1 }}>{workflow.name}</strong>
                        {workflow.builtin && <span className="pill"><Zap className="icon icon--xs" aria-hidden="true" />Built-in</span>}
                        <span className="pill" style={{ marginLeft: 8 }}>{workflow.steps.length} step(s)</span>
                        {!workflow.builtin && (
                          <button className="btn btn--icon btn--icon-sm conv__delete" aria-label={'Delete workflow ' + workflow.name} onClick={(e) => { e.stopPropagation(); void studio.deleteWorkflow(workflow.id); }}>
                            <Trash2 className="icon icon--xs" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                      {workflow.description && <div className="card__text muted" style={{ flex: 1 }}>{workflow.description}</div>}
                      <div className="provider__actions" style={{ marginTop: 'auto', paddingTop: 8 }}>
                        <button className="btn btn--primary" disabled={studio.workflowRunning !== null} onClick={() => void studio.runWorkflow(workflow.id)} style={{ width: '100%', padding: 12, fontSize: 14 }}>
                          {studio.workflowRunning === workflow.id ? (
                            <>
                              <Loader2 className="icon icon--sm" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
                              <span>Running\u2026</span>
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

              {studio.workflowRuns.length > 0 && (
                <section style={{ marginTop: 32 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <h3 style={h3Style}>Recent runs</h3>
                    <p className="muted" style={{ margin: 0, fontSize: 12 }}>Runs are recorded on this device so an interrupted run is never left silently in progress.</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {studio.workflowRuns.slice(0, 10).map((run) => (
                      <div key={run.id} className="card" onClick={() => setOpenRun(openRun === run.id ? null : run.id)} style={{ cursor: 'pointer' }}>
                        <div className="card__row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className={run.status === 'completed' ? 'pill pill--ok' : run.status === 'failed' ? 'pill pill--danger' : 'pill'}> {run.status} </span>
                          <strong>{run.workflowName}</strong>
                          <span className="card__spacer" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', fontSize: 11 }}>
                              <Clock className="icon icon--xs" aria-hidden="true" />
                              {new Date(run.finishedAt || run.startedAt).toLocaleString()}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', fontSize: 11 }}>
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
                            {run.error && <div className="card__text" style={{ color: 'var(--danger)', marginTop: 8 }}>{run.error}</div>}
                            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {run.steps.map((step) => (
                                <div key={step.name} className={'workflow-step' + (step.status === 'done' ? ' workflow-step--done' : step.status === 'failed' ? ' workflow-step--failed' : '')} style={{ padding: '8px 10px', background: 'var(--surface-base)', borderRadius: 'var(--radius-md)' }}>
                                  <div className="workflow-step__icon" style={{ color: step.status === 'done' ? 'var(--success)' : step.status === 'failed' ? 'var(--danger)' : 'var(--text-muted)' }}>
                                    {step.status === 'done' ? <CheckCircle className="icon icon--xs" aria-hidden="true" /> : step.status === 'failed' ? <AlertCircle className="icon icon--xs" aria-hidden="true" /> : <span className="icon icon--xs" aria-hidden="true">\u25D0</span>}
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
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

