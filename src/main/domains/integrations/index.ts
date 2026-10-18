import type { IntegrationStatus } from '@shared/types'
import { github } from './github'

export function integrationStatuses(): IntegrationStatus[] {
  const status = github.status()
  return [{ id: github.id, label: github.label, connected: status.connected, detail: status.detail }]
}

export { github }
