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
  agentConfirmConsequential: boolean
  agentMaxSteps: number
  memoryEnabled: boolean
  memoryAutoExtract: boolean
  memoryRecallCount: number
  knowledgeEnabled: boolean
  documentRecallCount: number
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
  | { type: 'context'; messageId: string; memories: number; documents: number }
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

/* ---------- Desktop automation / agent ---------- */

export type AgentSession = 'wayland' | 'x11' | 'macos' | 'windows' | 'unknown'

export interface AutomationCapabilities {
  platform: string
  session: AgentSession
  available: boolean
  backends: string[]
  missing: string[]
  installHint: string
  limitations: string[]
}

export type AgentActionType =
  | 'move'
  | 'click'
  | 'doubleClick'
  | 'type'
  | 'key'
  | 'scroll'
  | 'wait'
  | 'screenshot'
  | 'done'
  | 'ask'

export interface AgentAction {
  type: AgentActionType
  x?: number
  y?: number
  button?: 'left' | 'right' | 'middle'
  text?: string
  keys?: string
  dy?: number
  ms?: number
  summary?: string
  question?: string
  requiresConfirmation?: boolean
  reason?: string
}

export type AgentStepStatus = 'planned' | 'executing' | 'executed' | 'failed' | 'skipped'

export type AgentEvent =
  | { type: 'start'; runId: string; goal: string }
  | { type: 'step'; runId: string; index: number; action: AgentAction; status: AgentStepStatus; detail?: string }
  | { type: 'needsConfirmation'; runId: string; index: number; action: AgentAction; reason: string }
  | { type: 'done'; runId: string; summary: string }
  | { type: 'cancelled'; runId: string }
  | { type: 'error'; runId: string; message: string }

export interface AgentRunRequest {
  goal: string
  maxSteps?: number
}

export interface AgentStatus {
  running: boolean
  runId: string | null
  goal: string | null
}

export interface AgentStepRecord {
  index: number
  action: AgentAction
  status: AgentStepStatus
  detail?: string
}

export type AgentOutcome = 'done' | 'cancelled' | 'error' | 'step-limit'

export interface AgentTaskRecord {
  id: string
  goal: string
  startedAt: number
  finishedAt: number
  outcome: AgentOutcome
  summary: string
  steps: AgentStepRecord[]
}

/* ---------- Knowledge: memory, documents, integrations ---------- */

export type MemorySource = 'user' | 'auto' | 'agent'

export interface MemoryRecord {
  id: string
  text: string
  tags: string[]
  source: MemorySource
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface MemoryDraft {
  text: string
  tags?: string[]
  source?: MemorySource
  pinned?: boolean
}

export interface DocumentRecord {
  id: string
  name: string
  kind: string
  group: 'manual' | 'workspace'
  sourcePath: string | null
  size: number
  addedAt: number
  chunkCount: number
  excerpt: string
}

export interface ImportResult {
  imported: DocumentRecord[]
  skipped: { name: string; reason: string }[]
}

export interface KnowledgeHit {
  kind: 'memory' | 'document'
  id: string
  title: string
  snippet: string
  score: number
}

export type IntegrationId = 'github'

export interface IntegrationStatus {
  id: IntegrationId
  label: string
  connected: boolean
  detail: string
}

export interface GitHubAccount {
  login: string
  name: string | null
  avatarUrl: string
}

export interface GitHubRepo {
  fullName: string
  description: string | null
  isPrivate: boolean
  updatedAt: string
  openIssues: number
}

export interface GitHubIssue {
  number: number
  title: string
  state: string
  url: string
  labels: string[]
  createdAt: string
  author: string
  isPullRequest: boolean
}

/* ---------- Coding mode ---------- */

export type CodeActionKind = 'explain' | 'bugs' | 'tests' | 'refactor' | 'docs'

export interface ProjectStatus {
  root: string | null
  files: number
  chunks: number
  indexedAt: number | null
  skipped: number
}

export interface CodeAssistRequest {
  kind: CodeActionKind
  code: string
  language?: string
  question?: string
}

export interface CodeAssistResult {
  text: string
}

/* ---------- Meetings ---------- */

export interface MeetingSegment {
  at: number
  text: string
}

export interface MeetingRecord {
  id: string
  title: string
  startedAt: number
  endedAt: number
  segments: MeetingSegment[]
  summary: string | null
  actions: string[]
  createdAt: number
}

export interface MeetingDraft {
  title: string
  startedAt: number
  endedAt: number
  segments: MeetingSegment[]
}

/* ---------- Workflows ---------- */

export type WorkflowStep =
  | { kind: 'prompt'; name: string; template: string }
  | { kind: 'githubIssues'; name: string; repo: string }

export interface WorkflowRecord {
  id: string
  name: string
  description: string
  builtin: boolean
  steps: WorkflowStep[]
  createdAt: number
}

export interface WorkflowDraft {
  name: string
  description?: string
  steps: WorkflowStep[]
}

export interface WorkflowStepResult {
  name: string
  output: string
  ok: boolean
}

export interface WorkflowRunResult {
  runId: string
  conversationId: string
  steps: WorkflowStepResult[]
}

export type WorkflowEvent =
  | { type: 'start'; runId: string; workflowId: string; name: string }
  | { type: 'step'; runId: string; index: number; name: string; status: 'running' | 'done' | 'failed'; detail?: string }
  | { type: 'done'; runId: string; conversationId: string }
  | { type: 'error'; runId: string; message: string }

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

