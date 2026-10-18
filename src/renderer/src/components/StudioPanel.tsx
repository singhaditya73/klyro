import { useState } from 'react'
import type { CodeActionKind } from '@shared/types'
import type { StudioController } from '../hooks/useStudio'
import { timeAgo } from '../lib/format'

interface Props {
  studio: StudioController
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

export function StudioPanel({ studio, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('code')
  const [snippet, setSnippet] = useState('')
  const [question, setQuestion] = useState('')
  const [meetingTitle, setMeetingTitle] = useState('')
  const [openMeeting, setOpenMeeting] = useState<string | null>(null)

  return (
    <div className="modal">
      <div className="modal__panel modal__panel--wide">
        <div className="modal__head">
          <h2>Studio</h2>
          <button className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="tabs">
          <button className={`tab${tab === 'code' ? ' tab--active' : ''}`} onClick={() => setTab('code')}>
            Coding
          </button>
          <button className={`tab${tab === 'meetings' ? ' tab--active' : ''}`} onClick={() => setTab('meetings')}>
            Meetings ({studio.meetings.length})
          </button>
          <button className={`tab${tab === 'workflows' ? ' tab--active' : ''}`} onClick={() => setTab('workflows')}>
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
              {studio.codeOutput ? <pre className="code-out">{studio.codeOutput}</pre> : null}
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
                    <button className="conv__delete" onClick={() => void studio.deleteMeeting(meeting.id)}>
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
                      <button className="conv__delete" onClick={() => void studio.deleteWorkflow(workflow.id)}>
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

              {studio.workflowResult ? (
                <>
                  <h3>Result</h3>
                  <div className="muted">
                    Saved to a new chat — open the sidebar to continue the conversation.
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
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
