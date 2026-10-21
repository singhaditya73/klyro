import type { ProviderTestResult } from '@shared/types'
import type { ChatOptions, ChatTurn, Provider, TestOptions } from './types'
import { describeFailure, ProviderError } from './errors'
import { antigravity } from '../domains/antigravity'

const PROVIDER = 'antigravity'

/**
 * Antigravity's models, as a Klyro provider.
 *
 * Antigravity (the agent IDE) runs a language server on localhost that serves
 * the models the user's own account reaches. Klyro talks to that service
 * directly — no key, no subscription of our own, and no copy of the user's
 * credentials: the request goes to the service that is already running on the
 * user's machine, exactly like the OpenCode and Claude Code providers talk to
 * their own local agents.
 */
export const antigravityProvider: Provider = {
  id: 'antigravity',

  async test(_options: TestOptions): Promise<ProviderTestResult> {
    const started = Date.now()
    try {
      const status = await antigravity.status()
      if (!status.running) {
        return {
          ok: false,
          detail: status.error ?? 'Antigravity is not running. Open the Antigravity IDE and try again.'
        }
      }
      const models = status.models.length
      return {
        ok: true,
        detail: `Antigravity is running (${status.plan ?? 'signed in'}) with ${models} model${models === 1 ? '' : 's'} available.`,
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return { ok: false, detail: describeFailure(error) }
    }
  },

  async *chat(options: ChatOptions): AsyncGenerator<string, void, unknown> {
    const prompt = options.turns
      .filter((turn) => turn.role !== 'tool')
      .map((turn: ChatTurn) => (turn.role === 'assistant' ? `Assistant: ${turn.text}` : turn.text))
      .join('\n\n')
      .trim()
    if (!prompt) return

    const model = options.model?.trim()
    if (!model) {
      throw new ProviderError(
        'Pick an Antigravity model in Settings (for example the Claude Opus or Gemini entry shown in Integrations).',
        { kind: 'bad_request', provider: PROVIDER }
      )
    }
    const answer = await antigravity.complete(model, prompt)
    if (answer) yield answer
  }
}
