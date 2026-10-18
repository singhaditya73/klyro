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

  agentCapabilities: 'agent:capabilities',
  agentRun: 'agent:run',
  agentCancel: 'agent:cancel',
  agentConfirm: 'agent:confirm',
  agentStatus: 'agent:status',
  agentTasks: 'agent:tasks',
  agentEvent: 'agent:event',

  windowHideOverlay: 'window:hideOverlay',
  windowToggleOverlay: 'window:toggleOverlay'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
