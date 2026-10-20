import type { AppSettings, ProviderId, ProviderStatus } from '@shared/types'
import { JsonStore } from '../store/json-store'
import { secrets } from '../security/secrets'
import { DEFAULT_PROVIDERS, PROVIDER_IDS, PROVIDER_META } from '../providers/defaults'
import { visionSupport } from '../providers/routing'

export const DEFAULT_SETTINGS: AppSettings = {
  activeProvider: 'openai',
  providers: structuredClone(DEFAULT_PROVIDERS),
  systemPrompt:
    'You are Klyro, a helpful, precise desktop AI assistant. You can see the user\'s screen when they share it. Answer clearly, be accurate, and never claim to have done something you did not do.',
  responseStyle: 'balanced',
  theme: 'system',
  launchAtLogin: false,
  toggleShortcut: 'CommandOrControl+Shift+Space',
  agentConfirmConsequential: true,
  agentMaxSteps: 12,
  memoryEnabled: true,
  memoryAutoExtract: false,
  memoryRecallCount: 5,
  knowledgeEnabled: true,
  documentRecallCount: 4,
  allowUnencryptedSecrets: false,
  diagnosticsOptIn: false,
  overlayPrivateMode: false,
  overlayOpacity: 100,
  chatMcpTools: false,
  screenAutoCapture: true,
  screenPreWarm: true,
  overlayDisplay: 'primary',
  overlayAnswerCache: true,
  onboardingComplete: false
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
    if (current.allowUnencryptedSecrets === undefined) {
      // Older settings files predate the plaintext opt-in; default it to "no".
      healed = true
    }
    if (current.diagnosticsOptIn === undefined) {
      // Older settings files predate the diagnostics opt-in; default it to off.
      healed = true
    }
    const result = healed
      ? this.store.set({
          ...current,
          providers,
          allowUnencryptedSecrets: current.allowUnencryptedSecrets ?? false,
          diagnosticsOptIn: current.diagnosticsOptIn ?? false
        })
      : current
    secrets.setPlaintextPolicy(result.allowUnencryptedSecrets)
    return result
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const next = this.store.update((draft) => {
      const { providers, ...rest } = patch
      Object.assign(draft, rest)
      if (providers) draft.providers = { ...draft.providers, ...providers }
    })
    secrets.setPlaintextPolicy(next.allowUnencryptedSecrets)
    return next
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
    return PROVIDER_IDS.map((id) => {
      const model = (current.providers[id]?.model ?? '').trim() || DEFAULT_PROVIDERS[id].model
      return {
        id,
        label: PROVIDER_META[id].label,
        requiresKey: PROVIDER_META[id].requiresKey,
        keyOptional: PROVIDER_META[id].keyOptional,
        keyLabel: PROVIDER_META[id].keyLabel,
        hasKey: secrets.has(id),
        model,
        baseUrl: current.providers[id]?.baseUrl ?? '',
        vision: visionSupport(id, model)
      }
    })
  }
}

export const settingsDomain = new SettingsDomain()
