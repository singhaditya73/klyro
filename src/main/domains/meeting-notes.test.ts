import { describe, expect, it } from 'vitest'
import type { InterviewSession, MeetingCrmNotes } from '@shared/types'
import { computeTalkRatio, exportMeetingNotesMarkdown, formatForCrm, formatForNotion, formatForSlack } from './meeting-notes'

describe('meeting-notes formatting', () => {
  const sampleNotes: MeetingCrmNotes = {
    title: 'Acme Corp Q4 Architecture Sync',
    type: 'client_call',
    executiveSummary: 'Agreed on migrating auth to OAuth2 and deploying Klyro across 50 developer seats.',
    keyDecisions: ['Migrate to OAuth2 by end of month', 'Standardize on local offline Whisper models'],
    discussionTopics: ['Security compliance & air-gap requirements', 'License provisioning'],
    actionItems: [
      { task: 'Send updated security whitepaper', owner: 'Aditya', deadline: 'Friday', done: false },
      { task: 'Set up staging test environment', owner: 'Dave', done: true }
    ],
    crmInsights: {
      clientNeeds: ['Zero cloud audio leakage', 'Sub-second response time'],
      budgetTimeline: '$15k budget approved for Q4',
      objectionsOrRisks: ['Windows 10 compatibility concerns'],
      nextSteps: 'Schedule technical deep dive with security lead'
    },
    meddpic: {
      metrics: 'Save 15 hours/week per developer',
      economicBuyer: 'CTO (Jane Smith)',
      decisionCriteria: '100% offline air-gap and SOC2 compliance',
      decisionProcess: 'Security review then procurement by Nov 15',
      painPoints: 'Cloud bots blocked by enterprise firewall',
      champion: 'Dave (Lead Architect)',
      competition: 'Otter Enterprise'
    },
    talkRatio: {
      userPct: 35,
      othersPct: 65,
      pacingNote: 'Optimal collaborative pacing'
    },
    followUpEmail: 'Subject: Great meeting today - Next steps for Acme Corp\n\nHi Dave,\nThanks for your time today...',
    model: 'claude-3-5-sonnet',
    generatedAt: 1730000000000
  }

  const sampleSession: InterviewSession = {
    id: 'test-session-1',
    company: 'Acme Corp',
    role: 'Lead Architect',
    startedAt: 1730000000000,
    endedAt: 1730003600000,
    durationMs: 3600000,
    questions: [{ id: 'q1', text: 'How do you handle air-gapped OCR?', source: 'voice', askedAt: 1730000100000, kind: 'technical', progress: 'answered', answer: 'Local PP-OCR runtime.', note: '', bookmarked: false }],
    transcript: ['Hello everyone, welcome to the sync.', 'Let us review the security architecture.'],
    answers: [],
    notes: 'Dave seems very excited about offline OCR.',
    summary: 'Good discussion on privacy.',
    crmNotes: sampleNotes,
    context: [],
    tags: ['sales', 'acme'],
    bookmarked: true,
    ephemeral: false
  }

  it('exports meeting notes into clean markdown', () => {
    const md = exportMeetingNotesMarkdown(sampleSession)
    expect(md).toContain('# Acme Corp Q4 Architecture Sync')
    expect(md).toContain('## Executive Summary')
    expect(md).toContain('Agreed on migrating auth to OAuth2')
    expect(md).toContain('## Action Items')
    expect(md).toContain('- [ ] Send updated security whitepaper (@Aditya) [Due: Friday]')
    expect(md).toContain('- [x] Set up staging test environment (@Dave)')
    expect(md).toContain('## Key Decisions')
    expect(md).toContain('- 🎯 Migrate to OAuth2 by end of month')
    expect(md).toContain('## CRM & Business Insights')
    expect(md).toContain('**Client Needs / Pain Points**:')
    expect(md).toContain('**Budget & Timeline**: $15k budget approved for Q4')
    expect(md).toContain('## Follow-up Email Draft')
    expect(md).toContain('## Transcript')
  })

  it('formats meeting notes for Slack sharing', () => {
    const slack = formatForSlack(sampleNotes)
    expect(slack).toContain('*📋 Meeting Summary: Acme Corp Q4 Architecture Sync*')
    expect(slack).toContain('*✅ Action Items:*')
    expect(slack).toContain('• [ ] Send updated security whitepaper _(Aditya)_')
    expect(slack).toContain('*🎯 Key Decisions:*')
    expect(slack).toContain('*➡️ Next Steps:* Schedule technical deep dive with security lead')
  })

  it('formats meeting notes for Notion databases', () => {
    const notion = formatForNotion(sampleNotes)
    expect(notion).toContain('# 📋 Acme Corp Q4 Architecture Sync')
    expect(notion).toContain('> 🎙️ **Talk Ratio**: You: 35% | Others: 65%')
    expect(notion).toContain('### 💼 MEDDPIC Qualification')
    expect(notion).toContain('**Metrics**: Save 15 hours/week per developer')
    expect(notion).toContain('**Economic Buyer**: CTO (Jane Smith)')
    expect(notion).toContain('**Champion**: Dave (Lead Architect)')
  })

  it('formats meeting notes for Salesforce and HubSpot CRM logs', () => {
    const crm = formatForCrm(sampleNotes)
    expect(crm).toContain('=== CALL LOG: ACME CORP Q4 ARCHITECTURE SYNC ===')
    expect(crm).toContain('TALK RATIO: User 35% / Others 65%')
    expect(crm).toContain('M - Metrics: Save 15 hours/week per developer')
    expect(crm).toContain('E - Economic Buyer: CTO (Jane Smith)')
    expect(crm).toContain('C - Champion: Dave (Lead Architect)')
    expect(crm).toContain('C - Competition: Otter Enterprise')
  })

  it('calculates conversational talk ratio accurately', () => {
    const ratio = computeTalkRatio(sampleSession)
    expect(ratio.userPct).toBeGreaterThan(0)
    expect(ratio.othersPct).toBeGreaterThan(0)
    expect(ratio.userPct + ratio.othersPct).toBe(100)
    expect(ratio.pacingNote).toBeTruthy()
  })
})
