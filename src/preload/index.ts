import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AgentEvent,
  AgentRunRequest,
  AppSettings,
  ChatStreamEvent,
  ConversationQuery,
  DataScope,
  KlyroApi,
  MeetingDraft,
  MemoryDraft,
  ProviderId,
  SendChatRequest,
  WorkflowDraft,
  WorkflowEvent
} from '@shared/types'

const api: KlyroApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  listProviders: () => ipcRenderer.invoke(IPC.providerList),
  setApiKey: (provider: ProviderId, key: string) => ipcRenderer.invoke(IPC.providerSetKey, provider, key),
  clearApiKey: (provider: ProviderId) => ipcRenderer.invoke(IPC.providerClearKey, provider),
  testProvider: (provider: ProviderId) => ipcRenderer.invoke(IPC.providerTest, provider),

  sendChat: (request: SendChatRequest) => ipcRenderer.invoke(IPC.chatSend, request),
  abortChat: () => ipcRenderer.invoke(IPC.chatAbort),
  chatRespondTool: (callId: string, approved: boolean) => ipcRenderer.invoke(IPC.chatRespondTool, { callId, approved }),
  onChatStream: (listener: (event: ChatStreamEvent) => void) => {
    const wrapped = (_event: unknown, payload: ChatStreamEvent): void => listener(payload)
    ipcRenderer.on(IPC.chatStream, wrapped)
    return () => {
      ipcRenderer.off(IPC.chatStream, wrapped)
    }
  },

  listConversations: () => ipcRenderer.invoke(IPC.conversationList),
  getConversation: (id: string, query?: ConversationQuery) =>
    ipcRenderer.invoke(IPC.conversationGet, id, query),
  createConversation: () => ipcRenderer.invoke(IPC.conversationCreate),
  renameConversation: (id: string, title: string) => ipcRenderer.invoke(IPC.conversationRename, id, title),
  deleteConversation: (id: string) => ipcRenderer.invoke(IPC.conversationDelete, id),
  searchConversations: (query: string) => ipcRenderer.invoke(IPC.conversationSearch, query),

  listCaptureSources: () => ipcRenderer.invoke(IPC.captureSources),
  grabScreen: (sourceId?: string) => ipcRenderer.invoke(IPC.captureGrab, sourceId),
  transcribe: (audio: ArrayBuffer, mimeType: string) => ipcRenderer.invoke(IPC.transcribe, audio, mimeType),

  checkPermissions: () => ipcRenderer.invoke(IPC.permissionsCheck),
  hideOverlay: () => ipcRenderer.invoke(IPC.windowHideOverlay),
  privateModeStatus: () => ipcRenderer.invoke(IPC.windowPrivateModeStatus),
  setRecordingSticky: (sticky: boolean) => ipcRenderer.invoke(IPC.overlaySetRecordingSticky, sticky),

  mcpServers: () => ipcRenderer.invoke(IPC.mcpServers),
  mcpAddServer: (input: { name: string; command: string; args?: string[] }) => ipcRenderer.invoke(IPC.mcpAddServer, input),
  mcpRemoveServer: (id: string) => ipcRenderer.invoke(IPC.mcpRemoveServer, id),
  mcpRefreshTools: (id: string) => ipcRenderer.invoke(IPC.mcpRefreshTools, id),
  mcpCallTool: (input: { serverId: string; name: string; args?: Record<string, unknown> }) => ipcRenderer.invoke(IPC.mcpCallTool, input),
  mcpReadResource: (input: { serverId: string; uri: string }) => ipcRenderer.invoke(IPC.mcpReadResource, input),

  meetingProposeActions: (meetingId: string) => ipcRenderer.invoke(IPC.meetingProposeActions, meetingId),
  meetingExecuteActions: (input: { meetingId: string; proposals: unknown[] }) => ipcRenderer.invoke(IPC.meetingExecuteActions, input),

  auditList: (limit?: number) => ipcRenderer.invoke(IPC.auditList, limit),
  auditClear: () => ipcRenderer.invoke(IPC.auditClear),
  usageRows: () => ipcRenderer.invoke(IPC.usageRows),
  privacyProbeOverlay: () => ipcRenderer.invoke(IPC.privacyProbeOverlay),
  mcpImportDiscover: () => ipcRenderer.invoke(IPC.mcpImportDiscover),
  mcpImportAdd: (input: { name: string; command: string; args?: string[]; env?: Record<string, string> }) =>
    ipcRenderer.invoke(IPC.mcpImportAdd, input),
  localAgentsDetect: () => ipcRenderer.invoke(IPC.localAgentsDetect),
  antigravityStatus: () => ipcRenderer.invoke(IPC.antigravityStatus),
  antigravityStartService: () => ipcRenderer.invoke(IPC.antigravityStartService),
  localAgentStartOpenCode: () => ipcRenderer.invoke(IPC.localAgentStartOpenCode),
  localAgentConnectOpenCode: () => ipcRenderer.invoke(IPC.localAgentConnectOpenCode),
  localAgentOpenCodeInstalled: () => ipcRenderer.invoke(IPC.localAgentOpenCodeInstalled),
  localAgentClis: () => ipcRenderer.invoke(IPC.localAgentClis),
  providerDetectModels: (input: { baseUrl: string; kind: 'opencode' | 'openai-compatible' }) =>
    ipcRenderer.invoke(IPC.providerDetectModels, input),
  screenListDisplays: () => ipcRenderer.invoke(IPC.screenListDisplays),
  usageClear: () => ipcRenderer.invoke(IPC.usageClear),
  securityStatus: () => ipcRenderer.invoke(IPC.securityStatus),
  dataSummary: () => ipcRenderer.invoke(IPC.dataSummary),
  dataClear: (scope: DataScope) => ipcRenderer.invoke(IPC.dataClear, scope),
  sweepStorage: () => ipcRenderer.invoke(IPC.storageSweep),
  diagnosticsList: () => ipcRenderer.invoke(IPC.diagnosticsList),
  diagnosticsClear: () => ipcRenderer.invoke(IPC.diagnosticsClear),

  getAutomationCapabilities: () => ipcRenderer.invoke(IPC.agentCapabilities),
  runAgent: (request: AgentRunRequest) => ipcRenderer.invoke(IPC.agentRun, request),
  cancelAgent: () => ipcRenderer.invoke(IPC.agentCancel),
  pauseAgent: () => ipcRenderer.invoke(IPC.agentPause),
  resumeAgent: () => ipcRenderer.invoke(IPC.agentResume),
  confirmAgent: (runId: string, approved: boolean) => ipcRenderer.invoke(IPC.agentConfirm, runId, approved),
  getAgentStatus: () => ipcRenderer.invoke(IPC.agentStatus),
  listAgentTasks: () => ipcRenderer.invoke(IPC.agentTasks),
  onAgentEvent: (listener: (event: AgentEvent) => void) => {
    const wrapped = (_event: unknown, payload: AgentEvent): void => listener(payload)
    ipcRenderer.on(IPC.agentEvent, wrapped)
    return () => {
      ipcRenderer.off(IPC.agentEvent, wrapped)
    }
  },

  memoryList: () => ipcRenderer.invoke(IPC.memoryList),
  memoryAdd: (draft: MemoryDraft) => ipcRenderer.invoke(IPC.memoryAdd, draft),
  memoryUpdate: (id: string, patch: Partial<MemoryDraft>) => ipcRenderer.invoke(IPC.memoryUpdate, id, patch),
  memoryDelete: (id: string) => ipcRenderer.invoke(IPC.memoryDelete, id),
  memoryClear: () => ipcRenderer.invoke(IPC.memoryClear),

  documentList: () => ipcRenderer.invoke(IPC.documentList),
  documentImport: () => ipcRenderer.invoke(IPC.documentImport),
  documentDelete: (id: string) => ipcRenderer.invoke(IPC.documentDelete, id),
  documentClear: () => ipcRenderer.invoke(IPC.documentClear),

  knowledgeSearch: (query: string) => ipcRenderer.invoke(IPC.knowledgeSearch, query),

  integrationList: () => ipcRenderer.invoke(IPC.integrationList),
  integrationTest: (id: string) => ipcRenderer.invoke(IPC.integrationTest, id),
  githubSetToken: (token: string) => ipcRenderer.invoke(IPC.githubSetToken, token),
  githubClearToken: () => ipcRenderer.invoke(IPC.githubClearToken),
  githubAccount: () => ipcRenderer.invoke(IPC.githubAccount),
  githubRepos: () => ipcRenderer.invoke(IPC.githubRepos),
  githubIssues: (ownerRepo: string) => ipcRenderer.invoke(IPC.githubIssues, ownerRepo),
  githubCreateIssue: (ownerRepo: string, title: string, body: string) =>
    ipcRenderer.invoke(IPC.githubCreateIssue, ownerRepo, title, body),



  meetingList: () => ipcRenderer.invoke(IPC.meetingList),
  meetingSave: (draft: MeetingDraft) => ipcRenderer.invoke(IPC.meetingSave, draft),
  meetingSummarize: (id: string) => ipcRenderer.invoke(IPC.meetingSummarize, id),
  meetingDelete: (id: string) => ipcRenderer.invoke(IPC.meetingDelete, id),
  meetingTranscriptAppend: (text: string) => ipcRenderer.invoke(IPC.meetingTranscriptAppend, text),
  meetingTranscriptGap: () => ipcRenderer.invoke(IPC.meetingTranscriptGap),
  meetingTranscriptGet: () => ipcRenderer.invoke(IPC.meetingTranscriptGet),
  meetingTranscriptDiscard: () => ipcRenderer.invoke(IPC.meetingTranscriptDiscard),

  workflowList: () => ipcRenderer.invoke(IPC.workflowList),
  workflowCreate: (draft: WorkflowDraft) => ipcRenderer.invoke(IPC.workflowCreate, draft),
  workflowDelete: (id: string) => ipcRenderer.invoke(IPC.workflowDelete, id),
  workflowRun: (id: string, input: string) => ipcRenderer.invoke(IPC.workflowRun, id, input),
  workflowRuns: () => ipcRenderer.invoke(IPC.workflowRuns),
  workflowCancel: (runId: string) => ipcRenderer.invoke(IPC.workflowCancel, runId),
  onWorkflowEvent: (listener: (event: WorkflowEvent) => void) => {
    const wrapped = (_event: unknown, payload: WorkflowEvent): void => listener(payload)
    ipcRenderer.on(IPC.workflowEvent, wrapped)
    return () => {
      ipcRenderer.off(IPC.workflowEvent, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('klyro', api)
