/**
 * Types shared by the main process, preload bridge, and renderer.
 * Keep this file free of Node/Electron/DOM imports.
 */

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'ollama'
  | 'openai-compatible'
  | 'opencode'
  | 'claude-code'
  | 'codex'

export type ResponseStyle = 'concise' | 'balanced' | 'detailed'
export type ThemeMode = 'system' | 'dark' | 'light'

export interface ProviderSettings {
  baseUrl: string
  model: string
  /**
   * A faster model used by the quick-ask overlay, so the answer arrives in
   * under a second even when the chat model is the slow, thorough one.
   */
  fastModel?: string
  /**
   * Speech-to-text model for providers whose audio endpoint is OpenAI-shaped.
   * Empty = the provider cannot transcribe.
   */
  transcribeModel?: string
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
  /** Explicit opt-in to unencrypted credential storage when no keychain exists. */
  allowUnencryptedSecrets: boolean
  /** Opt-in crash/diagnostics capture (local files; upload only via explicit endpoint). */
  diagnosticsOptIn: boolean
  /**
   * Private mode for the quick-ask overlay: excluded from screen captures and
   * shares, and it stays visible when another app takes focus. Supported on
   * Windows and macOS; Linux/X11 has no per-window capture exclusion, so the
   * overlay stays visible to captures there.
   */
  overlayPrivateMode: boolean
  /** Overlay window opacity in percent (20–100). 100 = fully solid. */
  overlayOpacity: number
  /**
   * Opt-in: allow the normal chat to call tools exposed by configured MCP
   * servers. Every call still asks before it runs (or is declined), and each
   * one lands in the audit log.
   */
  chatMcpTools: boolean
  /**
   * Capture the screen with one click: the display is captured (Klyro hides
   * itself for the shot) and attached to the message, with no source picker.
   * When off, the picker asks which screen or window to share.
   */
  screenAutoCapture: boolean
  /**
   * Ask the OS for screen-capture permission at launch rather than during a
   * meeting (macOS raises a one-time system prompt on the first capture).
   */
  screenPreWarm: boolean
  /**
   * Which display the quick-ask overlay lives on. 'primary' is the normal
   * screen; a number is another connected display. Putting the overlay on a
   * screen you are not sharing keeps it out of the meeting by construction.
   */
  overlayDisplay: 'primary' | number
  /** Replay an answer instantly when the same question meets the same screen. */
  overlayAnswerCache: boolean
  /** The welcome tour has been completed (or skipped). */
  onboardingComplete: boolean
}

/** Whether a model can read images; `unknown` is honest for local/custom endpoints. */
export type VisionSupport = 'yes' | 'no' | 'unknown'

