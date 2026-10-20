import { spawn } from 'node:child_process'

/**
 * Shared runner for local agent CLIs.
 *
 * Claude Code, Codex and others all answer a headless prompt on stdout. This
 * runs one of them, hands every output line to a parser, and yields the text
 * the parser extracts — so each provider only has to describe its own format.
 */

export interface CliAgentOptions {
  binary: string
  args: string[]
  /** Parse one line of output; return the text to stream, or null. */
  parseLine?: (line: string) => string | null
  /** When there is no line format, the whole stdout is the answer. */
  plain?: boolean
  signal?: AbortSignal
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

export class CliAgentError extends Error {
  constructor(
    message: string,
    readonly stderr: string
  ) {
    super(message)
  }
}

export async function* runCliAgent(options: CliAgentOptions): AsyncGenerator<string, void, unknown> {
  const { binary, args, parseLine, plain, signal, timeoutMs = 180000 } = options
  const command = process.platform === 'win32' ? `"${binary}"` : binary
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: options.env ?? process.env,
    windowsHide: true,
    shell: process.platform === 'win32'
  })

  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let stdout = ''
  let stderr = ''
  const queue: string[] = []
  let wake: (() => void) | null = null
  const push = (value: string): void => {
    queue.push(value)
    wake?.()
  }

  let buffer = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    stdout += text
    if (!parseLine) return
    buffer += text
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      const parsed = parseLine(line)
      if (parsed) push(parsed)
      index = buffer.indexOf('\n')
    }
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })

  let spawnError: string | null = null
  child.on('error', (error) => {
    spawnError = `Could not start ${binary}: ${error.message}`
    wake?.()
  })
  child.on('close', (code) => {
    if (code !== 0 && !spawnError) {
      spawnError = stderr.trim() || `${binary} exited with code ${code}.`
    }
    wake?.()
  })

  try {
    for (;;) {
      while (queue.length > 0) {
        const chunk = queue.shift()
        if (chunk) yield chunk
      }
      if (spawnError) throw new CliAgentError(spawnError, stderr)
      if (child.exitCode !== null) {
        // Let the last lines be parsed.
        await new Promise((resolve) => setTimeout(resolve, 60))
        while (queue.length > 0) {
          const chunk = queue.shift()
          if (chunk) yield chunk
        }
        if (plain) {
          const text = stdout.trim()
          if (text) yield text
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
    signal?.removeEventListener('abort', onAbort)
    if (child.exitCode === null) {
      try {
        child.kill()
      } catch {
        // Already gone.
      }
    }
  }
}
