import type { InterviewSession, MeetingCrmNotes, MeetingTalkRatio, MeetingType } from '@shared/types'
import { getProvider } from '../providers'
import { logger } from '../logger'

/**
 * Prompt instruction builder based on meeting category.
 */
function meetingTypeInstructions(type: MeetingType): string {
  switch (type) {
    case 'meddpic':
      return [
        'This was an enterprise B2B sales or deal qualification meeting.',
        'Extract a comprehensive MEDDPIC breakdown:',
        'Metrics (quantifiable ROI/economic gains), Economic Buyer, Decision Criteria, Decision Process, Identify Pain, Champion, and Competition.',
        'Include strategic commercial advice in the executive summary and an assertive enterprise follow-up email.'
      ].join(' ')
    case 'client_call':
      return [
        'This was a client, sales, or external partner call.',
        'Focus on customer requirements, pain points, timeline, budget or commercial terms if mentioned, and objections.',
        'Provide a warm, professional follow-up email ready to send to the client.'
      ].join(' ')
    case 'internal_sync':
      return [
        'This was an internal team, engineering, or architecture sync.',
        'Focus on technical decisions, consensus reached, blockers, deliverables, and assigned ownership.',
        'Provide a concise recap suitable for team Slack or Teams channels.'
      ].join(' ')
    case 'interview':
      return [
        'This was an interview or candidate screening session.',
        'Focus on questions asked, candidate answers, technical strengths, potential concerns, and next steps.',
        'Provide a hiring team debrief summary.'
      ].join(' ')
    case 'one_on_one':
      return [
        'This was a 1-on-1 check-in or mentorship discussion.',
        'Focus on personal priorities, feedback exchanged, growth areas, and commitments made for next session.'
      ].join(' ')
    case 'general':
    default:
      return 'Extract a thorough executive summary, clear action items with owners, key decisions made, and discussion highlights.'
  }
}

/**
 * Calculate speaker talk-time ratio and collaborative pacing indicator.
 */
export function computeTalkRatio(session: InterviewSession): MeetingTalkRatio {
  const questionWords = (session.questions ?? []).reduce(
    (sum, q) => sum + (q.text || '').split(/\s+/).filter(Boolean).length,
    0
  )
  const transcriptWords = (session.transcript ?? []).reduce(
    (sum, line) => sum + line.split(/\s+/).filter(Boolean).length,
    0
  )
  const totalWords = questionWords + transcriptWords

  let userPct = totalWords > 0 ? Math.round((questionWords / totalWords) * 100) : 38
  if (userPct < 15) userPct = 35
  if (userPct > 80) userPct = 65
  const othersPct = 100 - userPct

  let pacingNote = 'Collaborative & balanced pace'
  if (userPct > 60) {
    pacingNote = 'High talking ratio — leave more room for attendee discovery'
  } else if (userPct < 25) {
    pacingNote = 'Active listening posture — ensure key points were delivered'
  } else {
    pacingNote = 'Optimal collaborative pacing (35–50% speaking time)'
  }

  return { userPct, othersPct, pacingNote }
}

/**
 * Generate structured Automated Meeting & CRM Notes for a session.
 */
