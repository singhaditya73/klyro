import { getProvider } from '../providers'
import { DEFAULT_PROVIDERS, DEFAULT_TRANSCRIBE_MODEL } from '../providers/defaults'
import { resolveRoute } from '../providers/routing'
import { usage } from './usage'
import { settingsDomain } from './settings'
import { daemon, bundledWhisperModelPath } from './daemon'
import { logger } from '../logger'

/**
 * Transcribes recorded audio.
 *
 * If the active provider supports Whisper and has an API key (or is a local OpenAI-compatible server),
 * it uses that provider. Otherwise, it uses the bundled local Whisper engine via the Klyro daemon,
 * giving the user 100% offline, zero-key speech-to-text out of the box.
 *
 * The audio travels in memory: it is never written to disk.
 */
export async function transcribeAudio(audio: ArrayBuffer, mimeType: string, pcmBase64?: string): Promise<string> {
  const settings = settingsDomain.get()
  const providerId = settings.activeProvider
  const provider = getProvider(providerId)

  // 1. Try active provider if it supports transcription and has credentials / local URL
  if (provider.transcribe) {
    const apiKey = settingsDomain.apiKey(providerId)
    if (apiKey || providerId === 'openai-compatible') {
      try {
        const route = resolveRoute({ settings, apiKey, purpose: 'transcription' })
        const text = await provider.transcribe({
          baseUrl: route.baseUrl,
          apiKey: route.apiKey,
          model: DEFAULT_PROVIDERS[providerId].transcribeModel ?? DEFAULT_TRANSCRIBE_MODEL,
          audio,
          mimeType
        })
        usage.record(providerId, 'transcribe')
        return text
      } catch (error) {
        logger.warn(`Provider ${providerId} transcription failed: ${(error as Error).message}. Attempting local fallback...`)
      }
    }
  }

  // 2. Local bundled Whisper via klyro-core
  const modelPath = bundledWhisperModelPath()
  if (modelPath && pcmBase64) {
    try {
      const text = await daemon.transcribe(pcmBase64, modelPath)
      usage.record(providerId, 'transcribe')
      return text
    } catch (error) {
      logger.error(`Local Whisper transcription error: ${(error as Error).message}`)
      throw error
    }
  }

  // 3. Fallback when neither local nor cloud is configured
  if (!provider.transcribe) {
    throw new Error(
      `Speech-to-text needs an audio model or Klyro's local speech engine. "${providerId}" has no speech recognition.`
    )
  }

  const route = resolveRoute({ settings, apiKey: settingsDomain.apiKey(providerId), purpose: 'transcription' })
  try {
    const text = await provider.transcribe({
      baseUrl: route.baseUrl,
      apiKey: route.apiKey,
      model: DEFAULT_PROVIDERS[providerId].transcribeModel ?? DEFAULT_TRANSCRIBE_MODEL,
      audio,
      mimeType
    })
    usage.record(providerId, 'transcribe')
    return text
  } catch (error) {
    usage.record(providerId, 'transcribe', { failed: true })
    throw error
  }
}
