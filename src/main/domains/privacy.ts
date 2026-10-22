import type { DataScope, DataSummary } from '@shared/types'
import { secrets } from '../security/secrets'
import { conversations } from './conversations'
import { documents } from './documents'
import { maintenance } from './maintenance'
import { memory } from './memory'
import { settingsDomain } from './settings'
import { interviews } from './interviews'

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
 * and `clear(scope)` to delete it.
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
      interviews: interviews.storedCount(),
      ephemeralInterviews: interviews.ephemeralCount(),
      meetings: 0,
      agentTasks: 0,
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
      case 'meetings':
        // "Meetings" is the interview history: the transcripts, the questions
        // and the answers.
        interviews.clear()
        break
      case 'agentTasks':
        // Nothing of this is kept any more.
        break
      default:
        throw new Error('Unknown data scope')
    }
    return this.summary()
  }
}

export const privacy = new PrivacyDomain()
