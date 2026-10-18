import { app, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { AppSettings, ProviderId, SendChatRequest } from '@shared/types'
import { logger } from '../logger'
import { getProvider } from '../providers'
import { PROVIDER_IDS } from '../providers/defaults'
import { secrets } from '../security/secrets'
import { sendChat, abortChat } from './chat'
import { transcribeAudio } from './audio'
import { conversations } from './conversations'
import { checkPermissions } from './permissions'
import { grabScreen, listCaptureSources } from './screenshot'
import { settingsDomain } from './settings'
import { registerShortcuts } from './shortcuts'
import { getOverlayWindow } from './windows'

const allowedOrigins = new Set<string>()
const devUrl = process.env.ELECTRON_RENDERER_URL
if (devUrl) {
  try {
    allowedOrigins.add(new URL(devUrl).origin)
  } catch {
    // ignore malformed dev URL
  }
}

/** Reject IPC from any frame that is not our own renderer. */
function assertTrusted(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  if (url.startsWith('file://')) return
  if (url === '' || url === 'about:blank') return
  try {
    if (allowedOrigins.has(new URL(url).origin)) return
  } catch {
    // fall through to rejection
  }
  throw new Error(`Rejected IPC from untrusted origin: ${url}`)
}

function handle<A extends unknown[], R>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrusted(event)
    return fn(event, ...(args as A))
  })
}

const providerIdSchema = z.enum(['openai', 'anthropic', 'gemini', 'ollama', 'openai-compatible'])

const settingsPatchSchema = z
  .object({
    activeProvider: providerIdSchema.optional(),
    systemPrompt: z.string().max(8000).optional(),
    responseStyle: z.enum(['concise', 'balanced', 'detailed']).optional(),
    theme: z.enum(['system', 'dark', 'light']).optional(),
    launchAtLogin: z.boolean().optional(),
    toggleShortcut: z.string().max(64).optional(),
    providers: z
      .record(z.string(), z.object({ baseUrl: z.string().max(500), model: z.string().max(200) }))
      .optional()
  })
  .strict()

const sendChatSchema = z.object({
  conversationId: z.string().min(1).max(120),
  content: z.string().max(50000),
  attachments: z
    .array(
      z.object({
        kind: z.literal('image'),
        mime: z.string().max(100),
        dataUrl: z.string().max(40_000_000),
        label: z.string().max(200).optional()
      })
    )
    .max(8)
    .optional()
})

export function registerIpcHandlers(): void {
  handle(IPC.appInfo, () => ({
    name: 'Klyro',
    version: app.getVersion(),
    tagline: 'Your AI. Your entire computer.',
    platform: process.platform
  }))

  handle(IPC.settingsGet, () => settingsDomain.get())

  handle(IPC.settingsUpdate, (_event, patch: unknown) => {
    const parsed = settingsPatchSchema.parse(patch) as Partial<AppSettings>
    const next = settingsDomain.update(parsed)
    if ('launchAtLogin' in parsed) {
      try {
        app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
      } catch (error) {
        logger.warn('Failed to update login item', error)
      }
    }
    if ('toggleShortcut' in parsed) registerShortcuts()
    return next
  })

  handle(IPC.providerList, () => settingsDomain.statuses())

  handle(IPC.providerSetKey, (_event, provider: string, key: string) => {
    const id = providerIdSchema.parse(provider) as ProviderId
    if (typeof key !== 'string' || key.length > 4000) throw new Error('Invalid API key')
    if (!PROVIDER_IDS.includes(id)) throw new Error('Unknown provider')
    secrets.set(id, key)
    return settingsDomain.statuses()
  })

  handle(IPC.providerClearKey, (_event, provider: string) => {
    const id = providerIdSchema.parse(provider) as ProviderId
    secrets.delete(id)
    return settingsDomain.statuses()
  })

  handle(IPC.providerTest, async (_event, provider: string) => {
    const id = providerIdSchema.parse(provider) as ProviderId
    const providerSettings = settingsDomain.provider(id)
    return getProvider(id).test({
      baseUrl: providerSettings.baseUrl,
      apiKey: settingsDomain.apiKey(id),
      model: providerSettings.model
    })
  })

  handle(IPC.chatSend, async (_event, request: unknown) => {
    await sendChat(sendChatSchema.parse(request) as SendChatRequest)
  })

  handle(IPC.chatAbort, () => {
    abortChat()
  })

  handle(IPC.conversationList, () => conversations.list())
  handle(IPC.conversationGet, (_event, id: string) => conversations.get(String(id)))
  handle(IPC.conversationCreate, () => conversations.create())
  handle(IPC.conversationRename, (_event, id: string, title: string) => {
    conversations.rename(String(id), String(title))
  })
  handle(IPC.conversationDelete, (_event, id: string) => {
    conversations.remove(String(id))
  })
  handle(IPC.conversationSearch, (_event, query: string) => conversations.search(String(query ?? '')))

  handle(IPC.captureSources, () => listCaptureSources())
  handle(IPC.captureGrab, (_event, sourceId?: string) =>
    grabScreen(typeof sourceId === 'string' ? sourceId : undefined)
  )

  handle(IPC.transcribe, (_event, audio: ArrayBuffer, mimeType: string) =>
    transcribeAudio(audio, String(mimeType || 'audio/webm')).then((text) => ({ text }))
  )

  handle(IPC.permissionsCheck, () => checkPermissions())

  handle(IPC.windowHideOverlay, () => {
    const win = getOverlayWindow()
    win?.hide()
  })
}