  getAutomationCapabilities(): Promise<AutomationCapabilities>
  runAgent(request: AgentRunRequest): Promise<void>
  cancelAgent(): Promise<void>
  confirmAgent(runId: string, approved: boolean): Promise<void>
  getAgentStatus(): Promise<AgentStatus>
  listAgentTasks(): Promise<AgentTaskRecord[]>
  onAgentEvent(listener: (event: AgentEvent) => void): () => void

  memoryList(): Promise<MemoryRecord[]>
  memoryAdd(draft: MemoryDraft): Promise<MemoryRecord[]>
  memoryUpdate(id: string, patch: Partial<MemoryDraft>): Promise<MemoryRecord[]>
  memoryDelete(id: string): Promise<MemoryRecord[]>
  memoryClear(): Promise<MemoryRecord[]>

  documentList(): Promise<DocumentRecord[]>
  documentImport(): Promise<ImportResult>
  documentDelete(id: string): Promise<DocumentRecord[]>
  documentClear(): Promise<DocumentRecord[]>

  knowledgeSearch(query: string): Promise<KnowledgeHit[]>

  integrationList(): Promise<IntegrationStatus[]>
  githubSetToken(token: string): Promise<IntegrationStatus[]>
  githubClearToken(): Promise<IntegrationStatus[]>
  githubAccount(): Promise<GitHubAccount>
  githubRepos(): Promise<GitHubRepo[]>
  githubIssues(ownerRepo: string): Promise<GitHubIssue[]>
  githubCreateIssue(ownerRepo: string, title: string, body: string): Promise<GitHubIssue>

  projectStatus(): Promise<ProjectStatus>
  projectIndex(): Promise<ProjectStatus>
  projectClear(): Promise<ProjectStatus>
  codeAssist(request: CodeAssistRequest): Promise<CodeAssistResult>

  meetingList(): Promise<MeetingRecord[]>
  meetingSave(draft: MeetingDraft): Promise<MeetingRecord[]>
  meetingSummarize(id: string): Promise<MeetingRecord[]>
  meetingDelete(id: string): Promise<MeetingRecord[]>

  workflowList(): Promise<WorkflowRecord[]>
  workflowCreate(draft: WorkflowDraft): Promise<WorkflowRecord[]>
  workflowDelete(id: string): Promise<WorkflowRecord[]>
  workflowRun(id: string, input: string): Promise<WorkflowRunResult>
  onWorkflowEvent(listener: (event: WorkflowEvent) => void): () => void
}
