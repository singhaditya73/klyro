import type { ProviderTestResult } from '@shared/types'

export interface ChatImage {
  dataUrl: string
  mime: string
}

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system' | 'tool'
  text: string
  images?: ChatImage[]
  /** Function calls the assistant made in this turn (assistant role only). */
  toolCalls?: Array<{ id: string; name: string; argsJson: string }>
  /** For role 'tool': the id of the assistant call this result answers. */
  toolCallId?: string
}

/** One tool the model may call, in OpenAI function-schema form. */
export interface ProviderToolSpec {
  name: string
  description: string
  /** JSON Schema describing the arguments object. */
  parameters: Record<string, unknown>
}

/** Streaming chunk: text content or a resolved batch of tool-call requests. */
export type ProviderChunk =
  | { kind: 'text'; text: string }
  | { kind: 'tool_calls'; calls: Array<{ id: string; name: string; argsJson: string }> }

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
  /**
   * Streaming chat with tool calling; only where the endpoint supports it
   * (OpenAI-compatible). A run ends either with text or with a final
   * 'tool_calls' chunk; the caller answers via role:'tool' turns.
   */
  chatWithTools?(options: ChatOptions & { tools: ProviderToolSpec[] }): AsyncGenerator<ProviderChunk, void, unknown>
  test(options: TestOptions): Promise<ProviderTestResult>
  /** Optional: speech-to-text. Only OpenAI-compatible endpoints support this. */
  transcribe?(options: TranscribeOptions): Promise<string>
}
