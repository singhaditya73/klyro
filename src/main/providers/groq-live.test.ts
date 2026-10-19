/**
 * Live end-to-end checks against the real Groq API. These exercise the same
 * code paths the app uses (the OpenAI-compatible provider with id 'groq')
 * rather than mocking HTTP, so they prove streaming, transcription, and the
 * error taxonomy against the provider's actual behaviour.
 *
 * Opt-in only: the whole suite is skipped unless KLYRO_TEST_GROQ_KEY is set,
 * so normal `npm test` runs stay hermetic and keyless. Keys are only read
 * from the environment and are never written into this file or any store.
 *
 *   KLYRO_TEST_GROQ_KEY=gsk_… npx vitest run src/main/providers/groq-live.test.ts
 */
import { describe, expect, it } from 'vitest'
import { openAICompatible } from './openai'
import { DEFAULT_PROVIDERS, PROVIDER_META } from './defaults'
import { isProviderError, type ProviderError } from './errors'
import { visionSupport } from './routing'

const BASE_URL = DEFAULT_PROVIDERS.groq.baseUrl
const CHAT_MODEL = DEFAULT_PROVIDERS.groq.model
const TRANSCRIBE_MODEL = DEFAULT_PROVIDERS.groq.transcribeModel
const enabled = (process.env.KLYRO_TEST_GROQ_KEY ?? '').length > 0
const API_KEY = process.env.KLYRO_TEST_GROQ_KEY

/** One second of 440 Hz sine as a 16-bit PCM WAV — a valid, if silent, upload. */
function testWav(): ArrayBuffer {
  const sampleRate = 16000
  const samples = sampleRate
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, samples * 2, true)
  for (let i = 0; i < samples; i++) {
    const value = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate))
    view.setInt16(44 + i * 2, value, true)
  }
  return buffer
}

/** Run one chat exchange and fail the test with the thrown ProviderError if it throws. */
async function chatOnce(options: { apiKey?: string | null; model?: string; turns: { role: 'user' | 'assistant' | 'system'; text: string }[] }): Promise<string> {
  const chunks: string[] = []
  for await (const delta of openAICompatible.chat({
    model: options.model ?? CHAT_MODEL,
    baseUrl: BASE_URL,
    apiKey: options.apiKey ?? API_KEY ?? null,
    turns: options.turns,
    maxTokens: 300
  })) {
    chunks.push(delta)
  }
  return chunks.join('')
}

function asProviderError(thrown: unknown): ProviderError {
  expect(isProviderError(thrown)).toBe(true)
  return thrown as ProviderError
}

describe.skipIf(!enabled)('Groq live provider (KLYRO_TEST_GROQ_KEY set)', () => {
  it('test() connects and reports latency', async () => {
    const result = await openAICompatible.test({ baseUrl: BASE_URL, apiKey: API_KEY ?? null, model: CHAT_MODEL })
    expect(result.ok).toBe(true)
    expect(result.detail).toBe('Connected')
    expect(typeof result.latencyMs).toBe('number')
  }, 30000)

  it('streams a chat completion with a system prompt', async () => {
    const chunks: string[] = []
    for await (const delta of openAICompatible.chat({
      model: CHAT_MODEL,
      baseUrl: BASE_URL,
      apiKey: API_KEY ?? null,
      system: 'Answer in numbers only.',
      turns: [{ role: 'user', text: 'What is 17 multiplied by 23?' }],
      maxTokens: 200
    })) {
      chunks.push(delta)
    }
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.join('')).toContain('391')
  }, 60000)

  it('keeps conversation history across turns', async () => {
    const code = Math.floor(Math.random() * 900000 + 100000).toString()
    const answer = await chatOnce({
      turns: [
        { role: 'user', text: `Remember this number: ${code}. Just say "noted".` },
        { role: 'assistant', text: 'Noted.' },
        { role: 'user', text: 'What number did I ask you to remember? Reply with the number only.' }
      ]
    })
    expect(answer).toContain(code)
  }, 60000)

  it('transcribes a WAV upload sent with a codec-parameter mime type', async () => {
    // MediaRecorder reports "audio/webm;codecs=opus"; the provider must accept
    // the full string and use it unchanged as the upload's content type.
    const text = await openAICompatible.transcribe?.({
      baseUrl: BASE_URL,
      apiKey: API_KEY ?? null,
      model: TRANSCRIBE_MODEL ?? 'whisper-large-v3',
      audio: testWav(),
      mimeType: 'audio/webm;codecs=opus'
    })
    expect(typeof text).toBe('string')
  }, 60000)

  it('classifies a wrong key as an auth error with the 401 message', async () => {
    const thrown = await chatOnce({ apiKey: 'gsk_invalid_test_key', turns: [{ role: 'user', text: 'hi' }] }).catch(
      (caught) => caught
    )
    const error = asProviderError(thrown)
    expect(error.kind).toBe('auth')
    expect(error.status).toBe(401)
    expect(error.message).toContain('rejected the API key (401)')
  }, 30000)

  it('enriches a not-found model error with the served model list', async () => {
    const thrown = await chatOnce({
      model: 'totally/not-a-groq-model',
      turns: [{ role: 'user', text: 'hi' }]
    }).catch((caught) => caught)
    const error = asProviderError(thrown)
    expect(error.kind).toBe('not_found')
    expect(error.message).toMatch(/Available models/i)
  }, 30000)

  it('routes the default chat model as text-only and vision-named models as vision', () => {
    expect(visionSupport('groq', CHAT_MODEL)).toBe('no')
    expect(visionSupport('groq', 'llama-3.2-11b-vision-preview')).toBe('yes')
  })

  it('marks Groq as a key-requiring provider', () => {
    expect(PROVIDER_META.groq.requiresKey).toBe(true)
    expect(PROVIDER_META.groq.keyLabel).toContain('gsk_')
  })
})
