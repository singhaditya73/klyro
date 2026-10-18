/** IPC channel names. Single source of truth for main + preload. */
export const IPC = {
  appInfo: 'app:info',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  providerList: 'provider:list',
  providerSetKey: 'provider:setKey',
  providerClearKey: 'provider:clearKey',
  providerTest: 'provider:test',

  chatSend: 'chat:send',
  chatAbort: 'chat:abort',
  chatStream: 'chat:stream',

  conversationList: 'conversation:list',
  conversationGet: 'conversation:get',
  conversationCreate: 'conversation:create',
  conversationRename: 'conversation:rename',
  conversationDelete: 'conversation:delete',
  conversationSearch: 'conversation:search',

  captureSources: 'capture:sources',
  captureGrab: 'capture:grab',
  transcribe: 'audio:transcribe',

  permissionsCheck: 'permissions:check',

  securityStatus: 'security:status',
  dataSummary: 'data:summary',
  dataClear: 'data:clear',

  agentCapabilities: 'agent:capabilities',
  agentRun: 'agent:run',
  agentCancel: 'agent:cancel',
  agentPause: 'agent:pause',
  agentResume: 'agent:resume',
  agentConfirm: 'agent:confirm',
  agentStatus: 'agent:status',
  agentTasks: 'agent:tasks',
  agentEvent: 'agent:event',

  memoryList: 'memory:list',
  memoryAdd: 'memory:add',
  memoryUpdate: 'memory:update',
  memoryDelete: 'memory:delete',
  memoryClear: 'memory:clear',

  documentList: 'document:list',
  documentImport: 'document:import',
  documentDelete: 'document:delete',
  documentClear: 'document:clear',

  knowledgeSearch: 'knowledge:search',

  integrationList: 'integration:list',
  githubSetToken: 'integration:github:setToken',
  githubClearToken: 'integration:github:clearToken',
  githubAccount: 'integration:github:account',
  githubRepos: 'integration:github:repos',
  githubIssues: 'integration:github:issues',
  githubCreateIssue: 'integration:github:createIssue',

  projectStatus: 'project:status',
  projectIndex: 'project:index',
  projectClear: 'project:clear',
  codeAssist: 'code:assist',

  meetingList: 'meeting:list',
  meetingSave: 'meeting:save',
  meetingSummarize: 'meeting:summarize',
  meetingDelete: 'meeting:delete',

  workflowList: 'workflow:list',
  workflowCreate: 'workflow:create',
  workflowDelete: 'workflow:delete',
  workflowRun: 'workflow:run',
  workflowRuns: 'workflow:runs',
  workflowCancel: 'workflow:cancel',
  workflowEvent: 'workflow:event',

  windowHideOverlay: 'window:hideOverlay',
  windowToggleOverlay: 'window:toggleOverlay'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
