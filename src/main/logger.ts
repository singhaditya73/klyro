type Level = 'debug' | 'info' | 'warn' | 'error'

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const min = (process.env.KLYRO_LOG_LEVEL as Level | undefined) ?? 'info'

/**
 * Patterns that look like credentials. Logs are the easiest place to leak a
 * secret by accident, so every logged string is scrubbed before it is printed.
 */
const SECRET_PATTERNS: { pattern: RegExp; replace: string }[] = [
  { pattern: /sk-ant-[A-Za-z0-9_-]{10,}/g, replace: 'sk-ant-***' },
  { pattern: /sk-[A-Za-z0-9_-]{16,}/g, replace: 'sk-***' },
  { pattern: /ghp_[A-Za-z0-9]{20,}/g, replace: 'ghp_***' },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/g, replace: 'github_pat_***' },
  { pattern: /gho_[A-Za-z0-9]{20,}/g, replace: 'gho_***' },
  { pattern: /AIza[0-9A-Za-z_-]{20,}/g, replace: 'AIza***' },
  { pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replace: 'xox*-***' },
  { pattern: /(bearer\s+)[A-Za-z0-9._-]{12,}/gi, replace: '$1***' },
  { pattern: /((?:api[_-]?key|token|secret|password)["'\s:=]+)[^\s"'&,]{8,}/gi, replace: '$1***' }
]

export function redactString(input: string): string {
  let output = input
  for (const { pattern, replace } of SECRET_PATTERNS) output = output.replace(pattern, replace)
  return output
}

/** Recursively scrub strings in a log value without touching its shape. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return value
  if (typeof value === 'string') return redactString(value)
  if (value instanceof Error) {
    const copy = new Error(redactString(value.message))
    copy.name = value.name
    return copy
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = redact(item, depth + 1)
    return out
  }
  return value
}

function emit(level: Level, args: unknown[]): void {
  if (order[level] < order[min]) return
  const method = level === 'debug' ? 'log' : level
  const safe = args.map((arg) => redact(arg))
  // eslint-disable-next-line no-console
  console[method](`[klyro:${level}]`, ...safe)
}

export const logger = {
  debug: (...args: unknown[]) => emit('debug', args),
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args)
}
