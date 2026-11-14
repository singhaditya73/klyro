/**
 * Live In-Call Competitor & Objection Battlecard Engine.
 *
 * Scans live meeting transcripts for competitor mentions, pricing objections,
 * security/compliance roadblocks, and timing delays, returning instant
 * high-leverage rebuttals and discovery trap questions for sales calls.
 */

export type BattlecardCategory = 'competitor' | 'pricing' | 'security' | 'timing' | 'integration'

export interface Battlecard {
  id: string
  category: BattlecardCategory
  trigger: string
  title: string
  keyPoints: string[]
  trapQuestion: string
}

export interface DetectedBattlecardMatch {
  battlecard: Battlecard
  matchedPhrase: string
  timestamp: number
}

/** Pre-configured high-leverage competitor battlecards. */
export const COMPETITOR_BATTLECARDS: Record<string, Battlecard> = {
  gong: {
    id: 'gong',
    category: 'competitor',
    trigger: 'gong',
    title: 'Gong.io Comparison',
    keyPoints: [
      'Gong requires intrusive meeting recording bots that many enterprise prospects ban or refuse.',
      'Gong is post-meeting analytics only; it provides zero real-time in-call live assistance.',
      'Pricing starts at $1,400+/user/year with multi-year lock-in versus our flexible, client-side model.'
    ],
    trapQuestion: 'Are your prospects comfortable having bot accounts join and record every internal discussion?'
  },
  fireflies: {
    id: 'fireflies',
    category: 'competitor',
    trigger: 'fireflies',
    title: 'Fireflies.ai Comparison',
    keyPoints: [
      'Fireflies is a passive transcription bot with frequent speaker misattribution.',
      'Data is processed on third-party cloud servers; our client-side architecture keeps audio private.',
      'No autonomous GTM dispatch or real-time CRM field extraction.'
    ],
    trapQuestion: 'Does your compliance team permit third-party transcription bots to store audio on external clouds?'
  },
  otter: {
    id: 'otter',
    category: 'competitor',
    trigger: 'otter',
    title: 'Otter.ai Comparison',
    keyPoints: [
      'Otter focuses on basic consumer meeting notes rather than enterprise MEDDPIC deal intelligence.',
      'No integration with developer workflows (Linear, GitHub, Jira) or autonomous CRM dispatch.',
      'Often blocked by Zoom/Teams security policies due to bot recording.'
    ],
    trapQuestion: 'Do you need just generic meeting notes, or structured MEDDPIC deal fields that sync to your CRM?'
  },
  salesforce: {
    id: 'salesforce',
    category: 'competitor',
    trigger: 'salesforce',
    title: 'Einstein / Salesforce Native',
    keyPoints: [
      'Salesforce Einstein requires complex enterprise setup, heavy consulting, and expensive add-on tiers.',
      'Locked into the Salesforce ecosystem; Klyro connects flexibly across HubSpot, Slack, Notion, and Linear.',
      'No local-first private processing option.'
    ],
    trapQuestion: 'How long has your team spent configuring Einstein, and do your reps actually log into it daily?'
  },
  hubspot: {
    id: 'hubspot',
    category: 'competitor',
    trigger: 'hubspot',
    title: 'HubSpot Breeze / AI Comparison',
    keyPoints: [
      'HubSpot native AI lacks in-call live coaching and real-time desktop screen context.',
      'Klyro integrates directly with HubSpot via MCP / Webhooks while providing real-time in-meeting guidance.',
      'Works seamlessly across multiple apps instead of locking reps into one web interface.'
    ],
    trapQuestion: 'Do your reps find HubSpot AI helpful during the actual live call, or only after the call ends?'
  }
}

