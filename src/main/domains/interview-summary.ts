import type { InterviewSession } from '@shared/types'
import { getProvider } from '../providers'
import { settingsDomain } from './settings'
import { logger } from '../logger'

/**
 * The summary of an interview.
 *
 * The model that answers the questions writes this too, so the summary and the
 * answers sound like the same assistant. The questions and their answers go
 * in; what comes out is what the user would write down afterwards.
 */
export async function summarizeInterview(session: InterviewSession): Promise<{ summary: string; model: string } | null> {
  const settings = settingsDomain.get()
  const providerId = settings.activeProvider
  const provider = getProvider(providerId)
  const model = (settings.providers[providerId]?.model ?? '').trim()
  if (!model) return null

  const lines: string[] = []
  for (const question of session.questions) {
    lines.push(`Q: ${question.text}`)
    if (question.answer.trim()) lines.push(`A: ${question.answer.trim()}`)
  }
  if (lines.length === 0) return null

  const prompt = [
    'These are the questions asked in an interview, and the answers that were given.',
    '',
    lines.join('\n'),
    '',
    'Write the interview summary the candidate would want to keep:',
    '1. A short paragraph on how the interview went.',
    '2. The questions that came up, grouped by theme.',
    '3. What to prepare better next time.',
    '',
    'Be concrete and plain. No headings longer than a few words.'
  ].join('\n')

  const chunks: string[] = []
  try {
    for await (const chunk of provider.chat({
      model,
      baseUrl: settings.providers[providerId]?.baseUrl ?? '',
      apiKey: settingsDomain.apiKey(providerId),
      system: 'You write short, plain interview summaries. No praise, no filler.',
      turns: [{ role: 'user', text: prompt }]
    })) {
      chunks.push(chunk)
    }
  } catch (error) {
    logger.warn('The interview summary failed', (error as Error).message)
    return null
  }
  const summary = chunks.join('').trim()
  if (!summary) return null
  return { summary, model }
}
