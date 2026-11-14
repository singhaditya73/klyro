/**
 * Real-Time Streaming Commitment & Action-Item Detector
 *
 * Scans live meeting transcript utterances as they are spoken, detecting
 * commitments, tasks, assignees, and deadlines with zero latency and zero
 * external model overhead.
 */

export interface DetectedActionItem {
  id: string
  task: string
  owner: string
  deadline?: string
  category: 'technical' | 'commercial' | 'follow_up' | 'decision'
  rawText: string
  detectedAt: number
}

// Common deadline time phrases
const DEADLINE_REGEX =
  /\b(?:by\s+(?:the\s+)?(?:end\s+of\s+(?:the\s+)?day|eod|tomorrow(?:\s+morning|\s+afternoon|\s+evening)?|tonight|next\s+week|next\s+month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm)?)|before\s+(?:the\s+)?(?:release|launch|call|sync|meeting|end\s+of\s+the\s+week|eod|weekend)|next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday)|tomorrow(?:\s+morning|\s+afternoon|\s+evening)?|in\s+(?:\d+|a\s+few|two|three)\s+(?:days|weeks|hours)|this\s+(?:afternoon|evening|friday|weekend))\b/i

// First-person promises: "I will deploy the fix by tomorrow"
const FIRST_PERSON_PROMISE =
  /\b(?:i\s+will|i'll|i\s+can|i'm\s+going\s+to|i\s+plan\s+to|i'll\s+take\s+care\s+of|i\s+will\s+take\s+care\s+of|i'll\s+make\s+sure\s+to|let\s+me)\s+([a-z0-9_ \-,.]+)/i

// Second-person assignments: "Alex, can you review the PR by Friday?"
const SECOND_PERSON_REQUEST =
  /(?:^|\s*)([A-Z][a-z]+)[,\s]+(?:can\s+you|could\s+you|please|will\s+you|to)\s+([a-z0-9_ \-,.]+)/i

// Collaborative commitments: "Let's schedule a follow-up by Friday"
const COLLABORATIVE_ACTION =
  /\b(?:let's|lets|we\s+should|we\s+need\s+to|we\s+must|we'll|we\s+will)\s+([a-z0-9_ \-,.]+)/i

/**
 * Classifies an action item task into technical, commercial, follow-up, or decision.
 */
export function inferCommitmentCategory(
  task: string
): 'technical' | 'commercial' | 'follow_up' | 'decision' {
  const lower = task.toLowerCase()
  if (
    /\b(?:email|mail|call|sync|meet|calendar|schedule|invite|follow\s*up|ping|slack|message|chat|reach\s*out|touch\s*base)\b/.test(
      lower
    )
  ) {
    return 'follow_up'
  }
  if (
    /\b(?:code|bug|deploy|fix|api|sdk|pr|git|test|migration|server|database|schema|frontend|backend|build|script|endpoint|docker|k8s|kubernetes|aws|infra|performance|refactor|ci|cd)\b/.test(
      lower
    )
  ) {
    return 'technical'
  }
  if (
    /\b(?:pricing|price|cost|budget|deal|contract|client|customer|sales|proposal|quote|invoice|payment|tier|license|arr|mrr|acv)\b/.test(
      lower
    )
  ) {
    return 'commercial'
  }
  return 'decision'
}

/**
 * Cleans extracted task string: trims trailing punctuation, cuts off filler phrases.
 */
function cleanTaskString(raw: string): string {
  let cleaned = raw.trim()
  // Strip trailing punctuation
  cleaned = cleaned.replace(/[.?!,;:]+$/, '').trim()
  // If a deadline match exists inside the phrase, we leave the action verb clean
  const deadlineMatch = DEADLINE_REGEX.exec(cleaned)
  if (deadlineMatch && deadlineMatch.index > 5) {
    cleaned = cleaned.slice(0, deadlineMatch.index).trim()
  }
  // Capitalize first character
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  }
  return cleaned
}

/**
 * Detects whether a spoken transcript line contains an actionable commitment.
 *
 * @param line The raw transcript text heard.
 * @param speakerLabel The speaker attributed to this line (e.g. "You", "Speaker 1", "Alex").
 * @returns DetectedActionItem or null if no commitment was made.
 */
export function detectLiveActionItem(
  line: string,
  speakerLabel: string = 'You'
): DetectedActionItem | null {
  if (!line || line.length < 10) return null

  // Ignore simple questions (questions are rarely commitments: "Should we do X?")
  if (/\?\s*$/.test(line.trim()) && !/\b(?:can\s+you|could\s+you)\b/i.test(line)) {
    return null
  }

  // Extract deadline if present
  const deadlineMatch = DEADLINE_REGEX.exec(line)
  const deadline = deadlineMatch ? deadlineMatch[0].trim() : undefined

  let task: string | null = null
  let owner = speakerLabel

  // Check 1: Second-person request ("Aditya, can you review the pull request?")
  const reqMatch = SECOND_PERSON_REQUEST.exec(line)
  if (reqMatch && reqMatch[1] && reqMatch[2]) {
    const candidateName = reqMatch[1].trim()
    // Guard against common question words
    if (!/^(When|Where|Why|What|How|If|Is|Are|Could|Can|Would|Should)$/i.test(candidateName)) {
      owner = candidateName
      task = cleanTaskString(reqMatch[2])
    }
  }

  // Check 2: First-person promise ("I'll deploy the updated schema by Friday")
  if (!task) {
    const firstMatch = FIRST_PERSON_PROMISE.exec(line)
    if (firstMatch && firstMatch[1]) {
      owner = speakerLabel === 'You' || speakerLabel === 'you' ? 'You' : speakerLabel
      task = cleanTaskString(firstMatch[1])
    }
  }

  // Check 3: Collaborative action ("Let's schedule a review on Monday")
  if (!task) {
    const collabMatch = COLLABORATIVE_ACTION.exec(line)
    if (collabMatch && collabMatch[1]) {
      // Only treat collaborative statements as action items if they have an actionable verb or deadline
      const candidate = collabMatch[1].trim()
      const hasActionVerb =
        /\b(?:schedule|sync|meet|review|finalize|merge|deploy|fix|address|investigate|test|write|create|send)\b/i.test(
          candidate
        )
      if (hasActionVerb || deadline) {
        owner = 'Team'
        task = cleanTaskString(candidate)
      }
    }
  }

  if (!task || task.length < 5 || task.length > 140) {
    return null
  }

  const category = inferCommitmentCategory(task + (deadline ? ` ${deadline}` : ''))

  return {
    id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    task,
    owner,
    deadline,
    category,
    rawText: line,
    detectedAt: Date.now()
  }
}
