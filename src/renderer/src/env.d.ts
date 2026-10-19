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
  transcribe(audio: ArrayBuffer, mimeType: string): Promise<any>

  checkPermissions(): Promise<any>
  hideOverlay(): Promise<void>
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