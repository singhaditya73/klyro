type Level = 'debug' | 'info' | 'warn' | 'error'

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const min = (process.env.KLYRO_LOG_LEVEL as Level | undefined) ?? 'info'

function emit(level: Level, args: unknown[]): void {
  if (order[level] < order[min]) return
  const method = level === 'debug' ? 'log' : level
  // eslint-disable-next-line no-console
  console[method](`[klyro:${level}]`, ...args)
}

export const logger = {
  debug: (...args: unknown[]) => emit('debug', args),
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args)
}