export interface ProviderStatus {
  id: ProviderId
  label: string
  requiresKey: boolean
  /** The credential is optional (a local server that may not ask for one). */
  keyOptional?: boolean
  /** Hint for the key field ("OpenAI API key", "Groq API key (gsk_…)"). */
  keyLabel: string
  hasKey: boolean
  model: string
  baseUrl: string
  /** The selected model's known image support, for the agent guardrail. */
  vision?: VisionSupport
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

/**
 * A window onto a conversation. Long histories are paged from the end, so opening
 * a chat with thousands of messages stays fast in both processes.
 */
export interface ConversationWindow {
  conversation: Conversation
  /** Messages in the conversation, including any that are not in this window. */
  totalMessages: number
  /** True when older messages exist above the window. */
  hasMore: boolean
}

export interface ConversationQuery {
  /** How many of the newest messages to return. */
  limit?: number
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  preview: string
}

/** One retrieved document the user explicitly pinned to the next message. */
export interface SendChatRequest {
  conversationId: string
  content: string
  attachments?: Attachment[]
  /**
   * Turbo mode (the quick-ask overlay): use the provider's fast model, keep
   * the answer short, and allow an instant replay of an identical question.
   */
  useFastModel?: boolean
  /** When set, replaces BM25 grounding with the full text of that document. */
  pinnedDocumentId?: string
}

export type ChatStreamEvent =
  | { type: 'start'; conversationId: string; messageId: string; model: string; provider: ProviderId }
  | { type: 'context'; messageId: string; memories: number; documents: number }
  | { type: 'delta'; messageId: string; text: string }
  /** A tool call wants to run; the UI must get an explicit answer. */
  | { type: 'tool-pending'; messageId: string; callId: string; name: string; args: string }
  | { type: 'tool-resolved'; messageId: string; callId: string; ok: boolean }
  | {
      type: 'done'
      messageId: string
      /** Milliseconds until the first token. */
      ms?: number
      /** Milliseconds until the answer was complete. */
      totalMs?: number
      model?: string
      /** True when the answer was replayed from the cache. */
      cached?: boolean
    }
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

/** Why a session cannot (fully) drive input. */
export type AutomationBlockKind = 'ready' | 'executable-missing' | 'permission-denied' | 'unsupported'

export interface AutomationCheck {
  name: string
  ok: boolean
  detail: string
}

export interface AutomationRuntime {
  /** The overall verdict for this session. */
  kind: AutomationBlockKind
  /** Backends that responded to a harmless probe (not merely present on PATH). */
  verifiedBackends: string[]
  checks: AutomationCheck[]
}

export interface AutomationCapabilities {
  platform: string
  session: AgentSession
  available: boolean
  backends: string[]
  missing: string[]
  installHint: string
  limitations: string[]
  runtime: AutomationRuntime
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

export type AgentStepStatus =
  | 'planned'
  | 'executing'
  | 'executed'
  | 'verified'
  | 'unverified'
  | 'ambiguous'
  | 'blocked'
  | 'skipped'
  | 'pending'
  | 'failed'
  | 'blocked'
  | 'skipped'

/** Lifecycle state of an agent task. Terminal: completed/failed/cancelled/interrupted. */
export type AgentTaskState =
  | 'queued'
  | 'running'
  | 'awaiting-approval'
  | 'paused'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

/** Coarse error buckets so the UI and logs can act on failures. */
export type AgentErrorCategory =
  | 'automation-unavailable'
  | 'input-backend'
  | 'model'
  | 'malformed-action'
  | 'timeout'
  | 'rate-limit'
  | 'blocked-by-screen'
  | 'cancelled'
  | 'unknown'

export type AgentEvent =
  | { type: 'start'; runId: string; goal: string }
  | { type: 'state'; runId: string; state: AgentTaskState }
  | {
      type: 'step'
      runId: string
      index: number
      action: AgentAction
      status: AgentStepStatus
      detail?: string
      verified?: boolean
      screenChanged?: boolean
    }
  | { type: 'needsConfirmation'; runId: string; index: number; action: AgentAction; reason: string }
  | { type: 'done'; runId: string; summary: string }
  | { type: 'cancelled'; runId: string }
  | { type: 'error'; runId: string; message: string; category?: AgentErrorCategory }

export interface AgentRunRequest {
  goal: string
  maxSteps?: number
}

export interface AgentStatus {
  running: boolean
  runId: string | null
  goal: string | null
  state: AgentTaskState | 'idle'
  paused: boolean
  steps: number
  modelCalls: number
  elapsedMs: number
}

export interface AgentStepRecord {
  index: number
  action: AgentAction
  status: AgentStepStatus
  detail?: string
  /** Whether the screen changed in a way consistent with the action. */
  screenChanged?: boolean
  /** Whether the step produced an observable, verified effect. */
  verified?: boolean
  /** How many times execution was attempted. */
  attempts?: number
}

export type AgentOutcome = 'done' | 'cancelled' | 'error' | 'step-limit' | 'timeout' | 'interrupted'

export interface AgentTaskRecord {
  id: string
  goal: string
  startedAt: number
  finishedAt: number
  state: AgentTaskState
  outcome: AgentOutcome
  summary: string
  errorCategory?: AgentErrorCategory
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
  /** How this fact was learned, e.g. "conversation:title" or "document:notes.md". */
  origin?: string
}

export interface MemoryDraft {
  text: string
  tags?: string[]
  source?: MemorySource
  pinned?: boolean
  origin?: string
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
  /** 1-based line number when the hit came from a known location. */
  line?: number
  /** 1-based end line when the hit came from a known range. */
  endLine?: number
  /** Absolute source path for document hits. */
  path?: string
}

export type IntegrationId = 'github'

export interface IntegrationTestResult {
  ok: boolean
  detail: string
  testedAt: string
}

/** One stored crash/diagnostics report (Phase J2). Content is redacted. */
export interface CrashReport {
  id: string
  at: string
  kind: 'main-crash' | 'unhandled-rejection' | 'render-process-gone' | 'child-process-gone'
  message: string
  stack?: string
  version: string
  platform: string
  arch: string
  session: string | null
}
export interface IntegrationStatus {
  id: IntegrationId
  label: string
  /** `token` = user-provided credential; `oauth` = needs OAuth app credentials (G2). */
  auth: 'token' | 'oauth'
  summary: string
  connected: boolean
  detail: string
  /** Last "Test connection" result, if one has been run this session. */
  test: IntegrationTestResult | null
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
  /** Ledger of concrete actions taken on this meeting (issues filed, etc.). */
  outputs?: MeetingOutput[]
}

export interface MeetingDraft {
  title: string
  startedAt: number
  endedAt: number
  segments: MeetingSegment[]
}

/** One concrete thing Klyro did after a meeting (the "closing the loop" ledger). */
export interface MeetingOutput {
  at: number
  kind: 'github-issue'
  detail: string
  url: string | null
  ok: boolean
}

/* ---------- MCP connector (bring-your-own tool servers) ---------- */

export interface MCPServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface MCPTool {
  name: string
  description?: string
  inputSchema?: unknown
}

export interface MCPServerState {
  config: MCPServerConfig
  running: boolean
  tools: MCPTool[]
  /** Resources the server exposes (files, notes, rows — whatever it offers). */
  resources: MCPResource[]
  /** Prompts the server exposes as reusable templates. */
  prompts: MCPPrompt[]
  lastError: string | null
}

/** A resource published by an MCP server. */
export interface MCPResource {
  uri?: string
  name?: string
  description?: string
  mimeType?: string
}

/** A prompt template published by an MCP server. */
export interface MCPPrompt {
  name?: string
  description?: string
  arguments?: Array<{ name?: string; description?: string; required?: boolean }>
}

export interface MCPCallResult {
  ok: boolean
  text: string
}

/** Function-calling spec for one MCP tool, as offered to the model. */
export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>
}

/** Local, append-only record of a consequential app action (what-did-it-do log). */
export interface AuditEntry {
  id: string
  at: number
  kind: string
  detail: string
  meta?: Record<string, unknown>
}

/** One per-user proposed work item derived from a meeting's action items. */
export interface ActionProposal {
  kind: 'github-issue' | 'manual'
  repo: string | null
  title: string
  body: string
  reason: string
}

/** A proposal after execution — success or honest failure. */
export interface ActionExecutionResult {
  ok: boolean
  detail: string
  url: string | null
}

/* ---------- Security, privacy & data ---------- */

export interface SecurityStatus {
  encryptionAvailable: boolean
  plaintextAllowed: boolean
  hasPlaintextSecrets: boolean
}

export type DataScope = 'conversations' | 'memory' | 'documents' | 'meetings' | 'agentTasks'

export type WorkspaceView = 'home' | 'chat' | 'screen' | 'agent' | 'workflows' | 'memory' | 'integrations'

export interface StorageReport {
  dataBytes: number
  dataFiles: number
  backupBytes: number
  backupFiles: number
  totalBytes: number
  /** Data files that could not be parsed and were set aside, never deleted. */
  quarantined: string[]
  /** Filled in when a sweep has just run. */
  lastSweep?: { removedTempFiles: number; removedBackups: number; freedBytes: number; at: number }
}

export interface DataSummary {
  conversations: number
  memories: number
  documents: number
  meetings: number
  agentTasks: number
  credentials: number
  activeProvider: ProviderId
  /** True when the active provider keeps requests on this machine. */
  activeProviderIsLocal: boolean
  /** What Klyro is using on disk, so "clear" decisions are informed. */
  storage: StorageReport
}

/* ---------- Workflows ---------- */

export type WorkflowStepKind =
  | 'prompt'
  | 'githubIssues'
  | 'githubCreateIssue'
  | 'knowledge'
  | 'meetingSummary'

/** Fields every step shares. All are optional so older drafts stay valid. */
export interface WorkflowStepOptions {
  /** Stable id. Generated when omitted; unique within a workflow. */
  id?: string
  name: string
  /** Stop the run (default) or record the failure and carry on. */
  onFailure?: 'stop' | 'continue'
  /** Extra attempts after the first failure (0–3). */
  retries?: number
  /** Per-step timeout in milliseconds. */
  timeoutMs?: number
  /** Key later steps refer to as {{steps.<key>}}. Defaults to the step id. */
  output?: string
}

export type WorkflowStep = WorkflowStepOptions &
  (
    | { kind: 'prompt'; template: string }
    | { kind: 'githubIssues'; repo: string }
    | { kind: 'githubCreateIssue'; repo: string; title: string; body: string }
    | { kind: 'knowledge'; query: string }
    | { kind: 'meetingSummary'; meetingId: string }
  )

export interface WorkflowRecord {
  id: string
  /** Schema version of this definition. */
  version: number
  name: string
  description: string
  builtin: boolean
  steps: WorkflowStep[]
  createdAt: number
  updatedAt?: number
}

export interface WorkflowDraft {
  name: string
  description?: string
  steps: WorkflowStep[]
}

export interface WorkflowStepResult {
  id: string
  name: string
  output: string
  ok: boolean
  /** How many attempts were made (1 when it worked first time). */
  attempts?: number
  error?: string
}

export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface WorkflowRunStepState {
  id: string
  name: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  output?: string
  error?: string
  detail?: string
  attempts: number
  startedAt?: number
  finishedAt?: number
}

/** Durable record of one workflow run, kept across restarts. */
export interface WorkflowRun {
  id: string
  workflowId: string
  workflowName: string
  input: string
  conversationId: string
  status: WorkflowRunStatus
  startedAt: number
  finishedAt: number
  steps: WorkflowRunStepState[]
  error?: string
}

export interface WorkflowRunResult {
  runId: string
  conversationId: string
  status: WorkflowRunStatus
  error?: string
  steps: WorkflowStepResult[]
}

export type WorkflowEvent =
  | { type: 'start'; runId: string; workflowId: string; name: string }
  | { type: 'step'; runId: string; index: number; name: string; status: 'running' | 'done' | 'failed'; detail?: string }
  | { type: 'done'; runId: string; conversationId: string; status: WorkflowRunStatus }
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
  /** Answer a pending MCP tool-call approval for the running chat. */
  chatRespondTool(callId: string, approved: boolean): Promise<void>
  onChatStream(listener: (event: ChatStreamEvent) => void): () => void

