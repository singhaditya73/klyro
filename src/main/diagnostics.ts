import { app } from 'electron'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { CrashReport } from '@shared/types'
import { logger, redactString } from './logger'
import { settingsDomain } from './domains/settings'

/**
 * Opt-in crash/diagnostics capture (Phase J2).
 *
 * Honesty rules:
 *  - With reporting OFF (the default), crashes are logged and shown in the UI
 *    but **nothing is stored** beyond Klyro's own log, and nothing is sent.
 *  - With reporting ON, reports are written locally to
 *    `userData/diagnostics/` so the user can read what Klyro stored. They are
 *    only sent anywhere if an explicit endpoint is configured via the
 *    `KLYRO_DIAGNOSTICS_URL` environment variable; a failed delivery keeps the
 *    report locally — nothing is dropped silently.
 *  - Report content is redacted and never includes API keys or credential
 *    material.
 */

const MAX_REPORTS = 20
const MAX_STACK = 6000

let dir: string | null = null

/** Redacts secrets and trims stack text; a stack never becomes a UID leak. */
function safeStack(stack: unknown): string | undefined {
  if (typeof stack !== 'string' || !stack.trim()) return undefined
  return redactString(stack.replace(/\s+/g, ' ')).slice(0, MAX_STACK)
}

function reportDir(): string {
  dir ??= join(app.getPath('userData'), 'diagnostics')
  return dir
}

export function diagnosticsEnabled(): boolean {
  return settingsDomain.get().diagnosticsOptIn === true
}

async function maybeDeliver(report: CrashReport): Promise<void> {
  const url = process.env.KLYRO_DIAGNOSTICS_URL
  if (!url) return
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) {
      logger.warn(`Diagnostics endpoint rejected the report (HTTP ${response.status}); kept locally.`)
    }
  } catch (error) {
    logger.warn(`Could not deliver crash report; kept locally. ${(error as Error).message}`)
  }
}

async function store(kind: CrashReport['kind'], error: { message: unknown; stack?: unknown }): Promise<void> {
  const report: CrashReport = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    message: redactString(String(error.message ?? '')).slice(0, 1000),
    stack: safeStack(error.stack),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    session: process.env.XDG_SESSION_TYPE ?? null
  }

  await mkdir(reportDir(), { recursive: true })
  await writeFile(join(reportDir(), `${report.at.replace(/[:.]/g, '-')}-${report.id.slice(0, 8)}.json`), JSON.stringify(report, null, 2))
  await prune()
  void maybeDeliver(report)
}

async function prune(): Promise<void> {
  try {
    const files = (await readdir(reportDir())).filter((name) => name.endsWith('.json')).sort()
    if (files.length <= MAX_REPORTS) return
    for (const name of files.slice(0, files.length - MAX_REPORTS)) {
      await rm(join(reportDir(), name), { force: true })
    }
  } catch (error) {
    logger.warn(`Could not prune diagnostics: ${(error as Error).message}`)
  }
}

/** Called for a genuine crash. Stores only when the user opted in. */
export async function captureCrash(kind: CrashReport['kind'], error: { message: unknown; stack?: unknown }): Promise<void> {
  if (!diagnosticsEnabled()) return
  try {
    await store(kind, error)
  } catch (cause) {
    logger.warn(`Could not store crash report: ${(cause as Error).message}`)
  }
}

/** Attach process-level hooks once, at app startup. */
export function initialiseDiagnostics(): void {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception in main', error)
    captureCrash('main-crash', error)
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection in main', reason)
    captureCrash('unhandled-rejection', reason instanceof Error ? reason : { message: String(reason) })
  })
}

/** Saved reports for the Settings view; empty with reporting off. */
export async function listReports(): Promise<CrashReport[]> {
  try {
    const files = (await readdir(reportDir())).filter((name) => name.endsWith('.json')).sort().reverse()
    const reports: CrashReport[] = []
    for (const name of files) {
      try {
        reports.push(JSON.parse(await readFile(join(reportDir(), name), 'utf8')) as CrashReport)
      } catch {
        // Skip unreadable files; pruning removes them on the next write.
      }
    }
    return reports
  } catch {
    // No directory (reporting never enabled) → no reports.
    return []
  }
}

export async function clearReports(): Promise<void> {
  await rm(reportDir(), { recursive: true, force: true })
}

export const diagnostics = {
  capture: captureCrash,
  init: initialiseDiagnostics,
  list: listReports,
  clear: clearReports,
  enabled: diagnosticsEnabled
}
