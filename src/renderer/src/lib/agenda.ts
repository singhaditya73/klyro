/**
 * Meeting Agenda Extraction & Real-Time Discussion Tracker
 *
 * Extracts structured agenda topics from calendar invite descriptions
 * and tracks which agenda items have been discussed based on the live transcript.
 */

export interface AgendaItem {
  id: string
  title: string
  addressed: boolean
  addressedAt?: number
  matchedTerms: string[]
}

/**
 * Extracts distinct agenda items from a calendar event description or title.
 */
export function parseAgendaItems(description?: string, title?: string): AgendaItem[] {
  if (!description && !title) return []

  const items: string[] = []
  const text = (description || '').trim()

  if (text) {
    const lines = text.split(/\r?\n/)
    let inAgendaSection = false

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue

      // Check for agenda section header
      if (/^#*\s*(?:agenda|topics|discussion topics|meeting plan)\s*:?$/i.test(line)) {
        inAgendaSection = true
        continue
      }

      // Check for bulleted or numbered list items
      const bulletMatch = /^(?:[-*•+]|\d+[.)])\s+(.+)$/.exec(line)
      if (bulletMatch && bulletMatch[1]) {
        const itemText = bulletMatch[1].trim()
        if (itemText.length >= 3 && itemText.length <= 120) {
          items.push(itemText)
        }
      } else if (inAgendaSection) {
        // In agenda section, non-empty short lines are treated as topics
        if (line.length >= 3 && line.length <= 100 && !line.startsWith('http')) {
          items.push(line)
        }
      }
    }
  }

  // If no agenda bullets were found in description, fallback to parsing title if informative
  if (items.length === 0 && title) {
    // Look for separators like "Sync: Topic A & Topic B" or "Project X / Architecture"
    const titleParts = title.split(/\s*[:|/-]\s*/).filter(Boolean)
    if (titleParts.length > 1) {
      for (const part of titleParts.slice(1)) {
        const trimmed = part.trim()
        if (trimmed.length > 3 && !/^(sync|meeting|weekly|daily|standup|call)$/i.test(trimmed)) {
          items.push(trimmed)
        }
      }
    }
  }

  return items.slice(0, 8).map((t, idx) => ({
    id: `agenda_${idx + 1}`,
    title: t,
    addressed: false,
    matchedTerms: extractKeywords(t)
  }))
}

/**
 * Extracts searchable keyword tokens (length >= 4) from an agenda title.
 */
function extractKeywords(title: string): string[] {
  const stopWords = new Set([
    'with',
    'from',
    'about',
    'into',
    'over',
    'after',
    'before',
    'review',
    'discuss',
    'meeting',
    'update'
  ])
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !stopWords.has(w))
}

/**
 * Evaluates a new transcript line against unaddressed agenda items.
 * Returns the updated agenda list and any newly addressed item.
 */
export function checkAgendaProgress(
  items: AgendaItem[],
  transcriptLine: string
): { updated: AgendaItem[]; newlyAddressed: AgendaItem | null } {
  if (!items || items.length === 0 || !transcriptLine) {
    return { updated: items, newlyAddressed: null }
  }

  const lowerLine = transcriptLine.toLowerCase()
  let newlyAddressed: AgendaItem | null = null

  const updated = items.map((item) => {
    if (item.addressed) return item

    // Direct substring match
    const lowerTitle = item.title.toLowerCase()
    if (lowerTitle.length > 5 && lowerLine.includes(lowerTitle)) {
      const match = { ...item, addressed: true, addressedAt: Date.now() }
      if (!newlyAddressed) newlyAddressed = match
      return match
    }

    // Keyword match: if at least 2 significant keywords or >=60% of keywords appear in line
    if (item.matchedTerms.length > 0) {
      const matched = item.matchedTerms.filter((term) => lowerLine.includes(term))
      const ratio = matched.length / item.matchedTerms.length
      if ((matched.length >= 2 && ratio >= 0.5) || (item.matchedTerms.length === 1 && matched.length === 1)) {
        const match = { ...item, addressed: true, addressedAt: Date.now() }
        if (!newlyAddressed) newlyAddressed = match
        return match
      }
    }

    return item
  })

  return { updated, newlyAddressed }
}

