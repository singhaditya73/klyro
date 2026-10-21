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
  storageSweep: 'storage:sweep',
  diagnosticsList: 'diagnostics:list',
  diagnosticsClear: 'diagnostics:clear',


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






  windowHideOverlay: 'window:hideOverlay',
  windowToggleOverlay: 'window:toggleOverlay',
  windowPrivateModeStatus: 'window:privateModeStatus',
  overlaySetRecordingSticky: 'overlay:setRecordingSticky',

  /* MCP connector */

  /* Post-meeting action agent + output ledger */

  /* Audit log */
  auditList: 'audit:list',
  auditClear: 'audit:clear',

  /* Tool approvals (chat MCP loop) */

  /* Local usage ledger */
  usageRows: 'usage:rows',
  usageClear: 'usage:clear',

  /* MCP resources */

  /* Antigravity: the local agent IDE, read directly from its own service */
  antigravityStatus: 'antigravity:status',
  antigravityStartService: 'antigravity:startService',
  antigravityConnect: 'antigravity:connect',
  antigravityDisconnect: 'antigravity:disconnect',
  /** The models a provider can serve, so the user can pick one. */
  providerModels: 'provider:models',

  /* Interview history */
  interviewsList: 'interviews:list',
  interviewsGet: 'interviews:get',
  interviewsStart: 'interviews:start',
  interviewsAddQuestion: 'interviews:addQuestion',
  interviewsAddTranscript: 'interviews:addTranscript',
  interviewsUpdate: 'interviews:update',
  interviewsUpdateQuestion: 'interviews:updateQuestion',
  interviewsToggleBookmark: 'interviews:toggleBookmark',
  interviewsRemove: 'interviews:remove',
  interviewsClear: 'interviews:clear',
  interviewsFacets: 'interviews:facets',
  interviewsSummarize: 'interviews:summarize',

  /* Import MCP servers from tools the user already runs */

  /* Local agents: what is already running on this machine */
  localAgentsDetect: 'local-agents:detect',
  localAgentStartOpenCode: 'local-agents:startOpenCode',
  localAgentConnectOpenCode: 'local-agents:connectOpenCode',
  localAgentOpenCodeInstalled: 'local-agents:openCodeInstalled',
  localAgentClis: 'local-agents:clis',
  providerDetectModels: 'provider:detectModels',

  /* Privacy: does this machine exclude the overlay from screen captures? */
  privacyProbeOverlay: 'privacy:probeOverlay',
  screenListDisplays: 'screen:listDisplays'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
