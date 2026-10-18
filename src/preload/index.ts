import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AgentEvent,
  AgentRunRequest,
  AppSettings,
  ChatStreamEvent,
  KlyroApi,
  ProviderId,
  SendChatRequest
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

  getAutomationCapabilities: () => ipcRenderer.invoke(IPC.agentCapabilities),
  runAgent: (request: AgentRunRequest) => ipcRenderer.invoke(IPC.agentRun, request),
  cancelAgent: () => ipcRenderer.invoke(IPC.agentCancel),
  confirmAgent: (runId: string, approved: boolean) => ipcRenderer.invoke(IPC.agentConfirm, runId, approved),
  getAgentStatus: () => ipcRenderer.invoke(IPC.agentStatus),
  listAgentTasks: () => ipcRenderer.invoke(IPC.agentTasks),
  onAgentEvent: (listener: (event: AgentEvent) => void) => {
    const wrapped = (_event: unknown, payload: AgentEvent): void => listener(payload)
    ipcRenderer.on(IPC.agentEvent, wrapped)
    return () => {
      ipcRenderer.off(IPC.agentEvent, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('klyro', api)
