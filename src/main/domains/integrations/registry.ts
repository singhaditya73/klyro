import type { IntegrationId } from '@shared/types'
import type { IntegrationClient, IntegrationState, IntegrationTestResult } from './contract'
import { github } from './github'

/**
 * Integration registry (Phase G1). The one place that knows every connected
 * service; the IPC layer only talks to these functions.
 */
const registry: IntegrationClient[] = [github]

const lastTest = new Map<IntegrationId, IntegrationTestResult>()

function client(id: string): IntegrationClient | null {
  return registry.find((entry) => entry.descriptor.id === id) ?? null
}

export function integrationStatuses(): IntegrationState[] {
  return registry.map((entry) => {
    const status = entry.status()
    return {
      id: entry.descriptor.id,
      label: entry.descriptor.label,
      auth: entry.descriptor.auth,
      summary: entry.descriptor.summary,
      connected: status.connected,
      detail: status.detail,
      test: lastTest.get(entry.descriptor.id) ?? null
    }
  })
}

export async function testIntegration(id: string): Promise<IntegrationState[]> {
  const entry = client(id)
  if (!entry) throw new Error(`Unknown integration: ${id}`)
  let result: IntegrationTestResult
  try {
    result = await entry.selfTest()
  } catch (error) {
    result = { ok: false, detail: (error as Error).message, testedAt: new Date().toISOString() }
  }
  lastTest.set(id as IntegrationId, result)
  return integrationStatuses()
}

export function discardIntegrationTest(id: IntegrationId): void {
  lastTest.delete(id)
}

export function registeredIntegrations(): IntegrationId[] {
  return registry.map((entry) => entry.descriptor.id)
}

export { github }
