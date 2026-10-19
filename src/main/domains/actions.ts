import type { ActionProposal, MeetingOutput } from '@shared/types'
import { getProvider } from '../providers'
import { resolveRoute } from '../providers/routing'
import { settingsDomain } from './settings'
import { github } from './integrations/github'
import { audit } from './audit'
import { meetings } from './meetings'
import { MAX_TERMINAL_ITEMS, extractProposals, meetingNoteBody, untrustedText } from './actions-plan'

/**
 * The post-meeting action agent: turns a meeting's action items into concrete,
 * reviewed work — each proposal is shown to the user first, and only approved
 * items execute (GitHub issues filed through the integration, full audit
 * trail). This is the "closing the loop" half of meetings: summarise → propose
 * → approve → execute → ledger.
 */

const MAX_REPOS = 40

const PROPOSE_SYSTEM = `You convert meeting action items into concrete work proposals.
Respond with ONLY a JSON array (no prose, no markdown fences). Each element:
{
  "kind": "github-issue" | "manual",
  "repo": "<owner/full-name from the candidate list, or null>",
  "title": "<imperative issue title, max 90 chars>",
  "body": "<issue body: context from the meeting, acceptance criteria, owner hints>",
  "reason": "<one short sentence>"
}
Rules:
- "kind":"github-issue" only when a candidate repo clearly fits the item.
- "kind":"manual" for anything that should be done by hand (vendor calls, people decisions).
- Never invent repos outside the candidate list. Never suggest secrets or tickets you cannot justify from the items.
- At most 20 proposals, at least 1 execution-ready one if the items allow.`

class ActionsDomain {
  async propose(meetingId: string): Promise<{ meetingTitle: string; proposals: ActionProposal[] }> {
    const meeting = meetings.get(meetingId)
    if (!meeting) throw new Error('Meeting not found.')
    if (meeting.actions.length === 0 && !meeting.summary) {
      throw new Error('Summarise the meeting first — proposals need action items to build from.')
    }
    const connected = github.status().connected
    const repos = connected ? await github.repos(MAX_REPOS) : []
    const route = this.route()

    const prompt = [
      `Meeting: ${meeting.title}`,
      meeting.summary ? `Summary:\n${untrustedText('meeting summary', meeting.summary)}` : '',
      `Extracted action items:\n${meeting.actions.map((item, index) => `${index + 1}. ${untrustedText('action item', item)}`).join('\n')}`,
      '',
      connected
        ? `Candidate repos:\n${repos.map((entry) => entry.fullName).join('\n')}`
        : 'No GitHub integration connected: only "manual" proposals are useful unless the user connects GitHub.',
      '',
      'What concrete work items follow? Respond with the JSON array.'
    ].filter(Boolean).join('\n\n')

    const provider = getProvider(route.providerId)
    let text = ''
    for await (const delta of provider.chat({
      model: route.model,
      baseUrl: route.baseUrl,
      apiKey: route.apiKey,
      system: PROPOSE_SYSTEM,
      turns: [{ role: 'user', text: prompt }],
      temperature: 0.1,
      maxTokens: 2000
    })) {
      text += delta
    }
    return { meetingTitle: meeting.title, proposals: extractProposals(text) }
  }

  /** Execute only user-approved proposals; every outcome lands in the ledger. */
  async execute(meetingId: string, proposals: ActionProposal[]): Promise<MeetingOutput[]> {
    const meeting = meetings.get(meetingId)
    if (!meeting) throw new Error('Meeting not found.')
    const outputs: MeetingOutput[] = []
    for (const proposal of proposals.slice(0, MAX_TERMINAL_ITEMS)) {
      if (proposal.kind !== 'github-issue' || !proposal.repo) continue
      try {
        const issue = await github.createIssue(proposal.repo, proposal.title, meetingNoteBody(meeting.title, proposal))
        const output: MeetingOutput = {
          at: Date.now(),
          kind: 'github-issue',
          detail: `${proposal.repo}#${issue.number} ${proposal.title}`,
          url: issue.url ?? null,
          ok: true
        }
        outputs.push(output)
      } catch (error) {
        outputs.push({
          at: Date.now(),
          kind: 'github-issue',
          detail: `${proposal.repo}: ${(error as Error).message}`,
          url: null,
          ok: false
        })
      }
    }
    audit.record('meeting.actions', `Executed ${outputs.filter((entry) => entry.ok).length} action(s) from "${meeting.title}"`)
    if (outputs.length) meetings.addOutputs(meetingId, outputs)
    return outputs
  }

  private route() {
    const settings = settingsDomain.get()
    const providerId = settings.activeProvider
    return resolveRoute({ settings, apiKey: settingsDomain.apiKey(providerId), purpose: 'knowledge' })
  }
}



export const actions = new ActionsDomain()
