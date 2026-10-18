import { useState } from 'react'
import type { CodeActionKind } from '@shared/types'
import { useStudio } from '../hooks/useStudio'
import { useModal } from '../hooks/useModal'
import { timeAgo } from '../lib/format'

interface Props {
  onClose: () => void
}

type Tab = 'code' | 'meetings' | 'workflows'

const CODE_ACTIONS: { kind: CodeActionKind; label: string }[] = [
  { kind: 'explain', label: 'Explain' },
  { kind: 'bugs', label: 'Find bugs' },
  { kind: 'tests', label: 'Write tests' },
  { kind: 'refactor', label: 'Refactor' },
  { kind: 'docs', label: 'Document' }
]

function clock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

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

  return (
    <div className="modal">
      <div className="modal__panel modal__panel--wide" ref={panelRef} role="dialog" aria-modal="true" aria-label="Studio" tabIndex={-1}>
        <div className="modal__head">
          <h2>Studio</h2>
          <button
            className="btn btn--ghost"
            aria-label="Close Studio"
            disabled={studio.recording}
            title={studio.recording ? 'Stop the recording first' : undefined}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="tabs" role="tablist">
          <button
            className={`tab${tab === 'code' ? ' tab--active' : ''}`}
            role="tab"
            aria-selected={tab === 'code'}
            onClick={() => setTab('code')}
          >
            Coding
          </button>
          <button
            className={`tab${tab === 'meetings' ? ' tab--active' : ''}`}
            role="tab"
            aria-selected={tab === 'meetings'}
            onClick={() => setTab('meetings')}
          >
            Meetings ({studio.meetings.length})
          </button>
          <button
            className={`tab${tab === 'workflows' ? ' tab--active' : ''}`}
            role="tab"
            aria-selected={tab === 'workflows'}
            onClick={() => setTab('workflows')}
          >
            Workflows ({studio.workflows.length})
          </button>
        </div>

        <div className="modal__body">
          {studio.error ? <div className="agent__warning">{studio.error}</div> : null}

          {tab === 'code' ? (
            <section>
              <h3>Project index</h3>
              {studio.project?.root ? (
                <div className="permissions">
                  <div>
                    <strong>{studio.project.root}</strong>
                  </div>
                  <div className="muted">
                    {studio.project.files} files · {studio.project.chunks} chunks
                    {studio.project.skipped ? ` · ${studio.project.skipped} skipped` : ''}
                    {studio.project.indexedAt ? ` · indexed ${timeAgo(studio.project.indexedAt)}` : ''}
                  </div>
                  <div className="provider__actions">
                    <button className="btn" onClick={() => void studio.indexProject()}>
                      Re-index
                    </button>
                    <button className="btn btn--ghost" onClick={() => void studio.clearProject()}>
                      Forget project
                    </button>
                  </div>
                  <div className="muted">
                    Indexed files ground code answers, workflow prompts, and normal chat.
                  </div>
                  {studio.project.lastScan ? (
                    <div className="muted">
                      Last scan: {studio.project.lastScan.added} added · {studio.project.lastScan.updated} updated ·{' '}
                      {studio.project.lastScan.reused} unchanged · {studio.project.lastScan.removed} removed
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="provider__actions">
                  <button className="btn btn--primary" disabled={studio.indexing} onClick={() => void studio.indexProject()}>
                    {studio.indexing ? 'Indexing…' : 'Index a project folder…'}
                  </button>
                  <span className="muted">Nothing indexed yet.</span>
                </div>
              )}

              <h3>Ask about code</h3>
              <label className="field">
                Paste a snippet
                <textarea
                  rows={8}
                  value={snippet}
                  onChange={(event) => setSnippet(event.target.value)}
                  placeholder="Paste the function, file, or diff you want help with…"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                Optional question or context
                <input value={question} onChange={(event) => setQuestion(event.target.value)} />
              </label>
              <div className="provider__actions">
                {CODE_ACTIONS.map((action) => (
                  <button
                    key={action.kind}
                    className="btn"
                    disabled={!snippet.trim() || studio.codeBusy}
                    onClick={() => void studio.runCodeAction(action.kind, snippet, question || undefined)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>

              {studio.codeBusy ? <div className="muted">Thinking…</div> : null}
              {studio.codeCitations.length > 0 ? (
                <div className="muted">
                  Used:{' '}
                  {studio.codeCitations
                    .map(
                      (citation) =>
                        `${citation.name}${
                          citation.line > 0
                            ? `:${citation.line}${citation.endLine && citation.endLine > citation.line ? `-${citation.endLine}` : ''}`
                            : ''
                        }`
                    )
                    .join(', ')}
                </div>
              ) : null}
              {studio.codeOutput ? <pre className="code-out">{studio.codeOutput}</pre> : null}

              <h3>Edit a project file</h3>
              <p className="muted">
                Klyro never writes a file on its own: it shows you the exact diff and waits. A backup is kept so every
                applied change can be reverted.
              </p>
              <label className="field">
                File path (relative to the indexed project)
                <input
                  value={editPath}
                  onChange={(event) => setEditPath(event.target.value)}
                  placeholder="src/main/index.ts"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                Proposed complete contents
                <textarea
                  rows={8}
                  value={editContent}
                  onChange={(event) => setEditContent(event.target.value)}
                  placeholder="Paste the full new contents of the file…"
                  spellCheck={false}
                />
              </label>
              <div className="provider__actions">
                <button
                  className="btn"
                  disabled={!editPath.trim() || !editContent.trim() || studio.patchBusy || !studio.project?.root}
                  onClick={() => void studio.proposePatch(editPath.trim(), editContent)}
                >
                  {studio.patchBusy ? 'Working…' : 'Preview change'}
                </button>
                {!studio.project?.root ? <span className="muted">Index a project first.</span> : null}
              </div>

              {studio.patches.length > 0 ? (
                <>
                  <h3>Changes</h3>
                  {studio.patches.slice(0, 5).map((patch) => (
                    <div key={patch.id} className="card">
                      <div className="card__row">
                        <span className={`pill${patch.status === 'applied' ? ' pill--ok' : ''}`}>{patch.status}</span>
                        <strong>{patch.path}</strong>
                        <span className="muted card__spacer">
                          +{patch.addedLines} / −{patch.removedLines}
                        </span>
                      </div>
                      <pre className="code-out">{patch.diff}</pre>
                      <div className="provider__actions">
                        {patch.status === 'pending' ? (
                          <>
                            <button className="btn btn--primary" disabled={studio.patchBusy} onClick={() => void studio.applyPatch(patch.id)}>
                              Apply
                            </button>
                            <button className="btn" disabled={studio.patchBusy} onClick={() => void studio.discardPatch(patch.id)}>
                              Discard
                            </button>
                          </>
                        ) : null}
                        {patch.status === 'applied' ? (
                          <button className="btn" disabled={studio.patchBusy} onClick={() => void studio.revertPatch(patch.id)}>
                            Revert
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </>
              ) : null}
            </section>
          ) : null}

          {tab === 'meetings' ? (
            <section>
              <h3>Record</h3>
              <p className="muted">
                Audio is transcribed in ~15 second chunks by your configured provider. Everything is stored locally;
                only the audio needed for transcription leaves the device.
              </p>
              {studio.transcribeError ? <div className="agent__warning">{studio.transcribeError}</div> : null}
              {studio.recoveredAt && !studio.recording ? (
                <div className="agent__warning">
                  Recovered an unsaved transcript from {new Date(studio.recoveredAt).toLocaleString()}. Save it to keep it, or
                  discard it.
                </div>
              ) : null}
              <div className="provider__actions">
                {studio.recording ? (
                  <button className="btn btn--danger" onClick={() => void studio.stopRecording()}>
                    Stop ({clock(studio.seconds)})
                  </button>
                ) : (
                  <button className="btn btn--primary" onClick={() => void studio.startRecording()}>
                    ● Start recording
                  </button>
                )}
                {studio.liveSegments.length > 0 && !studio.recording ? (
                  <>
                    <input
                      placeholder="Meeting title"
                      value={meetingTitle}
                      onChange={(event) => setMeetingTitle(event.target.value)}
                    />
                    <button
                      className="btn"
                      disabled={studio.meetingBusy}
                      onClick={() => {
                        void studio.saveMeeting(meetingTitle || 'Untitled meeting')
                        setMeetingTitle('')
                      }}
                    >
                      Save transcript
                    </button>
                    <button className="btn btn--ghost" onClick={studio.discardRecording}>
                      Discard
                    </button>
                  </>
                ) : null}
              </div>

              {studio.liveSegments.length > 0 ? (
                <div className="transcript">
                  {studio.liveSegments.map((segment, index) => (
                    <div key={index} className="transcript__line">
                      <span className="transcript__time">{clock(Math.floor(segment.at / 1000))}</span>
                      <span>{segment.text}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <h3>Saved meetings</h3>
              {studio.meetings.length === 0 ? <div className="muted">No meetings saved yet.</div> : null}
              {studio.meetings.map((meeting) => (
                <div key={meeting.id} className="card">
                  <div className="card__row">
                    <button className="btn btn--ghost" onClick={() => setOpenMeeting(openMeeting === meeting.id ? null : meeting.id)}>
                      {openMeeting === meeting.id ? '▾' : '▸'}
                    </button>
                    <strong>{meeting.title}</strong>
                    <span className="pill">{meeting.segments.length} lines</span>
                    <span className="muted card__spacer">{timeAgo(meeting.createdAt)}</span>
                    <button className="btn" disabled={studio.meetingBusy} onClick={() => void studio.summarizeMeeting(meeting.id)}>
                      Summarize
                    </button>
                    <button
                      className="conv__delete"
                      aria-label={`Delete meeting ${meeting.title}`}
                      onClick={() => void studio.deleteMeeting(meeting.id)}
                    >
                      ×
                    </button>
                  </div>
                  {meeting.summary ? <div className="card__text">{meeting.summary}</div> : null}
                  {meeting.actions.length > 0 ? (
                    <ul className="actions">
                      {meeting.actions.map((action, index) => (
                        <li key={index}>{action}</li>
                      ))}
                    </ul>
                  ) : null}
                  {openMeeting === meeting.id ? (
                    <div className="transcript">
                      {meeting.segments.map((segment, index) => (
                        <div key={index} className="transcript__line">
                          <span className="transcript__time">{clock(Math.floor(segment.at / 1000))}</span>
                          <span>{segment.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </section>
          ) : null}

          {tab === 'workflows' ? (
            <section>
              <h3>Run a workflow</h3>
              <label className="field">
                Input (used as {'{{input}}'} — a repo, a question, notes, or a diff)
                <textarea rows={4} value={studio.workflowInput} onChange={(event) => studio.setWorkflowInput(event.target.value)} />
              </label>

              {studio.workflowSteps.length > 0 ? (
                <div className="agent__steps">
                  {studio.workflowSteps.map((step) => (
                    <div key={step.name} className={`step step--${step.status === 'done' ? 'executed' : step.status === 'failed' ? 'failed' : 'executing'}`}>
                      <span className="step__icon">
                        {step.status === 'done' ? '●' : step.status === 'failed' ? '✗' : '◐'}
                      </span>
                      <div className="step__body">
                        <div className="step__title">{step.name}</div>
                        {step.detail ? <div className="step__detail">{step.detail}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {studio.workflows.map((workflow) => (
                <div key={workflow.id} className="card">
                  <div className="card__row">
                    <strong>{workflow.name}</strong>
                    {workflow.builtin ? <span className="pill">built-in</span> : null}
                    <span className="muted card__spacer">{workflow.steps.length} step(s)</span>
                    {!workflow.builtin ? (
                      <button
                        className="conv__delete"
                        aria-label={`Delete workflow ${workflow.name}`}
                        onClick={() => void studio.deleteWorkflow(workflow.id)}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                  {workflow.description ? <div className="card__text muted">{workflow.description}</div> : null}
                  <div className="provider__actions">
                    <button
                      className="btn btn--primary"
                      disabled={studio.workflowRunning !== null}
                      onClick={() => void studio.runWorkflow(workflow.id)}
                    >
                      {studio.workflowRunning === workflow.id ? 'Running…' : 'Run'}
                    </button>
                  </div>
                </div>
              ))}

              {studio.workflowRunning !== null ? (
                <div className="provider__actions">
                  <button className="btn" onClick={() => void studio.cancelWorkflow()}>
                    Stop run
                  </button>
                </div>
              ) : null}

              {studio.workflowResult ? (
                <>
                  <h3>Result</h3>
                  <div className="muted">
                    {studio.workflowResult.status === 'completed'
                      ? 'Saved to a new chat — open the sidebar to continue the conversation.'
                      : `This run ${studio.workflowResult.status}. Steps that finished are shown below.`}
                  </div>
                  {studio.workflowResult.steps.map((step) => (
                    <div key={step.name} className="card">
                      <div className="card__row">
                        <span className={`pill${step.ok ? ' pill--ok' : ''}`}>{step.ok ? 'ok' : 'failed'}</span>
                        <strong>{step.name}</strong>
                      </div>
                      <pre className="code-out">{step.output}</pre>
                    </div>
                  ))}
                </>
              ) : null}

              {studio.workflowRuns.length > 0 ? (
                <>
                  <h3>Recent runs</h3>
                  <div className="muted">
                    Runs are recorded on this device so an interrupted run is never left silently in progress.
                  </div>
                  {studio.workflowRuns.slice(0, 5).map((run) => (
                    <div key={run.id} className="card">
                      <div className="card__row">
                        <span className={`pill${run.status === 'completed' ? ' pill--ok' : ''}`}>{run.status}</span>
                        <strong>{run.workflowName}</strong>
                        <span className="muted card__spacer">
                          {new Date(run.finishedAt || run.startedAt).toLocaleString()} · {run.steps.filter((step) => step.status === 'done').length}/
                          {run.steps.length} steps
                        </span>
                      </div>
                      {run.error ? <div className="card__text muted">{run.error}</div> : null}
                    </div>
                  ))}
                </>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
