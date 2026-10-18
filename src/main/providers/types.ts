import type { ProviderTestResult } from '@shared/types'

export interface ChatImage {
  dataUrl: string
  mime: string
}

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system'
  text: string
  images?: ChatImage[]
}

export interface ChatOptions {
  model: string
  baseUrl: string
  apiKey: string | null
  system?: string
  turns: ChatTurn[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export interface TestOptions {
  baseUrl: string
  apiKey: string | null
  model: string
}

export interface TranscribeOptions {
  baseUrl: string
  apiKey: string | null
  model: string
  audio: ArrayBuffer
  mimeType: string
}

export interface Provider {
  id: string
  /** Streams assistant text deltas. */
  chat(options: ChatOptions): AsyncGenerator<string, void, unknown>
  test(options: TestOptions): Promise<ProviderTestResult>
  /** Optional: speech-to-text. Only OpenAI-compatible endpoints support this. */
  transcribe?(options: TranscribeOptions): Promise<string>
}
