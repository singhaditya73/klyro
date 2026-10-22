import { useCallback, useEffect, useState } from 'react'
import type { ProviderId } from '@shared/types'

/**
 * Whether the local providers are actually answering.
 *
 * A scan of the usual ports finds the services Klyro knows about, but a user
 * can point a provider at any address. Asking the provider itself is the
 * honest answer, so the interface can say "running" only when the server
 * replied — never because a port looked open.
 */

export type ProviderHealth = 'ok' | 'down' | 'unknown'

/** The providers that run on this machine and can be asked. */
const ASKABLE: ProviderId[] = ['ollama', 'openai-compatible', 'opencode']

export function useProviderHealth(baseUrls: Partial<Record<ProviderId, string>>): {
  health: Partial<Record<ProviderId, ProviderHealth>>
  refresh: () => void
} {
  const [health, setHealth] = useState<Partial<Record<ProviderId, ProviderHealth>>>({})

  const refresh = useCallback((): void => {
    const entries = ASKABLE.filter((id) => (baseUrls[id] ?? '').trim().length > 0)
    if (entries.length === 0) {
      setHealth({})
      return
    }
    void Promise.all(
      entries.map(async (id) => {
        try {
          const result = await window.klyro.providerModels(id)
          return [id, result.models.length > 0 ? ('ok' as const) : ('down' as const)] as const
        } catch {
          return [id, 'down' as const] as const
        }
      })
    ).then((results) => {
      setHealth(Object.fromEntries(results))
    })
  }, [baseUrls])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { health, refresh }
}