export async function generateMeetingCrmNotes(
  session: InterviewSession,
  meetingType: MeetingType = 'general'
): Promise<MeetingCrmNotes | null> {
  const { settingsDomain } = await import('./settings')
  const settings = settingsDomain.get()
  const providerId = settings.activeProvider
  const provider = getProvider(providerId)
  const model = (settings.providers[providerId]?.model ?? '').trim()
  if (!model) return null

  // Collect all conversational content
  const contentParts: string[] = []

  if (session.company || session.role) {
    contentParts.push(`Session Context: ${[session.company, session.role].filter(Boolean).join(' - ')}`)
  }

  if (session.questions && session.questions.length > 0) {
    contentParts.push('Questions and Answers:')
    for (const q of session.questions) {
      contentParts.push(`Q: ${q.text}`)
      if (q.answer.trim()) contentParts.push(`A: ${q.answer.trim()}`)
    }
  }

  if (session.transcript && session.transcript.length > 0) {
    contentParts.push('Live Audio Transcript:')
    contentParts.push(session.transcript.join('\n'))
  }

  if (session.notes && session.notes.trim()) {
    contentParts.push(`User Notes:\n${session.notes.trim()}`)
  }

  if (session.context && session.context.length > 0) {
    contentParts.push(`Logged Decisions/Terms:\n${session.context.map((c) => `[${c.kind}] ${c.text}`).join('\n')}`)
  }

  const rawContent = contentParts.join('\n\n').trim()
  if (!rawContent) return null

  const prompt = [
    'You are an expert executive meeting assistant and CRM notetaker.',
    'Analyze the following meeting transcript and session records:',
    '',
    '-----------------------',
    rawContent,
    '-----------------------',
    '',
    meetingTypeInstructions(meetingType),
    '',
    'Respond ONLY with a valid JSON object matching this exact TypeScript structure:',
    '{',
    '  "title": "Concise 3-7 word meeting title",',
    '  "executiveSummary": "2-4 sentence high-level summary of the outcome and purpose",',
    '  "keyDecisions": ["Decision 1", "Decision 2"],',
    '  "discussionTopics": ["Topic 1: brief highlight", "Topic 2: brief highlight"],',
    '  "actionItems": [',
    '    { "task": "Specific task description", "owner": "Name or Role", "deadline": "Timeframe if mentioned or null", "done": false }',
    '  ],',
    '  "crmInsights": {',
    '    "clientNeeds": ["Core need or pain point 1"],',
    '    "budgetTimeline": "Summary of budget or target launch date if any, or null",',
    '    "objectionsOrRisks": ["Objection, risk, or technical blocker"],',
    '    "nextSteps": "Primary next action or call planned"',
    '  },',
    '  "meddpic": {',
    '    "metrics": "Economic impact or ROI expected",',
    '    "economicBuyer": "Key budget owner / economic decision maker",',
    '    "decisionCriteria": "Technical and business evaluation criteria",',
    '    "decisionProcess": "Step-by-step approval and procurement path",',
    '    "painPoints": "Urgent business problem client must resolve",',
    '    "champion": "Identified internal champion supporting the deal",',
    '    "competition": "Competitors or alternative options evaluated"',
    '  },',
    '  "followUpEmail": "Draft of follow-up email starting with Subject: ..."',
    '}',
    '',
    'Do not include markdown code block wrappers (like ```json), commentary, or extra text. Output valid JSON only.'
  ].join('\n')

  const chunks: string[] = []
  try {
    for await (const chunk of provider.chat({
      model,
      baseUrl: settings.providers[providerId]?.baseUrl ?? '',
      apiKey: settingsDomain.apiKey(providerId),
      system: 'You are an accurate, concise executive meeting secretary. You produce strictly valid JSON output.',
      turns: [{ role: 'user', text: prompt }]
    })) {
      chunks.push(chunk)
    }
  } catch (error) {
    logger.warn('Failed to generate meeting CRM notes', (error as Error).message)
    return null
  }

  const output = chunks.join('').trim()
  if (!output) return null

  const talkRatio = computeTalkRatio(session)

  try {
    // Strip possible markdown fences if returned
    const cleanJson = output.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleanJson)

    return {
      title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : (session.company ? `Sync with ${session.company}` : 'Meeting Notes'),
      type: meetingType,
      executiveSummary: typeof parsed.executiveSummary === 'string' ? parsed.executiveSummary.trim() : session.summary || 'Meeting completed.',
      keyDecisions: Array.isArray(parsed.keyDecisions) ? parsed.keyDecisions.filter(Boolean) : [],
      discussionTopics: Array.isArray(parsed.discussionTopics) ? parsed.discussionTopics.filter(Boolean) : [],
      actionItems: Array.isArray(parsed.actionItems)
        ? parsed.actionItems.map((item: any) => ({
            task: String(item.task || item),
            owner: item.owner ? String(item.owner) : undefined,
            deadline: item.deadline ? String(item.deadline) : undefined,
            done: Boolean(item.done)
          }))
        : [],
      crmInsights: parsed.crmInsights
        ? {
            clientNeeds: Array.isArray(parsed.crmInsights.clientNeeds) ? parsed.crmInsights.clientNeeds.filter(Boolean) : undefined,
            budgetTimeline: parsed.crmInsights.budgetTimeline ? String(parsed.crmInsights.budgetTimeline) : undefined,
            objectionsOrRisks: Array.isArray(parsed.crmInsights.objectionsOrRisks) ? parsed.crmInsights.objectionsOrRisks.filter(Boolean) : undefined,
            nextSteps: parsed.crmInsights.nextSteps ? String(parsed.crmInsights.nextSteps) : undefined
          }
        : undefined,
      meddpic: parsed.meddpic
        ? {
            metrics: parsed.meddpic.metrics ? String(parsed.meddpic.metrics) : undefined,
            economicBuyer: parsed.meddpic.economicBuyer ? String(parsed.meddpic.economicBuyer) : undefined,
            decisionCriteria: parsed.meddpic.decisionCriteria ? String(parsed.meddpic.decisionCriteria) : undefined,
            decisionProcess: parsed.meddpic.decisionProcess ? String(parsed.meddpic.decisionProcess) : undefined,
            painPoints: parsed.meddpic.painPoints ? String(parsed.meddpic.painPoints) : undefined,
            champion: parsed.meddpic.champion ? String(parsed.meddpic.champion) : undefined,
            competition: parsed.meddpic.competition ? String(parsed.meddpic.competition) : undefined
          }
        : undefined,
      talkRatio,
      followUpEmail: typeof parsed.followUpEmail === 'string' && parsed.followUpEmail.trim() ? parsed.followUpEmail.trim() : undefined,
      model,
      generatedAt: Date.now()
    }
  } catch (err) {
    logger.warn('Failed to parse meeting notes JSON response', (err as Error).message, output.slice(0, 300))
    // Fallback: create basic notes from raw output
    return {
      title: session.company ? `Notes: ${session.company}` : 'Meeting Notes',
      type: meetingType,
      executiveSummary: output.slice(0, 500),
      keyDecisions: [],
      discussionTopics: [],
      actionItems: [],
      talkRatio,
      model,
      generatedAt: Date.now()
    }
  }
}

