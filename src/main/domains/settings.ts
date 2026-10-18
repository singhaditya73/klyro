import type { AppSettings, ProviderId, ProviderStatus } from '@shared/types'
import { JsonStore } from '../store/json-store'
import { secrets } from '../security/secrets'
import { DEFAULT_PROVIDERS, PROVIDER_IDS, PROVIDER_META } from '../providers/defaults'

export const DEFAULT_SETTINGS: AppSettings = {
  activeProvider: 'openai',
  providers: structuredClone(DEFAULT_PROVIDERS),
  systemPrompt:
    'You are Klyro, a helpful, precise desktop AI assistant. You can see the user\'s screen when they share it. Answer clearly, be accurate, and never claim to have done something you did not do.',
  responseStyle: 'balanced',
  theme: 'system',
  launchAtLogin: false,
  toggleShortcut: 'CommandOrControl+Shift+Space'
}

class SettingsDomain {
  private readonly store = new JsonStore<AppSettings>('settings.json', DEFAULT_SETTINGS)

  get(): AppSettings {
    const current = this.store.get()
    let healed = false
    const providers = { ...current.providers }
    for (const id of PROVIDER_IDS) {
      if (!providers[id]) {
        providers[id] = structuredClone(DEFAULT_PROVIDERS[id])
        healed = true
      }
    }
    if (healed) return this.store.set({ ...current, providers })
    return current
  }

  update(patch: Partial<AppSettings>): AppSettings {
    return this.store.update((draft) => {
      const { providers, ...rest } = patch
      Object.assign(draft, rest)
      if (providers) draft.providers = { ...draft.providers, ...providers }
    })
  }

  provider(id: ProviderId) {
    return this.get().providers[id]
  }

  activeApiKey(): string | null {
    return secrets.get(this.get().activeProvider)
  }

  apiKey(id: ProviderId): string | null {
    return secrets.get(id)
  }

  statuses(): ProviderStatus[] {
    const current = this.get()
    return PROVIDER_IDS.map((id) => ({
      id,
      label: PROVIDER_META[id].label,
      requiresKey: PROVIDER_META[id].requiresKey,
      hasKey: secrets.has(id),
      model: current.providers[id]?.model ?? '',
      baseUrl: current.providers[id]?.baseUrl ?? ''
    }))
  }
}

export const settingsDomain = new SettingsDomain()
