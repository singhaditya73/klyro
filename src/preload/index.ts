import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AgentEvent,
  AgentRunRequest,
  AppSettings,
  ChatStreamEvent,
  CodeAssistRequest,
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
  onChatStream: (listener: (event: ChatStreamEvent) => void) => {
    const wrapped = (_event: unknown, payload: ChatStreamEvent): void => listener(payload)
    ipcRenderer.on(IPC.chatStream, wrapped)
    return () => {
      ipcRenderer.off(IPC.chatStream, wrapped)
    }
  },

  listConversations: () => ipcRenderer.invoke(IPC.conversationList),
  getConversation: (id: string) => ipcRenderer.invoke(IPC.conversationGet, id),
  createConversation: () => ipcRenderer.invoke(IPC.conversationCreate),
  renameConversation: (id: string, title: string) => ipcRenderer.invoke(IPC.conversationRename, id, title),
  deleteConversation: (id: string) => ipcRenderer.invoke(IPC.conversationDelete, id),
  searchConversations: (query: string) => ipcRenderer.invoke(IPC.conversationSearch, query),

  listCaptureSources: () => ipcRenderer.invoke(IPC.captureSources),
  grabScreen: (sourceId?: string) => ipcRenderer.invoke(IPC.captureGrab, sourceId),
  transcribe: (audio: ArrayBuffer, mimeType: string) => ipcRenderer.invoke(IPC.transcribe, audio, mimeType),

  checkPermissions: () => ipcRenderer.invoke(IPC.permissionsCheck),
  hideOverlay: () => ipcRenderer.invoke(IPC.windowHideOverlay),
  securityStatus: () => ipcRenderer.invoke(IPC.securityStatus),
  dataSummary: () => ipcRenderer.invoke(IPC.dataSummary),
  dataClear: (scope: DataScope) => ipcRenderer.invoke(IPC.dataClear, scope),

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
  githubSetToken: (token: string) => ipcRenderer.invoke(IPC.githubSetToken, token),
  githubClearToken: () => ipcRenderer.invoke(IPC.githubClearToken),
  githubAccount: () => ipcRenderer.invoke(IPC.githubAccount),
  githubRepos: () => ipcRenderer.invoke(IPC.githubRepos),
  githubIssues: (ownerRepo: string) => ipcRenderer.invoke(IPC.githubIssues, ownerRepo),
  githubCreateIssue: (ownerRepo: string, title: string, body: string) =>
    ipcRenderer.invoke(IPC.githubCreateIssue, ownerRepo, title, body),

  projectStatus: () => ipcRenderer.invoke(IPC.projectStatus),
  projectIndex: () => ipcRenderer.invoke(IPC.projectIndex),
  projectClear: () => ipcRenderer.invoke(IPC.projectClear),
  codeAssist: (request: CodeAssistRequest) => ipcRenderer.invoke(IPC.codeAssist, request),

  meetingList: () => ipcRenderer.invoke(IPC.meetingList),
  meetingSave: (draft: MeetingDraft) => ipcRenderer.invoke(IPC.meetingSave, draft),
  meetingSummarize: (id: string) => ipcRenderer.invoke(IPC.meetingSummarize, id),
  meetingDelete: (id: string) => ipcRenderer.invoke(IPC.meetingDelete, id),

  workflowList: () => ipcRenderer.invoke(IPC.workflowList),
  workflowCreate: (draft: WorkflowDraft) => ipcRenderer.invoke(IPC.workflowCreate, draft),
  workflowDelete: (id: string) => ipcRenderer.invoke(IPC.workflowDelete, id),
  workflowRun: (id: string, input: string) => ipcRenderer.invoke(IPC.workflowRun, id, input),
  onWorkflowEvent: (listener: (event: WorkflowEvent) => void) => {
    const wrapped = (_event: unknown, payload: WorkflowEvent): void => listener(payload)
    ipcRenderer.on(IPC.workflowEvent, wrapped)
    return () => {
      ipcRenderer.off(IPC.workflowEvent, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('klyro', api)
