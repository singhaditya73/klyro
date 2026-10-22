/// <reference types="vite/client" />

declare module '*.svg' {
  import React from 'react'
  export const ReactComponent: React.FC<React.SVGProps<SVGSVGElement>>
  const src: string
  export default src
}

interface KlyroApi {
  getAppInfo(): Promise<any>
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
  transcribe(audio: ArrayBuffer, mimeType: string, pcmBase64?: string): Promise<any>

  checkPermissions(): Promise<any>
  hideOverlay(): Promise<void>
  /** Show the quick-ask overlay (the same window the hotkey opens). */
  toggleOverlay(): Promise<void>
  /** Tell the main process how tall the overlay's content is. */
  resizeOverlay(height: number): Promise<number>
  privateModeStatus(): Promise<{ supported: boolean; enabled: boolean }>
  setRecordingSticky(sticky: boolean): Promise<void>
  securityStatus(): Promise<any>
  dataSummary(): Promise<any>
  dataClear(scope: string): Promise<any>
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

  /* Workflows */

  meetingList(): Promise<any[]>
  meetingStartRecording(): Promise<void>
  meetingStopRecording(): Promise<void>
  meetingSave(req: any): Promise<any[]>
  meetingSummarize(id: string): Promise<any[]>
  meetingDelete(id: string): Promise<any[]>
  meetingTranscriptGet(): Promise<any>
  meetingTranscriptAppend(text: string): Promise<any>
  meetingTranscriptGap(): Promise<any>
  meetingTranscriptDiscard(): Promise<void>

  mcpServers(): Promise<any[]>
  mcpAddServer(input: { name: string; command: string; args?: string[] }): Promise<any>
  mcpRemoveServer(id: string): Promise<void>
  mcpRefreshTools(id: string): Promise<any[]>
  mcpCallTool(input: { serverId: string; name: string; args?: Record<string, unknown> }): Promise<any>

  meetingProposeActions(meetingId: string): Promise<{ meetingTitle: string; proposals: any[] }>
  meetingExecuteActions(input: { meetingId: string; proposals: any[] }): Promise<any[]>

  auditList(limit?: number): Promise<any[]>
  auditClear(): Promise<void>

  usageRows(): Promise<any[]>
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
  interviewsUpdate(input: { id: string; company?: string; role?: string; notes?: string; summary?: string; tags?: string[]; stage?: string }): Promise<any>
  interviewsUpdateQuestion(input: { id: string; questionId: string; note?: string; progress?: string; answer?: string; bookmarked?: boolean }): Promise<boolean>
  interviewsToggleBookmark(input: { id: string; questionId?: string }): Promise<boolean>
  interviewsKeep(id: string): Promise<any>
  interviewsRemove(id: string): Promise<boolean>
  interviewsClear(): Promise<boolean>
  interviewsFacets(): Promise<{ companies: string[]; roles: string[]; kinds: string[] }>
  interviewsSummarize(id: string): Promise<{ summary: string; model: string } | null>
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
  }>

  workflowList(): Promise<any[]>
  workflowRun(id: string, input: string): Promise<any>
  workflowCancel(runId: string): Promise<void>
  workflowDelete(id: string): Promise<any[]>
  workflowRuns(): Promise<any[]>
  onWorkflowEvent(listener: (event: any) => void): () => void
}

interface Window {
  klyro: KlyroApi
}