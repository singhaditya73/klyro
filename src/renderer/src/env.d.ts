/// <reference types="vite/client" />

declare module '*.svg' {
  import React from 'react'
  export const ReactComponent: React.FC<React.SVGProps<SVGSVGElement>>
  const src: string
  export default src
}

interface KlyroApi {
  getAppInfo(): Promise<any>
  quitApp(): Promise<void>
  getSettings(): Promise<any>
  updateSettings(patch: Partial<any>): Promise<any>
  /** Called when the settings changed in another window. */
  onSettingsChanged(listener: () => void): () => void
  listProviders(): Promise<any[]>
  setApiKey(provider: string, key: string): Promise<any[]>
  clearApiKey(provider: string): Promise<any[]>
  testProvider(provider: string): Promise<any>

  sendChat(req: any): Promise<void>
  abortChat(): Promise<void>
  chatRespondTool(callId: string, approved: boolean): Promise<void>
  onChatStream(listener: (event: any) => void): () => void

  listConversations(): Promise<any[]>
  getConversation(id: string, query?: any): Promise<any>
  createConversation(): Promise<any>
  renameConversation(id: string, title: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  searchConversations(query: string): Promise<any[]>

  listCaptureSources(): Promise<any[]>
  grabScreen(sourceId?: string): Promise<any>
  transcribe(audio: ArrayBuffer, mimeType: string, pcm?: string | ArrayBuffer): Promise<any>
  prewarmTranscribe(): Promise<void>
  ocrExtract(image: string): Promise<string>

  checkPermissions(): Promise<any>
  hideOverlay(): Promise<void>
  showMainWindow(): Promise<void>
  copyText(text: string): Promise<boolean>
  minimizeOverlay(): Promise<void>
  /** Show the quick-ask overlay (the same window the hotkey opens). */
  toggleOverlay(): Promise<void>
  snapToNotch(): Promise<void>
  setGhostMode(enabled: boolean): Promise<boolean>
  setZeroFocus(enabled: boolean): Promise<boolean>
  panicKillswitch(): Promise<void>
  remoteHudStart(port?: number): Promise<{ url: string; port: number; pairingCode: string; expiresAt: number }>
  remoteHudStop(): Promise<void>
  remoteHudStatus(): Promise<{ running: boolean; url: string; pairingCode?: string; expiresAt?: number }>
  remoteHudPairing(): Promise<{ code: string; expiresAt: number } | null>
  remoteHudTranscript?(line: string): Promise<void>
  setAirgap(enabled: boolean): Promise<boolean>
  onEmergencyReset?(listener: () => void): () => void
  onGhostModeChanged?(listener: (ghost: boolean) => void): () => void
  onZeroFocusChanged?(listener: (zeroFocus: boolean) => void): () => void
  /** Tell the main process how tall/wide the overlay's content is. */
  resizeOverlay(height: number, width?: number): Promise<number>
  privateModeStatus(): Promise<{ supported: boolean; enabled: boolean }>
  setRecordingSticky(sticky: boolean): Promise<void>
  /** Which shortcuts this app actually holds; a taken one is reported, not hidden. */
  shortcutStatus(): Promise<Array<{ kind: 'toggle' | 'hide' | 'ghost'; accelerator: string; registered: boolean }>>
  securityStatus(): Promise<any>
  dataSummary(): Promise<any>
  dataClear(scope: string): Promise<any>
  dataExport(): Promise<{ ok: boolean; path?: string; error?: string }>
  updateStatus(): Promise<any>
  updateCheck(): Promise<any>
  updateDownload(): Promise<any>
  updateInstall(): Promise<void>
  onUpdateStatus(listener: (status: any) => void): () => void
  sweepStorage(): Promise<any>
  diagnosticsList(): Promise<any[]>
  diagnosticsClear(): Promise<void>

  getAutomationCapabilities(): Promise<any>
  runAgent(request: any): Promise<void>
  cancelAgent(): Promise<void>
  pauseAgent(): Promise<void>
  resumeAgent(): Promise<void>
  confirmAgent(runId: string, approved: boolean): Promise<void>
  getAgentStatus(): Promise<any>
  listAgentTasks(): Promise<any[]>
  onAgentEvent(listener: (event: any) => void): () => void

  memoryList(): Promise<any[]>
  memoryAdd(draft: any): Promise<any[]>
  memoryUpdate(id: string, patch: Partial<any>): Promise<any[]>
  memoryDelete(id: string): Promise<any[]>
  memoryClear(): Promise<any[]>

  documentList(): Promise<any[]>
  documentImport(): Promise<any>
  documentDelete(id: string): Promise<any[]>
  documentClear(): Promise<any[]>

  knowledgeSearch(query: string): Promise<any[]>

  integrationList(): Promise<any[]>
  integrationTest(id: string): Promise<any[]>
  githubSetToken(token: string): Promise<any[]>
  githubClearToken(): Promise<any[]>
  githubAccount(): Promise<any>
  githubRepos(): Promise<any[]>
  githubIssues(ownerRepo: string): Promise<any[]>
  githubCreateIssue(ownerRepo: string, title: string, body: string): Promise<any>

  /* Meetings */

  meetingTranscriptGet(): Promise<{
    lines: string[]
    startedAt: number | null
    updatedAt: number | null
    resumable: boolean
  }>
  meetingTranscriptAppend(line: string): Promise<number>
  meetingTranscriptDiscard(): Promise<void>

  mcpServers(): Promise<any[]>
  mcpAddServer(input: { name: string; command: string; args?: string[]; env?: Record<string, string>; description?: string }): Promise<any>
  mcpRemoveServer(id: string): Promise<boolean>
  mcpToggleServer(id: string, enabled: boolean): Promise<any>
  mcpTestServer(id: string): Promise<{ ok: boolean; toolsCount: number; error?: string }>

  integrationsGet(): Promise<any>
  integrationsUpdate(patch: any): Promise<any>
  integrationsSendSlack(input: { message: string; webhookUrl?: string }): Promise<{ ok: boolean; error?: string }>
  integrationsSendCrm(input: { payload: Record<string, unknown>; webhookUrl?: string }): Promise<{ ok: boolean; error?: string }>

  meetingProposeActions(meetingId: string): Promise<{ meetingTitle: string; proposals: any[] }>
  meetingExecuteActions(input: { meetingId: string; proposals: any[] }): Promise<any[]>

  auditList(limit?: number): Promise<any[]>
  auditClear(): Promise<void>

  usageRows(): Promise<import('@shared/types').ProviderUsageRow[]>
  usageClear(): Promise<void>

  screenListDisplays(): Promise<Array<{ index: number; label: string; primary: boolean; bounds: { x: number; y: number; width: number; height: number } }>>

  mcpReadResource(input: { serverId: string; uri: string }): Promise<{ text: string }>

  providerDetectModels(input: { baseUrl: string; kind: 'opencode' | 'openai-compatible' }): Promise<string[]>

  localAgentStartOpenCode(): Promise<{ started: boolean; baseUrl: string; spawned: boolean; error?: string }>
  localAgentConnectOpenCode(): Promise<{
    connected: boolean
    baseUrl: string
    model: string
    models: number
    free: number
    verified?: boolean
    error?: string
  }>
  /** The OpenCode model that answered a check question, if any. */
  openCodePickModel(baseUrl?: string): Promise<{
    model: string
    name: string
    verified: boolean
    tried: Array<{ id: string; answered: boolean; reason: string | null }>
  }>
  localAgentOpenCodeInstalled(): Promise<{ installed: boolean }>
  localAgentClis(): Promise<Array<{ id: string; name: string; installed: boolean; providerId: string; note: string }>>
  antigravityStartService(): Promise<{ started: boolean; error?: string; note?: string }>
  antigravityConnect(): Promise<{ ok: boolean; error?: string; note?: string }>
  antigravityDisconnect(): Promise<{ ok: boolean }>
  interviewsList(query?: unknown): Promise<Array<{
    id: string
    company: string
    role: string
    startedAt: number
    endedAt: number
    durationMs: number
    questionCount: number
    answeredCount: number
    progress: number
    bookmarked: boolean
    stage?: string
    hasSummary: boolean
    preview: string
    ephemeral: boolean
  }>>
  interviewsGet(id: string): Promise<any>
  interviewsStart(input?: { company?: string; role?: string; ephemeral?: boolean }): Promise<any>
  interviewsAddQuestion(input: { id: string; text: string; source: 'voice' | 'text'; answer?: string; answerMs?: number }): Promise<any>
  interviewsAddTranscript(input: { id: string; line: string }): Promise<boolean>
  interviewsUpdate(input: { id: string; company?: string; role?: string; notes?: string; summary?: string; crmNotes?: any; tags?: string[]; stage?: string }): Promise<any>
  interviewsUpdateQuestion(input: { id: string; questionId: string; note?: string; progress?: string; answer?: string; bookmarked?: boolean }): Promise<boolean>
  interviewsToggleBookmark(input: { id: string; questionId?: string }): Promise<boolean>
  interviewsKeep(id: string): Promise<any>
  interviewsRemove(id: string): Promise<boolean>
  interviewsClear(): Promise<boolean>
  interviewsFacets(): Promise<{ companies: string[]; roles: string[]; kinds: string[] }>
  interviewsSummarize(id: string): Promise<{ summary: string; model: string } | null>
  interviewsGenerateCrmNotes(input: { id: string; meetingType?: string }): Promise<any>
  interviewsExportMarkdown(id: string): Promise<string>
  overlayCatalogue(): Promise<Array<{
    id: string
    label: string
    models: Array<{ id: string; name: string; provider: string; quota: number | null; free: boolean }>
    note: string | null
  }>>
  providerModels(providerId: string): Promise<{
    models: Array<{ id: string; name: string; provider: string; quota: number | null; free: boolean }>
    note: string | null
  }>
  antigravityStatus(): Promise<{
    supported: boolean
    running: boolean
    installed?: boolean
    service?: 'ide' | 'klyro' | null
    connected?: boolean
    connectedAt?: string | null
    plan: string | null
    account: string | null
    models: Array<{ id: string; name: string; provider: string; quota: number | null }>
    endpoint: string | null
    error: string | null
  }>

  mcpImportDiscover(): Promise<Array<{
    source: string
    name: string
    command: string
    args: string[]
    env?: Record<string, string>
    alreadyAdded: boolean
  }>>
  mcpImportAdd(input: { name: string; command: string; args?: string[]; env?: Record<string, string> }): Promise<any>

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
    window: { supported: boolean; excluded: boolean; variance: number } | null
    notes: string[]
  }>

  calendarGetStatus(): Promise<any>
  calendarSetFeedUrl(url: string | null): Promise<any>
  calendarSync(feedUrl?: string): Promise<{ success: boolean; eventCount: number; error?: string }>
  calendarGetUpcoming(): Promise<any | null>
  calendarDismiss(id: string): Promise<boolean>
  calendarToggleAutoDetect(enabled: boolean): Promise<boolean>
}

interface Window {
  klyro: KlyroApi
}