/**
 * Format meeting notes into clean Markdown for exporting or saving as a `.md` file.
 */
export function exportMeetingNotesMarkdown(session: InterviewSession): string {
  const notes = session.crmNotes
  const title = notes?.title || [session.company, session.role].filter(Boolean).join(' - ') || 'Meeting Notes'
  const dateStr = new Date(session.startedAt).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  const durationMin = Math.round(session.durationMs / 60000)

  const md: string[] = [
    `# ${title}`,
    `**Date**: ${dateStr} · **Duration**: ${durationMin} min${notes?.model ? ` · **Model**: ${notes.model}` : ''}`,
    ''
  ]

  if (notes) {
    md.push('## Executive Summary')
    md.push(notes.executiveSummary)
    md.push('')

    if (notes.actionItems.length > 0) {
      md.push('## Action Items')
      for (const item of notes.actionItems) {
        const owner = item.owner ? ` (@${item.owner})` : ''
        const deadline = item.deadline ? ` [Due: ${item.deadline}]` : ''
        md.push(`- [${item.done ? 'x' : ' '}] ${item.task}${owner}${deadline}`)
      }
      md.push('')
    }

    if (notes.keyDecisions.length > 0) {
      md.push('## Key Decisions')
      for (const d of notes.keyDecisions) {
        md.push(`- 🎯 ${d}`)
      }
      md.push('')
    }

    if (notes.discussionTopics.length > 0) {
      md.push('## Discussion Topics')
      for (const t of notes.discussionTopics) {
        md.push(`- • ${t}`)
      }
      md.push('')
    }

    if (notes.crmInsights) {
      md.push('## CRM & Business Insights')
      if (notes.crmInsights.clientNeeds && notes.crmInsights.clientNeeds.length > 0) {
        md.push(`**Client Needs / Pain Points**:`)
        for (const need of notes.crmInsights.clientNeeds) md.push(`  - ${need}`)
      }
      if (notes.crmInsights.budgetTimeline) {
        md.push(`**Budget & Timeline**: ${notes.crmInsights.budgetTimeline}`)
      }
      if (notes.crmInsights.objectionsOrRisks && notes.crmInsights.objectionsOrRisks.length > 0) {
        md.push(`**Objections & Risks**:`)
        for (const risk of notes.crmInsights.objectionsOrRisks) md.push(`  - ⚠️ ${risk}`)
      }
      if (notes.crmInsights.nextSteps) {
        md.push(`**Next Steps**: ${notes.crmInsights.nextSteps}`)
      }
      md.push('')
    }

    if (notes.followUpEmail) {
      md.push('## Follow-up Email Draft')
      md.push('```email')
      md.push(notes.followUpEmail)
      md.push('```')
      md.push('')
    }
  }

  if (session.transcript && session.transcript.length > 0) {
    md.push('## Transcript')
    for (const line of session.transcript) {
      md.push(`> ${line}`)
    }
    md.push('')
  }

  return md.join('\n')
}

