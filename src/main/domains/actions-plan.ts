import type { ActionProposal } from '@shared/types'
import { wrapUntrusted } from '../security/untrusted'

/**
 * Pure helpers for the post-meeting action agent, split out of actions.ts so
 * proposal parsing is testable without spawning the provider/setting stacks.
 */

export const MAX_TERMINAL_ITEMS = 20

/** Pull the first JSON array out of a model response that may include prose. */
export function extractProposals(text: string): ActionProposal[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end <= start) throw new Error('The planner did not return a proposal list.')
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1))
  } catch {
    throw new Error('The planner did not return a proposal list.')
  }
  if (!Array.isArray(parsed)) throw new Error('The planner did not return a proposal list.')
  const proposals: ActionProposal[] = []
  for (const raw of parsed.slice(0, MAX_TERMINAL_ITEMS)) {
    if (typeof raw !== 'object' || raw === null) continue
    const record = raw as Record<string, unknown>
    const kind = record.kind === 'github-issue' ? 'github-issue' : 'manual'
    const title = String(record.title ?? '').trim().slice(0, 200)
    if (!title) continue
    proposals.push({
      kind,
      repo: kind === 'github-issue' ? String(record.repo ?? '').trim() || null : null,
      title,
      body: String(record.body ?? '').trim().slice(0, 12000),
      reason: String(record.reason ?? '').trim().slice(0, 300)
    })
  }
  if (proposals.length === 0) throw new Error('The planner returned no usable proposals.')
  return proposals
}

/** Issue body sent to GitHub: framed with its meeting origin. */
export function meetingNoteBody(meetingTitle: string, proposal: ActionProposal): string {
  return [
    `From Klyro meeting **${meetingTitle}**:`,
    '',
    proposal.body || proposal.title,
    proposal.reason ? `\n_Why: ${proposal.reason}_` : ''
  ].filter(Boolean).join('\n').slice(0, 12000)
}

/** Wrap untrusted meeting text before it reaches the planner prompt. */
export function untrustedText(label: string, text: string): string {
  return wrapUntrusted(label, text)
}
