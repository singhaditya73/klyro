import type { DataScope, DataSummary } from '@shared/types'
import { secrets } from '../security/secrets'
import { agentRunner } from './agent'
import { conversations } from './conversations'
import { documents } from './documents'
import { maintenance } from './maintenance'
import { meetings } from './meetings'
import { memory } from './memory'
import { project } from './project'
import { settingsDomain } from './settings'

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host.endsWith('.local')
  } catch {
    return false
  }
}

/**
 * Programmatic retention policy. The UI calls `summary()` to show what is stored
 * and `clear(scope)` to delete it. Clearing a scope removes the derived data too
 * (e.g. clearing documents also removes the workspace-derived project files).
 */
class PrivacyDomain {
  summary(): DataSummary {
    const settings = settingsDomain.get()
    const providerId = settings.activeProvider
    const baseUrl = settings.providers[providerId]?.baseUrl ?? ''
    const local = providerId === 'ollama' || (providerId === 'openai-compatible' && isLocalBaseUrl(baseUrl))

    return {
      conversations: conversations.list().length,
      memories: memory.list().length,
      documents: documents.stats().documents,
      projectFiles: documents.statsFor('workspace').files,
      meetings: meetings.list().length,
      agentTasks: agentRunner.tasks().length,
      credentials: secrets.count(),
      activeProvider: providerId,
      activeProviderIsLocal: local,
      storage: maintenance.report()
    }
  }

  clear(scope: DataScope): DataSummary {
    switch (scope) {
      case 'conversations':
        conversations.clear()
        break
      case 'memory':
        memory.clear()
        break
      case 'documents':
        documents.clear()
        break
      case 'project':
        project.clear()
        break
      case 'meetings':
        meetings.clear()
        break
      case 'agentTasks':
        agentRunner.clearTasks()
        break
      default:
        throw new Error('Unknown data scope')
    }
    return this.summary()
  }
}

export const privacy = new PrivacyDomain()