/** Pre-configured high-leverage objection battlecards. */
export const OBJECTION_BATTLECARDS: Battlecard[] = [
  {
    id: 'obj_pricing',
    category: 'pricing',
    trigger: 'pricing_budget',
    title: 'Budget / Pricing Objection',
    keyPoints: [
      'Focus on ROI: reps save 8–10 hours per week on post-call CRM logging, paying for the license in the first week.',
      'Offer phased rollout: start with high-velocity reps first, prove the win-rate increase, then expand.',
      'Highlight zero-bot architecture: saves money by eliminating separate transcription and CRM sync tools.'
    ],
    trapQuestion: 'If this saves your team 8 hours of manual CRM logging per rep every week, what is the cost of not doing it?'
  },
  {
    id: 'obj_security',
    category: 'security',
    trigger: 'security_compliance',
    title: 'Security & Privacy Roadblock',
    keyPoints: [
      'Local-first client-side architecture: zero audio is stored on external bot servers.',
      'Airgap mode support: can operate using local on-device models (Ollama/LM Studio) with zero internet traffic.',
      'Full compliance: no recording bot joins the call, protecting customer confidentiality.'
    ],
    trapQuestion: 'Would your security team prefer a local-first solution where audio never touches a third-party recording bot?'
  },
  {
    id: 'obj_timing',
    category: 'timing',
    trigger: 'timing_delay',
    title: 'Timing / "Next Quarter" Objection',
    keyPoints: [
      'De-risk deployment: setup takes under 5 minutes with zero IT infrastructure changes.',
      'Immediate impact: reps start saving time on their very next call today.',
      'Lock in current pricing tier before upcoming enterprise rate increases.'
    ],
    trapQuestion: 'Between now and next quarter, how many hours will your team lose to manual note-taking and missed action items?'
  },
  {
    id: 'obj_integration',
    category: 'integration',
    trigger: 'integration_stack',
    title: 'Integration / Stack Compatibility',
    keyPoints: [
      'Universal MCP (Model Context Protocol) support connects directly to HubSpot, Salesforce, Linear, Slack, and Notion.',
      'Webhooks support allows instant dispatch to any internal webhook endpoint or CRM.',
      'Works over any meeting platform (Zoom, Google Meet, Microsoft Teams, Slack Huddle) without plugins.'
    ],
    trapQuestion: 'Which CRM or project management tools does your team use most frequently for post-meeting workflows?'
  }
]

/** Trigger regex patterns for detection in live speech. */
const COMPETITOR_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'gong', regex: /\b(?:gong(?:\.io)?)\b/i },
  { name: 'fireflies', regex: /\b(?:fireflies(?:\.ai)?)\b/i },
  { name: 'otter', regex: /\b(?:otter(?:\.ai)?)\b/i },
  { name: 'salesforce', regex: /\b(?:salesforce|einstein)\b/i },
  { name: 'hubspot', regex: /\b(?:hubspot|breeze)\b/i }
]

const OBJECTION_PATTERNS: Array<{ id: string; regex: RegExp }> = [
  {
    id: 'obj_pricing',
    regex: /\b(?:too expensive|high price|pricing is high|budget constraint|no budget|out of our budget|cheaper alternative|cost too much|cannot afford)\b/i
  },
  {
    id: 'obj_security',
    regex: /\b(?:security concern|compliance issue|soc\s*2|data privacy|data leak|on-premise|where is data stored|gdpr|confidentiality)\b/i
  },
  {
    id: 'obj_timing',
    regex: /\b(?:not right now|next quarter|too busy|bad timing|circle back in|revisit this later|follow up in a few months|table this)\b/i
  },
  {
    id: 'obj_integration',
    regex: /\b(?:does it integrate|integrate with|connect to our crm|work with salesforce|work with hubspot|api support|sync to jira)\b/i
  }
]

/**
 * Scans a transcript string or recent utterances for competitor mentions
 * or sales objections, returning the most relevant Battlecard.
 */
export function detectBattlecard(text: string): DetectedBattlecardMatch | null {
  if (!text || text.trim().length < 4) return null

  // 1. Check competitor mentions first
  for (const { name, regex } of COMPETITOR_PATTERNS) {
    const match = regex.exec(text)
    if (match) {
      const card = COMPETITOR_BATTLECARDS[name]
      if (card) {
        return {
          battlecard: card,
          matchedPhrase: match[0],
          timestamp: Date.now()
        }
      }
    }
  }

  // 2. Check objection patterns
  for (const { id, regex } of OBJECTION_PATTERNS) {
    const match = regex.exec(text)
    if (match) {
      const card = OBJECTION_BATTLECARDS.find((c) => c.id === id)
      if (card) {
        return {
          battlecard: card,
          matchedPhrase: match[0],
          timestamp: Date.now()
        }
      }
    }
  }

  return null
}

