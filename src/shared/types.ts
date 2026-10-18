/**
 * Types shared by the main process, preload bridge, and renderer.
 * Keep this file free of Node/Electron/DOM imports.
 */

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openai-compatible'

export type ResponseStyle = 'concise' | 'balanced' | 'detailed'
export type ThemeMode = 'system' | 'dark' | 'light'

export interface ProviderSettings {
  baseUrl: string
  model: string
}

export interface AppSettings {
  activeProvider: ProviderId
  providers: Record<ProviderId, ProviderSettings>
  systemPrompt: string
  responseStyle: ResponseStyle
  theme: ThemeMode
  launchAtLogin: boolean
  toggleShortcut: string
}

export interface ProviderStatus {
  id: ProviderId
  label: string
  requiresKey: boolean
  hasKey: boolean
  model: string
  baseUrl: string
}

export interface ProviderTestResult {
  ok: boolean
  detail: string
  latencyMs?: number
}

export type Role = 'user' | 'assistant' | 'system'

export interface Attachment {
  kind: 'image'
  mime: string
  dataUrl: string
  label?: string
}

export interface ChatMessage {
  id: string
  role: Role
  content: string
  attachments?: Attachment[]
  createdAt: number
  model?: string
  error?: boolean
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  preview: string
}

export interface SendChatRequest {
  conversationId: string
  content: string
  attachments?: Attachment[]
}

export type ChatStreamEvent =
  | { type: 'start'; conversationId: string; messageId: string; model: string; provider: ProviderId }
  | { type: 'delta'; messageId: string; text: string }
  | { type: 'done'; messageId: string }
  | { type: 'error'; messageId: string; message: string }

export interface CaptureSource {
  id: string
  name: string
  thumbnail: string
}

export interface CaptureResult {
  dataUrl: string
  name: string
}

export interface PermissionState {
  microphone: 'granted' | 'denied' | 'unknown'
  screen: 'granted' | 'denied' | 'unknown'
  accessibility: 'granted' | 'denied' | 'unknown'
  notes: string[]
}

export interface AppInfo {
  name: string
  version: string
  tagline: string
  platform: string
}

export interface TranscribeResult {
  text: string
}

/** The API exposed on `window.klyro` by the preload bridge. */
export interface KlyroApi {
  getAppInfo(): Promise<AppInfo>
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  listProviders(): Promise<ProviderStatus[]>
  setApiKey(provider: ProviderId, key: string): Promise<ProviderStatus[]>
  clearApiKey(provider: ProviderId): Promise<ProviderStatus[]>
  testProvider(provider: ProviderId): Promise<ProviderTestResult>

  sendChat(req: SendChatRequest): Promise<void>
  abortChat(): Promise<void>
  onChatStream(listener: (event: ChatStreamEvent) => void): () => void

  listConversations(): Promise<ConversationSummary[]>
  getConversation(id: string): Promise<Conversation | null>
  createConversation(): Promise<Conversation>
  renameConversation(id: string, title: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  searchConversations(query: string): Promise<ConversationSummary[]>

  listCaptureSources(): Promise<CaptureSource[]>
  grabScreen(sourceId?: string): Promise<CaptureResult>
  transcribe(audio: ArrayBuffer, mimeType: string): Promise<TranscribeResult>

  checkPermissions(): Promise<PermissionState>
  hideOverlay(): Promise<void>
}
