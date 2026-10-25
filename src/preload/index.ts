import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppSettings,
  ChatStreamEvent,
  ConversationQuery,
  DataScope,
  KlyroApi,
  MemoryDraft,
  ProviderId,
  SendChatRequest
} from '@shared/types'

const api: KlyroApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  quitApp: () => ipcRenderer.invoke(IPC.appQuit),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  onSettingsChanged: (listener: () => void) => {
    const wrapped = (): void => listener()
    ipcRenderer.on(IPC.settingsChanged, wrapped)
    return () => {
      ipcRenderer.off(IPC.settingsChanged, wrapped)
    }
  },
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
  getConversation: (id: string, query?: ConversationQuery) =>
    ipcRenderer.invoke(IPC.conversationGet, id, query),
  createConversation: () => ipcRenderer.invoke(IPC.conversationCreate),
  renameConversation: (id: string, title: string) => ipcRenderer.invoke(IPC.conversationRename, id, title),
  deleteConversation: (id: string) => ipcRenderer.invoke(IPC.conversationDelete, id),
  searchConversations: (query: string) => ipcRenderer.invoke(IPC.conversationSearch, query),

  listCaptureSources: () => ipcRenderer.invoke(IPC.captureSources),
  grabScreen: (sourceId?: string) => ipcRenderer.invoke(IPC.captureGrab, sourceId),
  transcribe: (audio: ArrayBuffer, mimeType: string, pcm?: string | ArrayBuffer) => {
    let pcmBase64: string | undefined
    if (pcm instanceof ArrayBuffer) {
      pcmBase64 = Buffer.from(pcm).toString('base64')
    } else if (typeof pcm === 'string') {
      pcmBase64 = pcm
    }
    return ipcRenderer.invoke(IPC.transcribe, audio, mimeType, pcmBase64)
  },
  prewarmTranscribe: () => ipcRenderer.invoke(IPC.transcribePrewarm),
  ocrExtract: (image: string) => ipcRenderer.invoke(IPC.ocrExtract, image),

  checkPermissions: () => ipcRenderer.invoke(IPC.permissionsCheck),
  hideOverlay: () => ipcRenderer.invoke(IPC.windowHideOverlay),
  minimizeOverlay: () => ipcRenderer.invoke(IPC.windowMinimizeOverlay),
  toggleOverlay: () => ipcRenderer.invoke(IPC.windowToggleOverlay),
  resizeOverlay: (height: number, width?: number) => ipcRenderer.invoke(IPC.overlayResize, height, width),
  privateModeStatus: () => ipcRenderer.invoke(IPC.windowPrivateModeStatus),
  setRecordingSticky: (sticky: boolean) => ipcRenderer.invoke(IPC.overlaySetRecordingSticky, sticky),
  shortcutStatus: () => ipcRenderer.invoke(IPC.shortcutsStatus),



  auditList: (limit?: number) => ipcRenderer.invoke(IPC.auditList, limit),
  auditClear: () => ipcRenderer.invoke(IPC.auditClear),
  usageRows: () => ipcRenderer.invoke(IPC.usageRows),
  privacyProbeOverlay: () => ipcRenderer.invoke(IPC.privacyProbeOverlay),
  localAgentsDetect: () => ipcRenderer.invoke(IPC.localAgentsDetect),
  antigravityStatus: () => ipcRenderer.invoke(IPC.antigravityStatus),
  antigravityStartService: () => ipcRenderer.invoke(IPC.antigravityStartService),
  antigravityConnect: () => ipcRenderer.invoke(IPC.antigravityConnect),
  antigravityDisconnect: () => ipcRenderer.invoke(IPC.antigravityDisconnect),
  providerModels: (providerId: string) => ipcRenderer.invoke(IPC.providerModels, providerId),
  overlayCatalogue: () => ipcRenderer.invoke(IPC.overlayCatalogue),
  interviewsList: (query?: unknown) => ipcRenderer.invoke(IPC.interviewsList, query),
  interviewsGet: (id: string) => ipcRenderer.invoke(IPC.interviewsGet, id),
  interviewsStart: (input?: { company?: string; role?: string }) => ipcRenderer.invoke(IPC.interviewsStart, input),
  interviewsAddQuestion: (input: {
    id: string
    text: string
    source: 'voice' | 'text'
    answer?: string
    answerMs?: number
  }) => ipcRenderer.invoke(IPC.interviewsAddQuestion, input),
  interviewsAddTranscript: (input: { id: string; line: string }) => ipcRenderer.invoke(IPC.interviewsAddTranscript, input),
  interviewsUpdate: (input: {
    id: string
    company?: string
    role?: string
    notes?: string
    summary?: string
    tags?: string[]
    stage?: 'technical' | 'behavioral' | 'project' | 'general'
    ephemeral?: boolean
  }) => ipcRenderer.invoke(IPC.interviewsUpdate, input),
  interviewsUpdateQuestion: (input: {
    id: string
    questionId: string
    note?: string
    progress?: 'asked' | 'answered' | 'skipped' | 'followup'
    answer?: string
    bookmarked?: boolean
  }) => ipcRenderer.invoke(IPC.interviewsUpdateQuestion, input),
  interviewsToggleBookmark: (input: { id: string; questionId?: string }) =>
    ipcRenderer.invoke(IPC.interviewsToggleBookmark, input),
  interviewsKeep: (id: string) => ipcRenderer.invoke(IPC.interviewsKeep, id),
  interviewsRemove: (id: string) => ipcRenderer.invoke(IPC.interviewsRemove, id),
  interviewsClear: () => ipcRenderer.invoke(IPC.interviewsClear),
  interviewsFacets: () => ipcRenderer.invoke(IPC.interviewsFacets),
  interviewsSummarize: (id: string) => ipcRenderer.invoke(IPC.interviewsSummarize, id),
  interviewsGenerateCrmNotes: (input: { id: string; meetingType?: string }) =>
    ipcRenderer.invoke(IPC.interviewsGenerateCrmNotes, input),
  interviewsExportMarkdown: (id: string) => ipcRenderer.invoke(IPC.interviewsExportMarkdown, id),
  localAgentStartOpenCode: () => ipcRenderer.invoke(IPC.localAgentStartOpenCode),
  localAgentConnectOpenCode: () => ipcRenderer.invoke(IPC.localAgentConnectOpenCode),
  openCodePickModel: (baseUrl?: string) => ipcRenderer.invoke(IPC.localAgentOpenCodePickModel, baseUrl),
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

  integrationsGet: () => ipcRenderer.invoke(IPC.integrationsGet),
  integrationsUpdate: (patch: any) => ipcRenderer.invoke(IPC.integrationsUpdate, patch),
  integrationsSendSlack: (input: { message: string; webhookUrl?: string }) =>
    ipcRenderer.invoke(IPC.integrationsSendSlack, input),
  integrationsSendCrm: (input: { payload: Record<string, unknown>; webhookUrl?: string }) =>
    ipcRenderer.invoke(IPC.integrationsSendCrm, input),

  mcpServers: () => ipcRenderer.invoke(IPC.mcpServers),
  mcpAddServer: (input: any) => ipcRenderer.invoke(IPC.mcpAddServer, input),
  mcpRemoveServer: (id: string) => ipcRenderer.invoke(IPC.mcpRemoveServer, id),
  mcpToggleServer: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.mcpToggleServer, { id, enabled }),
  mcpTestServer: (id: string) => ipcRenderer.invoke(IPC.mcpTestServer, id)
}

contextBridge.exposeInMainWorld('klyro', api)
