import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderTestResult } from '@shared/types'
import type { ChatOptions, ChatTurn, Provider, TestOptions } from './types'
import { describeFailure, ProviderError } from './errors'
import { CliAgentError, runCliAgent } from './cli-agent'

const PROVIDER = 'codex'

/**
 * OpenAI's Codex CLI, as a local provider.
 *
 * `codex exec "prompt"` runs the agent non-interactively with the CLI's own
 * authentication — the ChatGPT login or the API key the user already has — and
 * writes the agent's final message to stdout. That means Klyro can borrow the
 * user's Codex access the same way it borrows OpenCode's and Claude's, with
 * no key of its own.
 *
 * Codex is not installed everywhere, so the provider reports that honestly
 * instead of failing at the first prompt.
 */

function candidateBinaries(): string[] {
  const home = homedir()
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    return [join(appData, 'npm', 'codex.cmd'), join(appData, 'npm', 'codex.exe'), join(home, '.local', 'bin', 'codex.exe')]
  }
  return [
    join(home, '.local', 'bin', 'codex'),
    join(home, '.bun', 'bin', 'codex'),
    join(home, 'npm-global', 'bin', 'codex'),
    '/usr/local/bin/codex',
    '/opt/homebrew/bin/codex',
    '/usr/bin/codex'
  ]
}

/** Is the Codex CLI installed? */
export function findCodexBinary(): string | null {
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat'] : ['codex']
  const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean)
  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  for (const candidate of candidateBinaries()) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function turnsToPrompt(turns: ChatTurn[]): string {
  return turns
    .filter((turn) => turn.role !== 'tool')
    .map((turn) => {
      if (turn.role === 'system') return turn.text
      if (turn.role === 'assistant') return `Assistant (previous turn): ${turn.text}`
      return turn.text
    })
    .join('\n\n')
}

export const codexProvider: Provider = {
  id: 'codex',

  async test(options: TestOptions): Promise<ProviderTestResult> {
    const started = Date.now()
    if (!findCodexBinary()) {
      return {
        ok: false,
        detail: 'The Codex CLI is not installed on this machine. Install it (npm i -g @openai/codex) and try again.'
      }
    }
    try {
      const chunks: string[] = []
      for await (const chunk of codexProvider.chat({
        model: options.model,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        turns: [{ role: 'user', text: 'Reply with exactly: OK' }]
      })) {
        chunks.push(chunk)
      }
      const answer = chunks.join('').trim()
      if (!answer) {
        return { ok: false, detail: 'Codex ran but said nothing. Run "codex login" in a terminal first.' }
      }
      return {
        ok: true,
        detail: `Codex answered through your own login (${answer.slice(0, 40)}). No API key needed.`,
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return { ok: false, detail: describeFailure(error) }
    }
  },

  async *chat(options: ChatOptions): AsyncGenerator<string, void, unknown> {
    const binary = findCodexBinary()
    if (!binary) {
      throw new ProviderError('The Codex CLI is not installed on this machine.', {
        kind: 'bad_request',
        provider: PROVIDER
      })
    }
    const prompt = turnsToPrompt(options.turns)
    if (!prompt.trim()) return

    const args = ['exec', prompt]
    if (options.model && options.model.trim()) args.push('--model', options.model.trim())

    // Codex takes an image as a file on disk, so the picture is written to a
    // temporary file for the length of the call and removed afterwards.
    const images = await writeImages(options.turns)
    try {
      for (const file of images) args.push('--image', file)
      // Codex writes the final agent message to stdout; progress goes to
      // stderr. That keeps the answer reliable without depending on the exact
      // shape of its JSONL event stream.
      yield* runCliAgent({ binary, args, plain: true, signal: options.signal })
    } catch (error) {
      if (error instanceof CliAgentError) {
        throw new ProviderError(error.message.slice(0, 500), { kind: 'bad_request', provider: PROVIDER })
      }
      throw new ProviderError((error as Error).message, { kind: 'bad_request', provider: PROVIDER })
    } finally {
      // The pictures were only ever meant for this call.
      for (const file of images) {
        try {
          rmSync(file, { force: true })
        } catch {
          // A leftover in the temp folder is not worth an error.
        }
      }
    }
  }
}

/**
 * Write the images of the newest turn to temporary files.
 *
 * The Codex CLI takes an image as a path, so the bytes have to be on disk for
 * the length of the call.
 */
async function writeImages(turns: ChatTurn[]): Promise<string[]> {
  const images: string[] = []
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn.role !== 'user' || !turn.images?.length) continue
    for (const [position, image] of turn.images.entries()) {
      const comma = image.dataUrl.indexOf(',')
      const base64 = comma === -1 ? image.dataUrl : image.dataUrl.slice(comma + 1)
      const extension = image.mime.split('/')[1] ?? 'png'
      const file = join(tmpdir(), `klyro-image-${Date.now()}-${position}.${extension}`)
      writeFileSync(file, Buffer.from(base64, 'base64'))
      images.push(file)
    }
    break
  }
  return images
}
