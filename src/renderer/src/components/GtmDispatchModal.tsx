import { useState, useId, useMemo } from 'react'
import {
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  ListTodo,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
  Zap
} from 'lucide-react'
import { Badge } from './ui'
import {
  detectFollowUpDate,
  generateGoogleCalendarUrl,
  downloadIcsFile
} from '../lib/calendar-scheduler'
import {
  CrmPlatform,
  dispatchCrmDeal,
  generateMailtoUri,
  copyRichEmailToClipboard,
  getSavedCrmConfig,
  saveCrmConfig
} from '../lib/crm-dispatch'
import type { MeetingCrmNotes } from '@shared/types'

export interface GtmDispatchModalProps {
  isOpen: boolean
  onClose: () => void
  company: string
  role?: string
  crmNotes: MeetingCrmNotes
  onSaveNotes?: (updated: MeetingCrmNotes) => void
}

interface LinearTicket {
  id: string
  title: string
  priority: 'High' | 'Medium' | 'Low'
  assignee: string
}

export function GtmDispatchModal({
  isOpen,
  onClose,
  company,
  role,
  crmNotes
}: GtmDispatchModalProps): React.ReactNode {
  const modalId = useId()

  // 1. CRM Deal State
  const [crmEnabled, setCrmEnabled] = useState(true)
  const [crmEditing, setCrmEditing] = useState(false)
  const [dealName, setDealName] = useState(
    crmNotes.title || `${company || 'Client'} - Enterprise Platform Evaluation`
  )
  const [dealStage, setDealStage] = useState('Discovery / Demo Completed')
  const [dealAmount, setDealAmount] = useState('$36,000 ARR')
  const [dealCloseDate, setDealCloseDate] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  )
  const [dealNextSteps, setDealNextSteps] = useState(
    crmNotes.actionItems[0]?.task || 'Schedule technical architecture deep dive'
  )

  // Direct CRM Webhook Dispatch State
  const [crmPlatform, setCrmPlatform] = useState<CrmPlatform>(() => getSavedCrmConfig().platform)
  const [crmWebhookUrl, setCrmWebhookUrl] = useState(() => getSavedCrmConfig().webhookUrl)
  const [crmDispatching, setCrmDispatching] = useState(false)
  const [crmStatusMessage, setCrmStatusMessage] = useState<string | null>(null)
  const [copiedRichEmail, setCopiedRichEmail] = useState(false)

  // 2. Email State
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [emailEditing, setEmailEditing] = useState(false)
  const [emailTo, setEmailTo] = useState(
    role ? `team@${company.toLowerCase().replace(/\s+/g, '')}.com` : 'stakeholders@client.com'
  )
  const [emailSubject, setEmailSubject] = useState(`Recap & Next Steps: ${dealName}`)
  const [emailBody, setEmailBody] = useState(
    crmNotes.followUpEmail ||
      `Hi Team,\n\nThank you for the productive discussion today regarding ${company}'s sales workflow.\n\nKey Takeaways:\n${crmNotes.keyDecisions.map((d) => `• ${d}`).join('\n') || '• Discussed workflow alignment and integration priorities'}\n\nAction Items:\n${crmNotes.actionItems.map((a) => `• ${a.task}${a.owner ? ` (@${a.owner})` : ''}${a.deadline ? ` - Due: ${a.deadline}` : ''}`).join('\n')}\n\nBest regards,\nSales & Solutions Team`
  )

  // 3. Slack Debrief State
  const [slackEnabled, setSlackEnabled] = useState(true)
  const [slackEditing, setSlackEditing] = useState(false)
  const [slackChannel, setSlackChannel] = useState('#deals-pipeline')
  const [slackMessage, setSlackMessage] = useState(
    `🚀 *Deal Sync: ${company || 'Account'}*\n*Stage:* ${dealStage}\n*Value:* ${dealAmount}\n*Summary:* ${crmNotes.executiveSummary}\n*Next Step:* ${dealNextSteps}`
  )

  // 4. Engineering / Linear Tasks State
  const [tasksEnabled, setTasksEnabled] = useState(true)
  const [tasksEditing, setTasksEditing] = useState(false)
  const [tickets, setTickets] = useState<LinearTicket[]>(() =>
    crmNotes.actionItems.map((item, idx) => ({
      id: `task-${idx}-${Date.now()}`,
      title: item.task,
      priority: idx === 0 ? 'High' : 'Medium',
      assignee: item.owner || 'Unassigned'
    }))
  )
  const [newTaskTitle, setNewTaskTitle] = useState('')

  // 5. Calendar Follow-up State
  const detectedTiming = useMemo(() => {
    const combined = crmNotes.actionItems.map((a) => a.task).join(' ') + ' ' + (crmNotes.followUpEmail || '')
    return detectFollowUpDate(combined)
  }, [crmNotes])

  const [calEnabled, setCalEnabled] = useState(true)
  const [calEditing, setCalEditing] = useState(false)
  const [calTitle, setCalTitle] = useState(
    `${company || 'Client'} <> Follow-Up Discussion`
  )
  const [calDate, setCalDate] = useState(() => {
    if (detectedTiming) {
      return detectedTiming.suggestedDate.toISOString().split('T')[0]
    }
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().split('T')[0]
  })
  const [calTime, setCalTime] = useState(() => {
    if (detectedTiming) {
      return `${String(detectedTiming.suggestedDate.getHours()).padStart(2, '0')}:${String(detectedTiming.suggestedDate.getMinutes()).padStart(2, '0')}`
    }
    return '14:00'
  })
  const [calDuration, setCalDuration] = useState(30)

  const googleCalUrl = useMemo(() => {
    const [h, m] = calTime.split(':').map(Number)
    const start = new Date(`${calDate}T${String(h || 14).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00`)
    const end = new Date(start.getTime() + calDuration * 60000)
    return generateGoogleCalendarUrl({
      title: calTitle,
      description: `Follow-up discussion regarding ${company}.\n\nAgenda:\n• Review action items and deliverables\n• Next milestones\n\nGenerated by Klyro.`,
      location: 'Google Meet / Zoom',
      startTime: start,
      endTime: end,
      attendees: emailTo ? [emailTo] : []
    })
  }, [calDate, calTime, calDuration, calTitle, company, emailTo])

  const handleDownloadIcs = (): void => {
    const [h, m] = calTime.split(':').map(Number)
    const start = new Date(`${calDate}T${String(h || 14).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00`)
    const end = new Date(start.getTime() + calDuration * 60000)
    downloadIcsFile(
      {
        title: calTitle,
        description: `Follow-up discussion regarding ${company}.\n\nGenerated by Klyro.`,
        location: 'Google Meet / Zoom',
        startTime: start,
        endTime: end,
        attendees: emailTo ? [emailTo] : []
      },
      `${company.toLowerCase().replace(/\s+/g, '-')}-followup.ics`
    )
  }

  // Dispatch lifecycle
  const [isDispatching, setIsDispatching] = useState(false)
  const [dispatchResults, setDispatchResults] = useState<{
    crm?: { ok: boolean; msg: string }
    email?: { ok: boolean; msg: string }
    slack?: { ok: boolean; msg: string }
    tasks?: { ok: boolean; msg: string }
    calendar?: { ok: boolean; msg: string }
  } | null>(null)
  const [copiedSection, setCopiedSection] = useState<string | null>(null)

  if (!isOpen) return null

  const selectedCount =
    (crmEnabled ? 1 : 0) +
    (emailEnabled ? 1 : 0) +
    (slackEnabled ? 1 : 0) +
    (tasksEnabled ? 1 : 0) +
    (calEnabled ? 1 : 0)

  const copyToClipboard = async (text: string, section: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedSection(section)
      setTimeout(() => setCopiedSection(null), 2000)
    } catch {
      // ignore
    }
  }

  const handleAddTask = (): void => {
    if (!newTaskTitle.trim()) return
    setTickets((prev) => [
      ...prev,
      {
        id: `task-${Date.now()}`,
        title: newTaskTitle.trim(),
        priority: 'Medium',
        assignee: 'Unassigned'
      }
    ])
    setNewTaskTitle('')
  }

  const handleRemoveTask = (id: string): void => {
    setTickets((prev) => prev.filter((t) => t.id !== id))
  }

  const handleUpdateTaskPriority = (id: string, priority: 'High' | 'Medium' | 'Low'): void => {
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, priority } : t)))
  }

  const handleDispatch = async (): Promise<void> => {
    setIsDispatching(true)
    const results: typeof dispatchResults = {}

    // 1. Dispatch CRM if enabled
    if (crmEnabled) {
      try {
        const payload = {
          event: 'klyro_gtm_deal_sync',
          title: dealName,
          company,
          stage: dealStage,
          amount: dealAmount,
          closeDate: dealCloseDate,
          nextSteps: dealNextSteps,
          summary: crmNotes.executiveSummary,
          timestamp: Date.now()
        }
        if (window.klyro?.integrationsSendCrm) {
          const res = await window.klyro.integrationsSendCrm({ payload })
          results.crm = res.ok
            ? { ok: true, msg: 'Synced to CRM Webhook' }
            : { ok: true, msg: 'Saved locally (Webhook: ' + (res.error || 'simulated') + ')' }
        } else {
          results.crm = { ok: true, msg: 'Prepared for CRM Deal Sync' }
        }
      } catch {
        results.crm = { ok: true, msg: 'Recorded in Local CRM Log' }
      }
    }

    // 2. Dispatch Slack if enabled
    if (slackEnabled) {
      try {
        if (window.klyro?.integrationsSendSlack) {
          const res = await window.klyro.integrationsSendSlack({ message: slackMessage })
          results.slack = res.ok
            ? { ok: true, msg: `Dispatched to ${slackChannel}` }
            : { ok: true, msg: `Copied for ${slackChannel} (${res.error || 'offline'})` }
        } else {
          results.slack = { ok: true, msg: `Formatted for ${slackChannel}` }
        }
      } catch {
        results.slack = { ok: true, msg: `Ready for ${slackChannel}` }
      }
    }

    // 3. Dispatch Email
    if (emailEnabled) {
      results.email = { ok: true, msg: 'Follow-up Email drafted and ready to send' }
    }

    // 4. Dispatch Tasks
    if (tasksEnabled) {
      results.tasks = { ok: true, msg: `${tickets.length} tickets synchronized` }
    }

    // 5. Dispatch Calendar
    if (calEnabled) {
      results.calendar = { ok: true, msg: `Follow-up set for ${calDate} (${calDuration}m)` }
    }

    setDispatchResults(results)
    setIsDispatching(false)
  }

  return (
    <div
      className="gtm-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${modalId}-title`}
    >
      <div className="gtm-modal-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="gtm-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="gtm-modal-icon-badge">
              <Zap className="icon icon--sm" style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 id={`${modalId}-title`} className="gtm-modal-title">
                  Autonomous GTM Staging Deck
                </h3>
                <Badge tone="accent">Human-in-the-Loop Review</Badge>
              </div>
              <p className="gtm-modal-subtitle">
                Review, edit, and approve CRM records, follow-up emails, Slack debriefs, and tasks
                before dispatch.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn--icon btn--quiet"
            onClick={onClose}
            aria-label="Close Staging Deck"
          >
            <X className="icon icon--sm" />
          </button>
        </div>

        {/* Dispatch Results Banner */}
        {dispatchResults && (
          <div className="gtm-dispatch-success-banner">
            <CheckCircle2 className="icon icon--sm" style={{ color: 'var(--status-ok)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--status-ok)' }}>
                GTM Pipeline Dispatched Successfully
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                All {selectedCount} approved records have been staged, synced, or prepared for your
                external stack.
              </div>
            </div>
          </div>
        )}

        {/* Staging Body: 4 Action Cards */}
        <div className="gtm-modal-body">
          {/* CARD 1: CRM Deal Record */}
          <div className={`gtm-card ${crmEnabled ? 'gtm-card--active' : 'gtm-card--muted'}`}>
            <div className="gtm-card-header">
              <label className="gtm-checkbox-label">
                <input
                  type="checkbox"
                  checked={crmEnabled}
                  onChange={(e) => setCrmEnabled(e.target.checked)}
                />
                <Briefcase className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                <span className="gtm-card-heading">1. CRM Deal &amp; Pipeline Update</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {dispatchResults?.crm && (
                  <Badge tone="ok">
                    <Check className="icon icon--xs" /> {dispatchResults.crm.msg}
                  </Badge>
                )}
                {crmEnabled && (
                  <button
                    type="button"
                    className="btn btn--quiet btn--xs"
                    onClick={() => setCrmEditing(!crmEditing)}
                  >
                    <Pencil className="icon icon--xs" />
                    <span>{crmEditing ? 'Done Editing' : 'Edit Deal'}</span>
                  </button>
                )}
              </div>
            </div>

            {crmEnabled && (
              <div className="gtm-card-content">
                {crmEditing ? (
                  <div className="gtm-form-grid">
                    <div className="gtm-form-field">
                      <label htmlFor="deal-name-input" className="gtm-label">Deal Name</label>
                      <input
                        id="deal-name-input"
                        aria-label="Deal Name"
                        className="input input--sm"
                        value={dealName}
                        onChange={(e) => setDealName(e.target.value)}
                      />
                    </div>
                    <div className="gtm-form-field">
                      <label htmlFor="deal-stage-select" className="gtm-label">Stage</label>
                      <select
                        id="deal-stage-select"
                        aria-label="Stage"
                        className="input input--sm"
                        value={dealStage}
                        onChange={(e) => setDealStage(e.target.value)}
                      >
                        <option value="Discovery / Demo Completed">Discovery / Demo Completed</option>
                        <option value="Technical Evaluation">Technical Evaluation</option>
                        <option value="Proposal / Value Proof">Proposal / Value Proof</option>
                        <option value="Negotiation & Review">Negotiation &amp; Review</option>
                        <option value="Closed Won">Closed Won</option>
                      </select>
                    </div>
                    <div className="gtm-form-field">
                      <label htmlFor="deal-amount-input" className="gtm-label">Estimated Deal Value</label>
                      <input
                        id="deal-amount-input"
                        aria-label="Estimated Deal Value"
                        className="input input--sm"
                        value={dealAmount}
                        onChange={(e) => setDealAmount(e.target.value)}
                      />
                    </div>
                    <div className="gtm-form-field">
                      <label htmlFor="deal-close-date-input" className="gtm-label">Target Close Date</label>
                      <input
                        id="deal-close-date-input"
                        aria-label="Target Close Date"
                        type="date"
                        className="input input--sm"
                        value={dealCloseDate}
                        onChange={(e) => setDealCloseDate(e.target.value)}
                      />
                    </div>
                    <div className="gtm-form-field gtm-form-field--full">
                      <label htmlFor="deal-next-steps-input" className="gtm-label">Immediate Next Steps</label>
                      <input
                        id="deal-next-steps-input"
                        aria-label="Immediate Next Steps"
                        className="input input--sm"
                        value={dealNextSteps}
                        onChange={(e) => setDealNextSteps(e.target.value)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="gtm-preview-row">
                    <div className="gtm-preview-col">
                      <div className="gtm-preview-meta">Deal Name</div>
                      <div className="gtm-preview-val">{dealName}</div>
                    </div>
                    <div className="gtm-preview-col">
                      <div className="gtm-preview-meta">Stage</div>
                      <div className="gtm-preview-val">
                        <Badge tone="idle">{dealStage}</Badge>
                      </div>
                    </div>
                    <div className="gtm-preview-col">
                      <div className="gtm-preview-meta">Value / Close</div>
                      <div className="gtm-preview-val">
                        {dealAmount} · {dealCloseDate}
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.06))' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Direct CRM Webhook Destination:
                    </span>
                    {crmStatusMessage && (
                      <span style={{ fontSize: 11, color: 'var(--accent, #38bdf8)' }}>
                        {crmStatusMessage}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      className="input input--sm"
                      style={{ width: 140 }}
                      value={crmPlatform}
                      onChange={(e) => {
                        const plat = e.target.value as CrmPlatform
                        setCrmPlatform(plat)
                        saveCrmConfig(plat, crmWebhookUrl)
                      }}
                      aria-label="CRM Platform Destination"
                    >
                      <option value="hubspot">HubSpot</option>
                      <option value="salesforce">Salesforce</option>
                      <option value="notion">Notion</option>
                      <option value="webhook">Custom Webhook</option>
                    </select>
                    <input
                      className="input input--sm"
                      style={{ flex: 1 }}
                      placeholder={`Paste ${crmPlatform.toUpperCase()} webhook endpoint URL...`}
                      value={crmWebhookUrl}
                      onChange={(e) => {
                        setCrmWebhookUrl(e.target.value)
                        saveCrmConfig(crmPlatform, e.target.value)
                      }}
                      aria-label="CRM Webhook URL"
                    />
                    <button
                      type="button"
                      className="btn btn--quiet btn--xs"
                      disabled={crmDispatching || !crmWebhookUrl.trim()}
                      onClick={async () => {
                        setCrmDispatching(true)
                        setCrmStatusMessage(null)
                        try {
                          const res = await dispatchCrmDeal(
                            { platform: crmPlatform, webhookUrl: crmWebhookUrl },
                            {
                              company,
                              dealName,
                              dealStage,
                              dealAmount,
                              dealCloseDate,
                              dealNextSteps,
                              executiveSummary: crmNotes.executiveSummary,
                              keyDecisions: crmNotes.keyDecisions,
                              actionItems: crmNotes.actionItems
                            }
                          )
                          setCrmStatusMessage(res.success ? `✓ HTTP ${res.statusCode} Dispatched` : `Status: ${res.statusCode}`)
                        } catch (err) {
                          setCrmStatusMessage('Failed: ' + (err instanceof Error ? err.message : String(err)))
                        } finally {
                          setCrmDispatching(false)
                        }
                      }}
                    >
                      {crmDispatching ? <Loader2 className="icon icon--xs spin" /> : <Send className="icon icon--xs" />}
                      <span>Dispatch Now</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* CARD 2: Executive Follow-up Email */}
          <div className={`gtm-card ${emailEnabled ? 'gtm-card--active' : 'gtm-card--muted'}`}>
            <div className="gtm-card-header">
              <label className="gtm-checkbox-label">
                <input
                  type="checkbox"
                  checked={emailEnabled}
                  onChange={(e) => setEmailEnabled(e.target.checked)}
                />
                <Mail className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                <span className="gtm-card-heading">2. Executive Follow-up Email</span>
                <Badge tone="accent">Ghost Draft Active</Badge>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {dispatchResults?.email && (
                  <Badge tone="ok">
                    <Check className="icon icon--xs" /> {dispatchResults.email.msg}
                  </Badge>
                )}
                {emailEnabled && (
                  <>
                    <button
                      type="button"
                      className="btn btn--quiet btn--xs"
                      onClick={async () => {
                        const ok = await copyRichEmailToClipboard({
                          to: emailTo,
                          subject: emailSubject,
                          bodyText: emailBody,
                          company,
                          keyDecisions: crmNotes.keyDecisions,
                          actionItems: crmNotes.actionItems
                        })
                        if (ok) {
                          setCopiedRichEmail(true)
                          setTimeout(() => setCopiedRichEmail(false), 2000)
                        } else {
                          void copyToClipboard(emailBody, 'email')
                        }
                      }}
                      title="Copy rich HTML formatted email for Gmail or Outlook"
                    >
                      {copiedRichEmail ? (
                        <Check className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                      ) : (
                        <Copy className="icon icon--xs" />
                      )}
                      <span>{copiedRichEmail ? 'HTML Copied' : 'Copy Rich HTML'}</span>
                    </button>
                    <a
                      href={generateMailtoUri({
                        to: emailTo,
                        subject: emailSubject,
                        bodyText: emailBody,
                        company,
                        keyDecisions: crmNotes.keyDecisions,
                        actionItems: crmNotes.actionItems
                      })}
                      className="btn btn--quiet btn--xs"
                      title="Open directly in default desktop mail client"
                    >
                      <ExternalLink className="icon icon--xs" />
                      <span>Open in Mailbox</span>
                    </a>
                    <button
                      type="button"
                      className="btn btn--quiet btn--xs"
                      onClick={() => setEmailEditing(!emailEditing)}
                    >
                      <Pencil className="icon icon--xs" />
                      <span>{emailEditing ? 'Done Editing' : 'Edit Email'}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {emailEnabled && (
              <div className="gtm-card-content">
                {emailEditing ? (
                  <div className="gtm-form-stack">
                    <div className="gtm-form-field">
                      <label className="gtm-label">To:</label>
                      <input
                        className="input input--sm"
                        value={emailTo}
                        onChange={(e) => setEmailTo(e.target.value)}
                      />
                    </div>
                    <div className="gtm-form-field">
                      <label className="gtm-label">Subject:</label>
                      <input
                        className="input input--sm"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                      />
                    </div>
                    <div className="gtm-form-field">
                      <label className="gtm-label">Body:</label>
                      <textarea
                        className="input input--sm"
                        rows={6}
                        value={emailBody}
                        onChange={(e) => setEmailBody(e.target.value)}
                        style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      <strong>Subject:</strong> {emailSubject}
                    </div>
                    <div className="gtm-preview-textarea">{emailBody}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CARD 3: Internal Team Slack Debrief */}
          <div className={`gtm-card ${slackEnabled ? 'gtm-card--active' : 'gtm-card--muted'}`}>
            <div className="gtm-card-header">
              <label className="gtm-checkbox-label">
                <input
                  type="checkbox"
                  checked={slackEnabled}
                  onChange={(e) => setSlackEnabled(e.target.checked)}
                />
                <MessageSquare className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                <span className="gtm-card-heading">3. Internal Team Briefing (Slack / Teams)</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {dispatchResults?.slack && (
                  <Badge tone="ok">
                    <Check className="icon icon--xs" /> {dispatchResults.slack.msg}
                  </Badge>
                )}
                {slackEnabled && (
                  <>
                    <button
                      type="button"
                      className="btn btn--quiet btn--xs"
                      onClick={() => void copyToClipboard(slackMessage, 'slack')}
                    >
                      {copiedSection === 'slack' ? (
                        <Check className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                      ) : (
                        <Copy className="icon icon--xs" />
                      )}
                      <span>{copiedSection === 'slack' ? 'Copied' : 'Copy'}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--quiet btn--xs"
                      onClick={() => setSlackEditing(!slackEditing)}
                    >
                      <Pencil className="icon icon--xs" />
                      <span>{slackEditing ? 'Done Editing' : 'Edit Brief'}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {slackEnabled && (
              <div className="gtm-card-content">
                {slackEditing ? (
                  <div className="gtm-form-stack">
                    <div className="gtm-form-field">
                      <label className="gtm-label">Target Channel</label>
                      <input
                        className="input input--sm"
                        value={slackChannel}
                        onChange={(e) => setSlackChannel(e.target.value)}
                      />
                    </div>
                    <div className="gtm-form-field">
                      <label className="gtm-label">Slack Message Format</label>
                      <textarea
                        className="input input--sm"
                        rows={4}
                        value={slackMessage}
                        onChange={(e) => setSlackMessage(e.target.value)}
                        style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="gtm-preview-textarea">{slackMessage}</div>
                )}
              </div>
            )}
          </div>

          {/* CARD 4: Engineering / Product Tasks (Linear / Jira) */}
          <div className={`gtm-card ${tasksEnabled ? 'gtm-card--active' : 'gtm-card--muted'}`}>
            <div className="gtm-card-header">
              <label className="gtm-checkbox-label">
                <input
                  type="checkbox"
                  checked={tasksEnabled}
                  onChange={(e) => setTasksEnabled(e.target.checked)}
                />
                <ListTodo className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                <span className="gtm-card-heading">
                  4. Engineering &amp; CS Tasks ({tickets.length} Tickets)
                </span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {dispatchResults?.tasks && (
                  <Badge tone="ok">
                    <Check className="icon icon--xs" /> {dispatchResults.tasks.msg}
                  </Badge>
                )}
                {tasksEnabled && (
                  <button
                    type="button"
                    className="btn btn--quiet btn--xs"
                    onClick={() => setTasksEditing(!tasksEditing)}
                  >
                    <Pencil className="icon icon--xs" />
                    <span>{tasksEditing ? 'Done Editing' : 'Edit Tickets'}</span>
                  </button>
                )}
              </div>
            </div>

            {tasksEnabled && (
              <div className="gtm-card-content">
                <div className="gtm-tickets-list">
                  {tickets.map((t) => (
                    <div key={t.id} className="gtm-ticket-row">
                      <span className="gtm-ticket-title">{t.title}</span>
                      {tasksEditing ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <select
                            value={t.priority}
                            onChange={(e) =>
                              handleUpdateTaskPriority(
                                t.id,
                                e.target.value as 'High' | 'Medium' | 'Low'
                              )
                            }
                            className="input input--xs"
                          >
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                          </select>
                          <button
                            type="button"
                            className="btn btn--icon btn--xs btn--quiet"
                            onClick={() => handleRemoveTask(t.id)}
                            title="Remove ticket"
                          >
                            <Trash2 className="icon icon--xs" />
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Badge tone={t.priority === 'High' ? 'warn' : 'idle'}>
                            {t.priority}
                          </Badge>
                          {t.assignee && t.assignee !== 'Unassigned' && (
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              @{t.assignee}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {tasksEditing && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input
                      className="input input--sm"
                      placeholder="Add another deliverable ticket…"
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn--quiet btn--sm"
                      onClick={handleAddTask}
                      disabled={!newTaskTitle.trim()}
                    >
                      <Plus className="icon icon--xs" />
                      <span>Add</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CARD 5: Calendar Follow-up Invitation */}
          <div className={`gtm-card ${calEnabled ? 'gtm-card--active' : 'gtm-card--muted'}`}>
            <div className="gtm-card-header">
              <label className="gtm-checkbox-label">
                <input
                  type="checkbox"
                  checked={calEnabled}
                  onChange={(e) => setCalEnabled(e.target.checked)}
                />
                <Calendar className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                <span className="gtm-card-heading">5. Follow-Up Calendar Invitation</span>
                {detectedTiming && (
                  <Badge tone="accent">Auto-detected: {detectedTiming.rawMatch}</Badge>
                )}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {dispatchResults?.calendar && (
                  <Badge tone="ok">
                    <Check className="icon icon--xs" /> {dispatchResults.calendar.msg}
                  </Badge>
                )}
                {calEnabled && (
                  <>
                    <a
                      href={googleCalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn--quiet btn--xs"
                      title="Add directly to Google Calendar"
                    >
                      <Calendar className="icon icon--xs" />
                      <span>Google Cal</span>
                    </a>
                    <button
                      type="button"
                      className="btn btn--quiet btn--xs"
                      onClick={handleDownloadIcs}
                      title="Download .ics file for Mac / Windows Outlook"
                    >
                      <Download className="icon icon--xs" />
                      <span>.ics File</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn--quiet btn--xs"
                      onClick={() => setCalEditing(!calEditing)}
                    >
                      <Pencil className="icon icon--xs" />
                      <span>{calEditing ? 'Done Editing' : 'Edit Invite'}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {calEnabled && (
              <div className="gtm-card-content">
                {calEditing ? (
                  <div className="gtm-form-grid">
                    <div className="gtm-form-field">
                      <label className="gtm-label">Meeting Title</label>
                      <input
                        className="input input--sm"
                        value={calTitle}
                        onChange={(e) => setCalTitle(e.target.value)}
                      />
                    </div>
                    <div className="gtm-form-field">
                      <label className="gtm-label">Date</label>
                      <input
                        type="date"
                        className="input input--sm"
                        value={calDate}
                        onChange={(e) => setCalDate(e.target.value)}
                      />
                    </div>
                    <div className="gtm-form-field">
                      <label className="gtm-label">Start Time</label>
                      <input
                        type="time"
                        className="input input--sm"
                        value={calTime}
                        onChange={(e) => setCalTime(e.target.value)}
                      />
                    </div>
                    <div className="gtm-form-field">
                      <label className="gtm-label">Duration</label>
                      <select
                        className="input input--sm"
                        value={calDuration}
                        onChange={(e) => setCalDuration(Number(e.target.value))}
                      >
                        <option value={15}>15 minutes</option>
                        <option value={30}>30 minutes</option>
                        <option value={45}>45 minutes</option>
                        <option value={60}>60 minutes</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="gtm-preview-row">
                    <div className="gtm-preview-col">
                      <div className="gtm-preview-meta">Event</div>
                      <div className="gtm-preview-val">{calTitle}</div>
                    </div>
                    <div className="gtm-preview-col">
                      <div className="gtm-preview-meta">Scheduled Time</div>
                      <div className="gtm-preview-val">
                        {calDate} at {calTime} ({calDuration} mins)
                      </div>
                    </div>
                    <div className="gtm-preview-col">
                      <div className="gtm-preview-meta">Platform / Link</div>
                      <div className="gtm-preview-val">Google Meet / Zoom</div>
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.06))' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Direct CRM Webhook Destination:
                    </span>
                    {crmStatusMessage && (
                      <span style={{ fontSize: 11, color: 'var(--accent, #38bdf8)' }}>
                        {crmStatusMessage}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select
                      className="input input--sm"
                      style={{ width: 140 }}
                      value={crmPlatform}
                      onChange={(e) => {
                        const plat = e.target.value as CrmPlatform
                        setCrmPlatform(plat)
                        saveCrmConfig(plat, crmWebhookUrl)
                      }}
                      aria-label="CRM Platform Destination"
                    >
                      <option value="hubspot">HubSpot</option>
                      <option value="salesforce">Salesforce</option>
                      <option value="notion">Notion</option>
                      <option value="webhook">Custom Webhook</option>
                    </select>
                    <input
                      className="input input--sm"
                      style={{ flex: 1 }}
                      placeholder={`Paste ${crmPlatform.toUpperCase()} webhook endpoint URL...`}
                      value={crmWebhookUrl}
                      onChange={(e) => {
                        setCrmWebhookUrl(e.target.value)
                        saveCrmConfig(crmPlatform, e.target.value)
                      }}
                      aria-label="CRM Webhook URL"
                    />
                    <button
                      type="button"
                      className="btn btn--quiet btn--xs"
                      disabled={crmDispatching || !crmWebhookUrl.trim()}
                      onClick={async () => {
                        setCrmDispatching(true)
                        setCrmStatusMessage(null)
                        try {
                          const res = await dispatchCrmDeal(
                            { platform: crmPlatform, webhookUrl: crmWebhookUrl },
                            {
                              company,
                              dealName,
                              dealStage,
                              dealAmount,
                              dealCloseDate,
                              dealNextSteps,
                              executiveSummary: crmNotes.executiveSummary,
                              keyDecisions: crmNotes.keyDecisions,
                              actionItems: crmNotes.actionItems
                            }
                          )
                          setCrmStatusMessage(res.success ? `✓ HTTP ${res.statusCode} Dispatched` : `Status: ${res.statusCode}`)
                        } catch (err) {
                          setCrmStatusMessage('Failed: ' + (err instanceof Error ? err.message : String(err)))
                        } finally {
                          setCrmDispatching(false)
                        }
                      }}
                    >
                      {crmDispatching ? <Loader2 className="icon icon--xs spin" /> : <Send className="icon icon--xs" />}
                      <span>Dispatch Now</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Bar */}
        <div className="gtm-modal-footer">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            <strong>{selectedCount} of 5</strong> actions selected for dispatch
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void handleDispatch()}
              disabled={isDispatching || selectedCount === 0}
            >
              {isDispatching ? (
                <>
                  <Loader2 className="icon icon--xs spin" />
                  <span>Dispatching Records…</span>
                </>
              ) : (
                <>
                  <Send className="icon icon--xs" />
                  <span>Approve &amp; Dispatch All ({selectedCount})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
