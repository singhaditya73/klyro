/**
 * Pre-Call Attendee & Account Intelligence Engine.
 *
 * Synthesizes calendar attendee profiles, company domains, estimated tech stack,
 * stakeholder personas (Executive, Engineering, Sales, Finance), and historical
 * session notes to arm reps with instant contextual intelligence before calls.
 */

export interface AttendeeProfile {
  raw: string
  name: string
  email?: string
  domain?: string
  rolePersona?: 'executive' | 'engineering' | 'sales_gtm' | 'finance' | 'product' | 'general'
  talkingAngle?: string
}

export interface AccountIntelligence {
  company: string
  domain?: string
  industryEstimate: string
  attendees: AttendeeProfile[]
  techStackClues: string[]
  suggestedDiscoveryQuestions: string[]
  historicalContext?: {
    pastSessionCount: number
    lastMetDate?: string
    keyDecisions: string[]
  }
}

/** Parses raw attendee string like "Alice Smith (alice@stripe.com)" into structured profile. */
export function parseAttendee(raw: string): AttendeeProfile {
  const emailMatch = /<([^>]+)>|\(([^)]+@[^)]+)\)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/.exec(raw)
  const email = emailMatch ? (emailMatch[1] || emailMatch[2] || emailMatch[3])?.trim().toLowerCase() : undefined

  let name = raw
  if (emailMatch) {
    name = raw.replace(emailMatch[0], '').replace(/[()<>[\]]/g, '').trim()
  }
  if (!name && email) {
    name = email.split('@')[0].replace(/[._-]/g, ' ')
    name = name.charAt(0).toUpperCase() + name.slice(1)
  }

  const domain = email ? email.split('@')[1] : undefined

  // Infer persona from name or role hints
  const lower = raw.toLowerCase()
  let rolePersona: AttendeeProfile['rolePersona'] = 'general'
  let talkingAngle = 'Focus on business objectives and seamless team workflow.'

  if (/\b(?:vp|head|director|founder|ceo|coo|chief|president)\b/.test(lower)) {
    rolePersona = 'executive'
    talkingAngle = 'Emphasize high-level business ROI, time-to-value, and executive visibility.'
  } else if (/\b(?:engineer|architect|tech|cto|developer|devops|sre)\b/.test(lower)) {
    rolePersona = 'engineering'
    talkingAngle = 'Highlight local-first architecture, zero bot recording, API/MCP integration, and data privacy.'
  } else if (/\b(?:sales|account exec|ae|sdr|bdr|revops|cro|pipeline)\b/.test(lower)) {
    rolePersona = 'sales_gtm'
    talkingAngle = 'Demonstrate autonomous 1-click CRM dispatch, real-time live battlecards, and 8+ hrs/week time savings.'
  } else if (/\b(?:cfo|finance|procurement|billing)\b/.test(lower)) {
    rolePersona = 'finance'
    talkingAngle = 'Demonstrate rapid payback period, consolidated tooling cost, and predictable per-seat licensing.'
  } else if (/\b(?:product|pm|design|ux)\b/.test(lower)) {
    rolePersona = 'product'
    talkingAngle = 'Focus on end-user frictionless adoption, meeting transcript synthesis, and task export to Linear/Jira.'
  }

  return {
    raw,
    name: name || 'Participant',
    email,
    domain,
    rolePersona,
    talkingAngle
  }
}

/** Generates rich account intelligence from meeting info and previous sessions. */
export function buildAccountIntelligence(params: {
  company: string
  attendees?: string[]
  meetingTitle?: string
  pastSessions?: Array<{
    startedAt: number
    company: string
    crmNotes?: {
      keyDecisions?: string[]
      actionItems?: Array<{ task: string }>
    }
  }>
}): AccountIntelligence {
  const { company, attendees = [], meetingTitle = '', pastSessions = [] } = params
  const parsedAttendees = attendees.map(parseAttendee)

  // Find domain from attendees
  const primaryDomain = parsedAttendees.find((a) => a.domain && !/gmail|yahoo|outlook|hotmail|icloud/.test(a.domain))?.domain

  // Industry estimation
  let industryEstimate = 'B2B Enterprise Software / Technology'
  const cLow = (company + ' ' + meetingTitle + ' ' + (primaryDomain || '')).toLowerCase()
  if (/(?:health|med|clinic|pharma|bio)/.test(cLow)) {
    industryEstimate = 'Healthcare & Life Sciences'
  } else if (/(?:pay|fin|bank|capital|invest|fund|stripe|bill|invoice)/.test(cLow)) {
    industryEstimate = 'Fintech & Financial Services'
  } else if (/(?:shop|store|retail|commerce|brand)/.test(cLow)) {
    industryEstimate = 'E-commerce & Retail Tech'
  } else if (/(?:security|cyber|defense|auth|okta|crowdstrike)/.test(cLow)) {
    industryEstimate = 'Cybersecurity & Compliance'
  }

  // Tech stack clues based on industry and domains
  const techStackClues: string[] = []
  if (primaryDomain) {
    techStackClues.push(`Domain Infrastructure (${primaryDomain})`)
  }
  techStackClues.push('Salesforce / HubSpot CRM')
  techStackClues.push('Slack / Microsoft Teams')
  techStackClues.push('Linear / Jira Issue Tracking')

  // Tailored discovery questions
  const suggestedDiscoveryQuestions = [
    `How does your team currently capture and sync post-meeting action items into ${company}'s CRM?`,
    'Are your prospects receptive to external meeting recording bots, or is privacy a critical priority?',
    'What is your target timeline for streamlining sales productivity and call workflows this quarter?'
  ]

  // Historical memory from previous sessions
  const companyPastSessions = pastSessions.filter(
    (s) => s.company && s.company.toLowerCase() === company.toLowerCase()
  )

  let historicalContext: AccountIntelligence['historicalContext'] = undefined
  if (companyPastSessions.length > 0) {
    const sorted = [...companyPastSessions].sort((a, b) => b.startedAt - a.startedAt)
    const allDecisions = sorted.flatMap((s) => s.crmNotes?.keyDecisions || []).slice(0, 4)
    historicalContext = {
      pastSessionCount: companyPastSessions.length,
      lastMetDate: new Date(sorted[0].startedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      keyDecisions: allDecisions
    }
  }

  return {
    company: company || 'Prospective Account',
    domain: primaryDomain,
    industryEstimate,
    attendees: parsedAttendees,
    techStackClues,
    suggestedDiscoveryQuestions,
    historicalContext
  }
}
