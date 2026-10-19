import { useState } from 'react'
import type { ActionProposal, MeetingOutput } from '@shared/types'
import { useStudio } from '../hooks/useStudio'
import { useModal } from '../hooks/useModal'
import { timeAgo } from '../lib/format'
import { ChevronDown, ChevronUp, StopCircle, Trash2, FileText, CheckCircle, AlertCircle, Loader2, Search, GitBranch, Zap, X, ExternalLink } from 'lucide-react'
import KlyroMark from '../assets/logo/klyro-mark.svg'

interface Props {
  onClose: () => void
}

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
  const [meetingTitle, setMeetingTitle] = useState('')
  const [openMeeting, setOpenMeeting] = useState<string | null>(null)
  const [planFor, setPlanFor] = useState<string | null>(null)
  const [planTitle, setPlanTitle] = useState('')
  const [planProposals, setPlanProposals] = useState<ActionProposal[]>([])
  const [planChecked, setPlanChecked] = useState<boolean[]>([])
  const [planBusy, setPlanBusy] = useState(false)
  const [planResults, setPlanResults] = useState<MeetingOutput[] | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)

  async function proposePlan(meetingId: string): Promise<void> {
    setPlanResults(null)
    setPlanError(null)
    setPlanBusy(true)
    setPlanFor(meetingId)
    setPlanProposals([])
    setPlanChecked([])
    setPlanTitle('')
    try {
      const { meetingTitle: title, proposals } = await window.klyro.meetingProposeActions(meetingId)
      setPlanTitle(title)
      setPlanProposals(proposals)
      // Only execution-ready items start checked; manual items are reference only.
      setPlanChecked(proposals.map((proposal) => proposal.kind === 'github-issue'))
    } catch (error) {
      setPlanError((error as Error).message)
    } finally {
      setPlanBusy(false)
    }
  }

  function toggleProposal(index: number): void {
    setPlanChecked((previous) => previous.map((checked, i) => (i === index ? !checked : checked)))
  }

  async function executePlan(): Promise<void> {
    if (!planFor) return
    setPlanBusy(true)
    setPlanError(null)
    try {
      const selected = planProposals.filter((_, index) => planChecked[index])
      const results = await window.klyro.meetingExecuteActions({ meetingId: planFor, proposals: selected })
      setPlanResults(results)
      // The ledger lives on the meeting record; refresh so the card stays honest.
      await studio.refreshMeetings()
    } catch (error) {
      setPlanError((error as Error).message)
    } finally {
      setPlanBusy(false)
    }
  }

  return (
    <div className="modal">
      <div className="modal__panel modal__panel--wide" ref={panelRef} role="dialog" aria-modal="true" aria-label="Meetings" tabIndex={-1}>
        <div className="modal__head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={KlyroMark} alt="" style={{ width: 24, height: 24 }} aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Meetings</h2>
          </div>
          <button
            className="btn btn--icon btn--icon-sm btn--ghost"
            aria-label="Close meetings"
            disabled={studio.recording}
            title={studio.recording ? 'Stop the recording first' : undefined}
            onClick={onClose}
          >
            <X className="icon icon--sm" aria-hidden="true" />
          </button>
        </div>

        <div className="modal__body">
          {studio.error && <div className="notice notice--error" style={{ marginBottom: 16 }}><AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />{studio.error}</div>}

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
                    {meeting.actions.length > 0 && (
                      <button className="btn btn--sm" disabled={planBusy} onClick={() => void proposePlan(meeting.id)} aria-label={'Propose work from ' + meeting.title}>
                        <Zap className="icon icon--xs" aria-hidden="true" />
                        <span>Act on it</span>
                      </button>
                    )}
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
                  {(meeting.outputs?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Output ledger</div>
                      {(meeting.outputs ?? []).map((output, index) => (
                        <div key={index} className="card__row" style={{ alignItems: 'center', fontSize: 12, gap: 8 }}>
                          {output.ok ? <CheckCircle className="icon icon--xs" style={{ color: 'var(--success)' }} aria-hidden="true" /> : <AlertCircle className="icon icon--xs" style={{ color: 'var(--danger)' }} aria-hidden="true" />}
                          <span style={{ flex: 1, minWidth: 0 }}>{output.detail}</span>
                          {output.url && <a href={output.url} target="_blank" rel="noreferrer" className="btn btn--icon btn--icon-sm btn--ghost" aria-label="Open created item"><ExternalLink className="icon icon--xs" aria-hidden="true" /></a>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </section>

          {planFor !== null && (
            <div className="modal" role="dialog" aria-modal="true" aria-label="Meeting action plan">
              <div className="modal__panel">
                <div className="modal__head">
                  <h2>Act on “{planTitle}”</h2>
                  <button className="btn btn--icon btn--ghost" onClick={() => setPlanFor(null)} aria-label="Close action plan">
                    <X className="icon" aria-hidden="true" />
                  </button>
                </div>
                <div className="modal__body">
                  {planError && (
                    <div className="notice notice--error" role="alert">
                      <AlertCircle className="icon icon--sm" aria-hidden="true" />
                      <span>{planError}</span>
                    </div>
                  )}
                  {planBusy && planProposals.length === 0 && (
                    <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Loader2 className="icon icon--sm" aria-hidden="true" />
                      <span>Reading the meeting and proposing work…</span>
                    </div>
                  )}
                  {planProposals.length > 0 && (
                    <div>
                      <div className="muted" style={{ marginBottom: 12, fontSize: 12 }}>
                        Review before anything happens. Checked items with a repository are executed (GitHub issues); unchecked and manual items are skipped. Nothing leaves the sheet without approval.
                      </div>
                      {planProposals.map((proposal, index) => (
                        <label key={index} className="card card__row" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 8 }}>
                          <input
                            type="checkbox"
                            checked={planChecked[index] ?? false}
                            onChange={() => toggleProposal(index)}
                            aria-label={'Approve: ' + proposal.title}
                            style={{ marginTop: 4 }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              {proposal.kind === 'github-issue' ? <GitBranch className="icon icon--xs" aria-hidden="true" /> : <FileText className="icon icon--xs" aria-hidden="true" />}
                              <strong>{proposal.title}</strong>
                              {proposal.repo && <span className="pill">{proposal.repo}</span>}
                              <span className="pill">{proposal.kind === 'github-issue' ? 'GitHub issue' : 'Manual'}</span>
                            </div>
                            {proposal.reason && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{proposal.reason}</div>}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                  {planResults && (
                    <div>
                      <h4 style={h4Style}>Ledger</h4>
                      {planResults.map((result, index) => (
                        <div key={index} className="card__row" style={{ alignItems: 'center', fontSize: 12, gap: 8 }}>
                          {result.ok ? <CheckCircle className="icon icon--xs" style={{ color: 'var(--success)' }} aria-hidden="true" /> : <AlertCircle className="icon icon--xs" style={{ color: 'var(--danger)' }} aria-hidden="true" />}
                          <span style={{ flex: 1, minWidth: 0 }}>{result.detail}</span>
                        </div>
                      ))}
                      {planResults.length === 0 && <div className="muted">Nothing executed — no approved GitHub proposals.</div>}
                    </div>
                  )}
                </div>
                <div className="modal__head" style={{ borderTop: '1px solid var(--border-subtle)', borderBottom: 'none' }}>
                  <button className="btn" onClick={() => setPlanFor(null)}>Close</button>
                  <button className="btn btn--primary" disabled={planBusy || planProposals.length === 0 || planChecked.every((checked) => !checked)} onClick={() => void executePlan()}>
                    {planBusy ? <Loader2 className="icon icon--xs" aria-hidden="true" /> : <Zap className="icon icon--xs" aria-hidden="true" />}
                    <span>{planBusy ? 'Executing…' : 'Run approved items'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