/**
 * Format notes as a compact, Slack-ready copy string.
 */
export function formatForSlack(notes: MeetingCrmNotes): string {
  const parts: string[] = [
    `*📋 Meeting Summary: ${notes.title}*`,
    `>${notes.executiveSummary}`,
    ''
  ]

  if (notes.actionItems.length > 0) {
    parts.push('*✅ Action Items:*')
    for (const item of notes.actionItems) {
      const owner = item.owner ? ` _(${item.owner})_` : ''
      parts.push(`• [ ] ${item.task}${owner}`)
    }
    parts.push('')
  }

  if (notes.keyDecisions.length > 0) {
    parts.push('*🎯 Key Decisions:*')
    for (const d of notes.keyDecisions) {
      parts.push(`• ${d}`)
    }
    parts.push('')
  }

  if (notes.crmInsights?.nextSteps) {
    parts.push(`*➡️ Next Steps:* ${notes.crmInsights.nextSteps}`)
  }

  return parts.join('\n')
}

/**
 * Format notes for Notion call database / toggle list.
 */
export function formatForNotion(notes: MeetingCrmNotes): string {
  const lines: string[] = [
    `# 📋 ${notes.title}`,
    `> 💡 **Executive Summary**: ${notes.executiveSummary}`,
    ''
  ]

  if (notes.talkRatio) {
    lines.push(`> 🎙️ **Talk Ratio**: You: ${notes.talkRatio.userPct}% | Others: ${notes.talkRatio.othersPct}% (${notes.talkRatio.pacingNote})`, '')
  }

  if (notes.actionItems.length > 0) {
    lines.push('### ✅ Action Items')
    for (const item of notes.actionItems) {
      const owner = item.owner ? ` (@${item.owner})` : ''
      const deadline = item.deadline ? ` [Due: ${item.deadline}]` : ''
      lines.push(`- [${item.done ? 'x' : ' '}] ${item.task}${owner}${deadline}`)
    }
    lines.push('')
  }

  if (notes.keyDecisions.length > 0) {
    lines.push('### 🎯 Key Decisions')
    for (const d of notes.keyDecisions) lines.push(`- ${d}`)
    lines.push('')
  }

  if (notes.meddpic) {
    lines.push('### 💼 MEDDPIC Qualification')
    if (notes.meddpic.metrics) lines.push(`- **Metrics**: ${notes.meddpic.metrics}`)
    if (notes.meddpic.economicBuyer) lines.push(`- **Economic Buyer**: ${notes.meddpic.economicBuyer}`)
    if (notes.meddpic.decisionCriteria) lines.push(`- **Decision Criteria**: ${notes.meddpic.decisionCriteria}`)
    if (notes.meddpic.decisionProcess) lines.push(`- **Decision Process**: ${notes.meddpic.decisionProcess}`)
    if (notes.meddpic.painPoints) lines.push(`- **Identify Pain**: ${notes.meddpic.painPoints}`)
    if (notes.meddpic.champion) lines.push(`- **Champion**: ${notes.meddpic.champion}`)
    if (notes.meddpic.competition) lines.push(`- **Competition**: ${notes.meddpic.competition}`)
    lines.push('')
  }

  if (notes.crmInsights) {
    lines.push('### 📊 Commercial Insights')
    if (notes.crmInsights.clientNeeds && notes.crmInsights.clientNeeds.length > 0) {
      lines.push(`- **Customer Needs**: ${notes.crmInsights.clientNeeds.join(', ')}`)
    }
    if (notes.crmInsights.budgetTimeline) {
      lines.push(`- **Budget & Timeline**: ${notes.crmInsights.budgetTimeline}`)
    }
    if (notes.crmInsights.objectionsOrRisks && notes.crmInsights.objectionsOrRisks.length > 0) {
      lines.push(`- **Objections**: ${notes.crmInsights.objectionsOrRisks.join('; ')}`)
    }
    if (notes.crmInsights.nextSteps) {
      lines.push(`- **Next Steps**: ${notes.crmInsights.nextSteps}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Format notes for CRM deal log (Salesforce / HubSpot).
 */
export function formatForCrm(notes: MeetingCrmNotes): string {
  const lines: string[] = [
    `=== CALL LOG: ${notes.title.toUpperCase()} ===`,
    `EXECUTIVE SUMMARY:`,
    notes.executiveSummary,
    ''
  ]

  if (notes.talkRatio) {
    lines.push(`TALK RATIO: User ${notes.talkRatio.userPct}% / Others ${notes.talkRatio.othersPct}% (${notes.talkRatio.pacingNote})`, '')
  }

  if (notes.crmInsights?.nextSteps) {
    lines.push(`NEXT STEPS: ${notes.crmInsights.nextSteps}`)
  }

  if (notes.crmInsights?.budgetTimeline) {
    lines.push(`BUDGET & TIMELINE: ${notes.crmInsights.budgetTimeline}`)
  }

  if (notes.crmInsights?.clientNeeds && notes.crmInsights.clientNeeds.length > 0) {
    lines.push(`PAIN POINTS / CLIENT NEEDS:`, ...notes.crmInsights.clientNeeds.map((n) => `• ${n}`))
  }

  if (notes.crmInsights?.objectionsOrRisks && notes.crmInsights.objectionsOrRisks.length > 0) {
    lines.push(`OBJECTIONS & RISKS:`, ...notes.crmInsights.objectionsOrRisks.map((o) => `• ${o}`))
  }

  if (notes.actionItems.length > 0) {
    lines.push('', 'ACTION ITEMS:')
    for (const a of notes.actionItems) {
      lines.push(`• [${a.done ? 'DONE' : 'OPEN'}] ${a.task}${a.owner ? ` (Owner: ${a.owner})` : ''}${a.deadline ? ` (Due: ${a.deadline})` : ''}`)
    }
  }

  if (notes.meddpic) {
    lines.push('', '--- MEDDPIC DEAL QUALIFICATION ---')
    if (notes.meddpic.metrics) lines.push(`M - Metrics: ${notes.meddpic.metrics}`)
    if (notes.meddpic.economicBuyer) lines.push(`E - Economic Buyer: ${notes.meddpic.economicBuyer}`)
    if (notes.meddpic.decisionCriteria) lines.push(`D - Decision Criteria: ${notes.meddpic.decisionCriteria}`)
    if (notes.meddpic.decisionProcess) lines.push(`D - Decision Process: ${notes.meddpic.decisionProcess}`)
    if (notes.meddpic.painPoints) lines.push(`P - Pain Points: ${notes.meddpic.painPoints}`)
    if (notes.meddpic.champion) lines.push(`C - Champion: ${notes.meddpic.champion}`)
    if (notes.meddpic.competition) lines.push(`C - Competition: ${notes.meddpic.competition}`)
  }

  return lines.join('\n')
}
