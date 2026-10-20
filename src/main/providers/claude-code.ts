import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProviderTestResult } from '@shared/types'
import type { ChatOptions, ChatTurn, Provider, TestOptions } from './types'
import { describeFailure, ProviderError } from './errors'

const PROVIDER = 'claude-code'

/**
 * Claude Code, as a local provider.
 *
 * Claude Code is a coding agent that runs on the user's machine and is signed
 * in to their Claude subscription. Its print mode (`claude -p`) is a
 * documented headless interface that streams JSON, so Klyro can ask it a
 * question the same way it asks a provider API — and the user needs no API
 * key, because the answer is billed to the subscription they already have.
 *
 * This is the same idea as the OpenCode provider: talk to the agent the user
 * already runs, on their machine, over a local process.
 */

const REQUEST_TIMEOUT_MS = 180000

interface ClaudeEvent {
  type?: string
  subtype?: string
  message?: { content?: Array<{ type?: string; text?: string }> }
  result?: string
  is_error?: boolean
  error?: string
  session_id?: string
  model?: string
  apiKeySource?: string
}

/** Where a Claude Code binary usually lives. */
function candidateBinaries(): string[] {
  const home = homedir()
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    return [
      join(appData, 'npm', 'claude.cmd'),
      join(appData, 'npm', 'claude.exe'),
      join(home, '.local', 'bin', 'claude.exe'),
      join(home, '.claude', 'local', 'claude.exe')
    ]
  }
  return [
    join(home, '.local', 'bin', 'claude'),
    join(home, '.claude', 'local', 'claude'),
    join(home, '.bun', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    '/usr/bin/claude'
  ]
}

/** Is Claude Code installed? */
export function findClaudeBinary(): string | null {
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude']
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

/** Our chat turns become one prompt for the CLI. */
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

/** The text of a Claude assistant message. */
function textOf(message: ClaudeEvent): string {
  return (message.message?.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('')
}

export const claudeCodeProvider: Provider = {
  id: 'claude-code',

  async test(options: TestOptions): Promise<ProviderTestResult> {
    const started = Date.now()
    const binary = findClaudeBinary()
    if (!binary) {
      return {
        ok: false,
        detail: 'Claude Code is not installed on this machine. Install it (npm i -g @anthropic-ai/claude-code) and try again.'
      }
    }
    try {
      // A tiny prompt proves the whole chain: the CLI runs and it is signed in.
      const chunks: string[] = []
      for await (const chunk of claudeCodeProvider.chat({
        model: options.model,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
        turns: [{ role: 'user', text: 'Reply with exactly: OK' }]
      })) {
        chunks.push(chunk)
      }
      const answer = chunks.join('').trim()
      if (!answer) {
        return { ok: false, detail: 'Claude Code ran but said nothing. Run "claude" in a terminal and use /login.' }
      }
      return {
        ok: true,
        detail: `Claude Code answered through your own Claude subscription (${answer.slice(0, 40)}). No API key needed.`,
        latencyMs: Date.now() - started
      }
    } catch (error) {
      return { ok: false, detail: describeFailure(error) }
    }
  },

  async *chat(options: ChatOptions): AsyncGenerator<string, void, unknown> {
    const binary = findClaudeBinary()
    if (!binary) {
      throw new ProviderError('Claude Code is not installed on this machine.', {
        kind: 'bad_request',
        provider: PROVIDER
      })
    }
    const prompt = turnsToPrompt(options.turns)
    if (!prompt.trim()) return

    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose']
    if (options.model && options.model.trim()) args.push('--model', options.model.trim())

    const command = process.platform === 'win32' ? `"${binary}"` : binary
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
      shell: process.platform === 'win32'
    })

    const controller = new AbortController()
    const onAbort = (): void => controller.abort()
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    let stdoutBuffer = ''
    let stderr = ''
    let delivered = ''
    // A holder object: TypeScript cannot see mutations made inside callbacks,
    // so a plain `let` would be narrowed to `never` inside the read loop.
    const state: { failure: string | null } = { failure: null }
    const fail = (message: string): void => {
      state.failure = message
      finish()
    }
    const queue: string[] = []
    let wake: (() => void) | null = null
    const push = (value: string): void => {
      queue.push(value)
      wake?.()
    }
    const finish = (): void => {
      wake?.()
    }

    const consume = (line: string): void => {
      const trimmed = line.trim()
      if (!trimmed) return
      let event: ClaudeEvent
      try {
        event = JSON.parse(trimmed) as ClaudeEvent
      } catch {
        return
      }
      if (event.type === 'assistant') {
        const text = textOf(event)
        if (text.length > delivered.length) {
          push(text.slice(delivered.length))
          delivered = text
        }
        return
      }
      if (event.type === 'result') {
        const text = typeof event.result === 'string' ? event.result : ''
        if (event.is_error) {
          fail(text || 'Claude Code reported an error.')
          return
        }
        if (text.length > delivered.length) {
          push(text.slice(delivered.length))
          delivered = text
        }
        finish()
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      let index = stdoutBuffer.indexOf('\n')
      while (index !== -1) {
        const line = stdoutBuffer.slice(0, index)
        stdoutBuffer = stdoutBuffer.slice(index + 1)
        consume(line)
        index = stdoutBuffer.indexOf('\n')
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      fail(`Could not start Claude Code: ${error.message}`)
    })
    child.on('close', (code) => {
      if (code !== 0 && !state.failure) {
        fail(stderr.trim() || `Claude Code exited with code ${code}.`)
        return
      }
      finish()
    })

    try {
      for (;;) {
        while (queue.length > 0) {
          const chunk = queue.shift()
          if (chunk) yield chunk
        }
        if (state.failure) {
          throw new ProviderError(state.failure.slice(0, 500), { kind: 'bad_request', provider: PROVIDER })
        }
        if (child.exitCode !== null) {
          // Give the last queued chunks a chance to be read.
          await new Promise((resolve) => setTimeout(resolve, 60))
          while (queue.length > 0) {
            const chunk = queue.shift()
            if (chunk) yield chunk
          }
          if (delivered.length === 0) {
            throw new ProviderError(
              'Claude Code did not answer. Run "claude" in a terminal and use /login, then try again.',
              { kind: 'auth', provider: PROVIDER }
            )
          }
          return
        }
        await new Promise<void>((resolve) => {
          wake = () => {
            wake = null
            resolve()
          }
        })
      }
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (child.exitCode === null) {
        try {
          child.kill()
        } catch {
          // Already gone.
        }
      }
    }
  }
}
