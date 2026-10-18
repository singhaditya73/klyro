/** Integration sub-system (Phase G1). IPC talks only to the registry surface. */
import type { IntegrationId, IntegrationStatus } from '@shared/types'
import { integrationStatuses, testIntegration } from './registry'
import { github } from './github'

export { github }
export { integrationStatuses }
export async function integrationTest(id: IntegrationId): Promise<IntegrationStatus[]> {
  return testIntegration(id)
}

export type { IntegrationStatus, IntegrationId }
