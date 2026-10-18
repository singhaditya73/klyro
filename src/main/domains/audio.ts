import { getProvider } from '../providers'
import { DEFAULT_TRANSCRIBE_MODEL } from '../providers/defaults'
import { settingsDomain } from './settings'

/**
 * Transcribes recorded audio using the active provider (OpenAI-compatible
 * `/audio/transcriptions`, which also covers local Whisper servers).
 */
export async function transcribeAudio(audio: ArrayBuffer, mimeType: string): Promise<string> {
  const settings = settingsDomain.get()
  const providerId = settings.activeProvider
  const provider = getProvider(providerId)

  if (!provider.transcribe) {
    throw new Error(
      `Speech-to-text is not supported by "${providerId}". Choose an OpenAI-compatible provider or a local Whisper server.`
    )
  }

  const providerSettings = settings.providers[providerId]
  return provider.transcribe({
    baseUrl: providerSettings.baseUrl,
    apiKey: settingsDomain.apiKey(providerId),
    model: DEFAULT_TRANSCRIBE_MODEL,
    audio,
    mimeType
  })
}
