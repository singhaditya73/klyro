import React, { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Code2, Copy } from 'lucide-react'

interface Props {
  type: 'slack' | 'crm'
  crmType?: 'hubspot' | 'salesforce' | 'generic'
}

export function WebhookPayloadPreview({ type, crmType = 'hubspot' }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const sampleSlackPayload = {
    text: '📋 Meeting Summary: Acme Corp - Q4 Architecture Sync',
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📋 Acme Corp — Executive Summary & Deliverables',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Executive Summary:*\nAcme team agreed to migrate core authentication to OAuth2. P1 blockers resolved for December release.'
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: '*🎙️ Talk Ratio:*\nYou: 42% | Client: 58% (Healthy pacing)'
          },
          {
            type: 'mrkdwn',
            text: '*📅 Date:*\nNovember 22, 2026'
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*⚡ Action Items:*\n• [ ] Sarah: Deliver OpenAPI 3.1 specification by Tuesday\n• [ ] Alex: Verify staging database cluster configuration'
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '🔒 Generated via *Klyro* · Local meeting intelligence'
          }
        ]
      }
    ]
  }

  const sampleCrmPayload = {
    source: 'Klyro Meeting Intelligence',
    version: '1.0',
    crmTarget: crmType,
    deal: {
      title: 'Acme Corp - Enterprise License Expansion',
      valueEstimate: '$120,000 ARR',
      stage: 'Proposal / Technical Validation',
      meetingType: 'B2B Sales Deal (MEDDPIC)'
    },
    meddpic: {
      metrics: '40% reduction in response latency, 99.99% uptime SLA',
      economicBuyer: 'Sarah Chen (VP Engineering)',
      decisionCriteria: 'SOC2 Type II compliance, on-prem or local LLM capability',
      decisionProcess: 'Technical sign-off by Nov 30, CFO final signature Dec 15',
      painPoints: 'Legacy system cannot handle 10k concurrent WebSockets',
      champion: 'Marcus Vance (Staff Infrastructure Architect)'
    },
    actionItems: [
      { task: 'Send MSA and DPA to legal', owner: 'Alex', deadline: '2026-11-26' },
      { task: 'Schedule security architecture review call', owner: 'Sarah', deadline: '2026-11-28' }
    ],
    pacing: {
      userTalkPct: 38,
      clientTalkPct: 62,
      recommendation: 'Optimal discovery ratio achieved'
    },
    timestamp: new Date().toISOString()
  }

  const payload = type === 'slack' ? sampleSlackPayload : sampleCrmPayload
  const jsonString = JSON.stringify(payload, null, 2)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignored
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: 'none',
          padding: '4px 0',
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--text-secondary)',
          fontWeight: 500
        }}
      >
        {open ? <ChevronDown className="icon icon--xs" /> : <ChevronRight className="icon icon--xs" />}
        <Code2 className="icon icon--xs" style={{ color: 'var(--accent)' }} />
        <span>{open ? 'Hide Payload Preview' : 'Preview Webhook Payload (JSON)'}</span>
      </button>

      {open && (
        <div
          style={{
            marginTop: 8,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border-subtle)',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'rgba(255, 255, 255, 0.02)'
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {type === 'slack' ? 'Slack Block Kit JSON' : `CRM (${crmType.toUpperCase()}) Dispatch Payload`}
            </span>
            <button
              type="button"
              className="btn btn--quiet btn--xs"
              onClick={handleCopy}
              style={{ height: 22, padding: '0 8px', fontSize: 11 }}
            >
              {copied ? (
                <>
                  <Check className="icon icon--xs" style={{ color: 'var(--status-ok)' }} />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="icon icon--xs" />
                  <span>Copy JSON</span>
                </>
              )}
            </button>
          </div>

          <pre
            style={{
              margin: 0,
              padding: '12px 14px',
              fontSize: 11.5,
              lineHeight: 1.5,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-primary)',
              background: 'transparent',
              maxHeight: 240,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {jsonString}
          </pre>
        </div>
      )}
    </div>
  )
}
