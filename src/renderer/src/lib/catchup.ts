/**
 * "Catch Me Up" Late-Joiner & Distraction Intelligence Engine.
 *
 * Synthesizes long meeting transcripts into an instant 3-part briefing deck:
 * 1. Backstory / Missed Discussion (what was established before)
 * 2. Settled Decisions (what is already agreed, so you don't re-ask)
 * 3. Active Discussion Right Now (current topic + safe talking point if called on)
 */

export interface CatchUpBriefing {
  missedSummary: string
  keyDecisions: string[]
  activeTopic: {
    topic: string
    lastSpeaker?: string
    suggestedContribution: string
  }
  speakersInvolved: string[]
  totalLinesAnalyzed: number
}

/** Parses speaker from line like "[Alice]: Hello team" */
export function extractSpeakerAndText(line: string): { speaker?: string; text: string } {
  const match = /^\[([^\]]+)\]:\s*(.*)$/.exec(line.trim())
  if (match) {
    return { speaker: match[1], text: match[2] }
  }
  return { text: line.trim() }
}

/** Synthesizes transcript into an instant catch-up briefing. */
export function generateCatchUpBriefing(transcript: string[]): CatchUpBriefing {
  if (!transcript || transcript.length === 0) {
    return {
      missedSummary: 'The meeting has just begun. No prior discussion recorded.',
      keyDecisions: [],
      activeTopic: {
        topic: 'Opening introductions & agenda kickoff',
        suggestedContribution: 'Acknowledge the agenda and confirm ready to proceed.'
      },
      speakersInvolved: [],
      totalLinesAnalyzed: 0
    }
  }

  const parsed = transcript.map(extractSpeakerAndText)
  const speakers = [...new Set(parsed.map((p) => p.speaker).filter(Boolean))] as string[]

  // 1. Identify decisions / commitments
  const decisionKeywords = /\b(?:agreed|decided|approved|confirmed|concluded|settled|aligned on|resolution|action item)\b/i
  const keyDecisions: string[] = []

  for (const item of parsed) {
    if (decisionKeywords.test(item.text)) {
      const clean = item.text.replace(/^[-*•]\s*/, '').trim()
      if (clean.length > 10 && !keyDecisions.includes(clean)) {
        keyDecisions.push(clean)
      }
    }
  }

  // 2. Active topic (last 3 lines)
  const recentLines = parsed.slice(-3)
  const lastSpeaker = recentLines[recentLines.length - 1]?.speaker
  const recentText = recentLines.map((l) => l.text).join(' ')

  let activeTopic = 'General discussion and review'
  let suggestedContribution = 'Offer to summarize the key priorities and outline immediate next steps.'

  const lowerRecent = recentText.toLowerCase()
  if (/(?:price|pricing|budget|cost|quote|discount|license)/.test(lowerRecent)) {
    activeTopic = 'Commercial terms, pricing, and budget structure'
    suggestedContribution = 'Emphasize ROI and time saved per rep (8+ hrs/week) to justify value.'
  } else if (/(?:security|soc|compliance|privacy|encrypt|gdpr|audit)/.test(lowerRecent)) {
    activeTopic = 'Security, compliance, and enterprise data privacy'
    suggestedContribution = 'Highlight local-first architecture and that zero audio is stored on third-party bots.'
  } else if (/(?:architect|database|scale|latency|api|integration|deploy|sync)/.test(lowerRecent)) {
    activeTopic = 'Technical architecture, APIs, and stack integration'
    suggestedContribution = 'Confirm seamless integration with existing tools (Slack, HubSpot, Linear) with 5-minute setup.'
  } else if (/(?:timeline|schedule|next week|deadline|launch|date)/.test(lowerRecent)) {
    activeTopic = 'Project timeline, milestone targets, and rollout dates'
    suggestedContribution = 'Confirm alignment on the target launch date and ask if any dependencies remain open.'
  }

  // 3. Missed backstory summary
  const earlierLines = parsed.slice(0, Math.max(1, parsed.length - 3))
  let missedSummary = ''
  if (earlierLines.length > 0) {
    const topicsDetected: string[] = []
    const allEarlierText = earlierLines.map((l) => l.text).join(' ').toLowerCase()
    if (/pricing|budget/.test(allEarlierText)) topicsDetected.push('pricing & commercial terms')
    if (/security|compliance|soc/.test(allEarlierText)) topicsDetected.push('security review')
    if (/architecture|api|integration/.test(allEarlierText)) topicsDetected.push('technical integrations')
    if (/agenda|goals|kickoff/.test(allEarlierText)) topicsDetected.push('initial meeting objectives')

    if (topicsDetected.length > 0) {
      missedSummary = `Team previously discussed ${topicsDetected.join(', ')} across ${earlierLines.length} turns.`
    } else {
      missedSummary = `The group covered ${earlierLines.length} conversation turns before this point.`
    }
  } else {
    missedSummary = 'Discussion just opened with initial remarks.'
  }

  return {
    missedSummary,
    keyDecisions: keyDecisions.slice(-4),
    activeTopic: {
      topic: activeTopic,
      lastSpeaker,
      suggestedContribution
    },
    speakersInvolved: speakers,
    totalLinesAnalyzed: transcript.length
  }
}