  listConversations(): Promise<ConversationSummary[]>
  getConversation(id: string, query?: ConversationQuery): Promise<ConversationWindow | null>
  createConversation(): Promise<Conversation>
  renameConversation(id: string, title: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  searchConversations(query: string): Promise<ConversationSummary[]>

  listCaptureSources(): Promise<CaptureSource[]>
  grabScreen(sourceId?: string): Promise<CaptureResult>
  transcribe(audio: ArrayBuffer, mimeType: string): Promise<TranscribeResult>

  checkPermissions(): Promise<PermissionState>
  hideOverlay(): Promise<void>
  /** Private-mode status for the overlay: capture exclusion support and current state. */
  privateModeStatus(): Promise<{ supported: boolean; enabled: boolean }>
  /** Keep the overlay visible across focus changes while meeting-assist records. */
  setRecordingSticky(sticky: boolean): Promise<void>

  /* MCP connector */
  mcpServers(): Promise<MCPServerState[]>
  /** MCP servers already configured in OpenCode, Claude Code and friends. */
  mcpImportDiscover(): Promise<Array<{
    source: string
    name: string
    command: string
    args: string[]
    env?: Record<string, string>
    alreadyAdded: boolean
  }>>
  mcpImportAdd(input: { name: string; command: string; args?: string[]; env?: Record<string, string> }): Promise<MCPServerConfig>
  mcpAddServer(input: { name: string; command: string; args?: string[] }): Promise<MCPServerConfig>
  mcpRemoveServer(id: string): Promise<void>
  mcpRefreshTools(id: string): Promise<MCPTool[]>
  mcpCallTool(input: { serverId: string; name: string; args?: Record<string, unknown> }): Promise<MCPCallResult>
  /** Read a resource published by an MCP server. */
  mcpReadResource(input: { serverId: string; uri: string }): Promise<{ text: string }>

  /* Post-meeting action agent */
  meetingProposeActions(meetingId: string): Promise<{ meetingTitle: string; proposals: ActionProposal[] }>
  meetingExecuteActions(input: { meetingId: string; proposals: ActionProposal[] }): Promise<MeetingOutput[]>

  /* Audit log */
  auditList(limit?: number): Promise<AuditEntry[]>
  auditClear(): Promise<void>

  /* Local usage ledger */
  usageRows(): Promise<Array<{ provider: string; requests: number; toolCalls: number; failures: number }>>
  usageClear(): Promise<void>

  /**
   * Measure — not guess — whether the overlay is excluded from screen
   * captures on this machine.
   */
  providerDetectModels(input: { baseUrl: string; kind: 'opencode' | 'openai-compatible' }): Promise<string[]>

  localAgentStartOpenCode(): Promise<{ started: boolean; baseUrl: string; spawned: boolean; error?: string }>
  localAgentConnectOpenCode(): Promise<{
    connected: boolean
    baseUrl: string
    model: string
    models: number
    free: number
    error?: string
  }>
  localAgentOpenCodeInstalled(): Promise<{ installed: boolean }>
  localAgentClis(): Promise<Array<{ id: string; name: string; installed: boolean; providerId: string; note: string }>>
  /** Start Klyro's own Antigravity agent service (no IDE needed). */
  antigravityStartService(): Promise<{ started: boolean; error?: string; note?: string }>
  /** The local Antigravity IDE: plan, quota and the models it can reach. */
  antigravityStatus(): Promise<{
    supported: boolean
    running: boolean
    installed?: boolean
    service?: 'ide' | 'klyro' | null
    plan: string | null
    account: string | null
    models: Array<{ id: string; name: string; provider: string; quota: number | null }>
    endpoint: string | null
    error: string | null
  }>

  localAgentsDetect(): Promise<Array<{
    id: string
    kind: 'opencode' | 'openai-compatible'
    name: string
    baseUrl: string
    healthy: boolean
    needsAuth?: boolean
    version?: string
    models: string[]
    note: string
  }>>

  privacyProbeOverlay(): Promise<{
    excluded: boolean
    changedRatio: number
    platform: string
    supported: boolean
  }>

  /** Connected displays, for the "which screen holds the overlay" setting. */
  screenListDisplays(): Promise<
    Array<{
      index: number
      label: string
      primary: boolean
      bounds: { x: number; y: number; width: number; height: number }
    }>
  >
  securityStatus(): Promise<SecurityStatus>
  dataSummary(): Promise<DataSummary>
  dataClear(scope: DataScope): Promise<DataSummary>
  sweepStorage(): Promise<DataSummary>
  diagnosticsList(): Promise<CrashReport[]>
  diagnosticsClear(): Promise<void>

  getAutomationCapabilities(): Promise<AutomationCapabilities>
  runAgent(request: AgentRunRequest): Promise<void>
  cancelAgent(): Promise<void>
  pauseAgent(): Promise<void>
  resumeAgent(): Promise<void>
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
  integrationTest(id: IntegrationId): Promise<IntegrationStatus[]>
  githubSetToken(token: string): Promise<IntegrationStatus[]>
  githubClearToken(): Promise<IntegrationStatus[]>
  githubAccount(): Promise<GitHubAccount>
  githubRepos(): Promise<GitHubRepo[]>
  githubIssues(ownerRepo: string): Promise<GitHubIssue[]>
  githubCreateIssue(ownerRepo: string, title: string, body: string): Promise<GitHubIssue>

  meetingList(): Promise<MeetingRecord[]>
  meetingSave(draft: MeetingDraft): Promise<MeetingRecord[]>
  meetingSummarize(id: string): Promise<MeetingRecord[]>
  meetingDelete(id: string): Promise<MeetingRecord[]>
  /** Append one transcribed chunk; silence artefacts and repeats are dropped. */
  meetingTranscriptAppend(text: string): Promise<{ segments: MeetingSegment[]; added: boolean }>
  /** Record that a stretch of audio could not be transcribed. */
  meetingTranscriptGap(): Promise<{ segments: MeetingSegment[]; added: boolean }>
  /** The transcript of a recording that was still in progress at last exit. */
  meetingTranscriptGet(): Promise<{ startedAt: number; updatedAt: number; segments: MeetingSegment[] } | null>
  meetingTranscriptDiscard(): Promise<MeetingRecord[]>

  workflowList(): Promise<WorkflowRecord[]>
  workflowCreate(draft: WorkflowDraft): Promise<WorkflowRecord[]>
  workflowDelete(id: string): Promise<WorkflowRecord[]>
  workflowRun(id: string, input: string): Promise<WorkflowRunResult>
  workflowRuns(): Promise<WorkflowRun[]>
  workflowCancel(runId: string): Promise<void>
  onWorkflowEvent(listener: (event: WorkflowEvent) => void): () => void
}
