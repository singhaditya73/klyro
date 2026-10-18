import { getProvider } from '../providers'
import { DEFAULT_TRANSCRIBE_MODEL } from '../providers/defaults'
import { resolveRoute } from '../providers/routing'
import { settingsDomain } from './settings'

/**
 * Transcribes recorded audio using the active provider (OpenAI-compatible
 * `/audio/transcriptions`, which also covers local Whisper servers).
 *
 * The audio travels in memory: it is never written to a temp file, so there is
 * nothing left behind on disk after a recording.
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

  // resolveRoute rejects unsupported providers with a message that says why.
  const route = resolveRoute({ settings, apiKey: settingsDomain.apiKey(providerId), purpose: 'transcription' })

  return provider.transcribe({
    baseUrl: route.baseUrl,
    apiKey: route.apiKey,
    model: DEFAULT_TRANSCRIBE_MODEL,
    audio,
    mimeType
  })
}
