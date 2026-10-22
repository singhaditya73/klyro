import { app, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { AppSettings, DataScope, DataSummary, ProviderId, SendChatRequest, SecurityStatus } from '@shared/types'
import { logger } from '../logger'
import { getProvider } from '../providers'
import { PROVIDER_IDS } from '../providers/defaults'
import { isTrustedRendererUrl } from '../security/origins'
import { secrets } from '../security/secrets'
import { sendChat, abortChat } from './chat'
import { documents } from './documents'
import { diagnostics } from '../diagnostics'
import { maintenance } from './maintenance'
import { memory } from './memory'
import { privacy } from './privacy'
import { listProviderModels } from './provider-models'
import { interviews } from './interviews'
import { summarizeInterview } from './interview-summary'
import { transcribeAudio } from './audio'
import { applyOverlayDisplay, applyOverlayOpacity, applyOverlayPrivateMode, listDisplays, overlayPrivateModeSupported, setOverlayStickyRecording } from './windows'
import { conversations } from './conversations'
import { overlayCatalogue } from './overlay-models'
import { providersPatchSchema } from './provider-settings'
import { checkPermissions } from './permissions'
import { grabScreen, listCaptureSources, probeOverlayVisibility } from './screenshot'
import { settingsDomain } from './settings'
import { registerShortcuts } from './shortcuts'
import { antigravity } from './antigravity'
import { audit } from './audit'
import { usage } from './usage'
import { localAgents } from './local-agents'
import { findOpenCodeBinary, localAgentLauncher } from './local-agent-launcher'
import { listOpenCodeModels } from '../providers/opencode'
import { trimSlash } from '../providers/http'
/** Reject IPC from any frame that is not Klyro's own renderer. */
function assertTrusted(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  if (isTrustedRendererUrl(url)) return
  throw new Error(`Rejected IPC from untrusted origin: ${url || '(none)'}`)
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

/** Derived from the canonical provider list so a new provider cannot be
 *  forgotten here (which silently rejected the setting change). */
const providerIdSchema = z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]])

const idSchema = z.string().min(1).max(120)
const querySchema = z.string().max(500)
const dataScopeSchema = z.enum(['conversations', 'memory', 'documents', 'project', 'meetings', 'agentTasks'])
const conversationQuerySchema = z.object({ limit: z.number().int().positive().max(1000).optional() }).strict()

const settingsPatchSchema = z
  .object({
    activeProvider: providerIdSchema.optional(),
    systemPrompt: z.string().max(8000).optional(),
    responseStyle: z.enum(['concise', 'balanced', 'detailed']).optional(),
    theme: z.enum(['system', 'dark', 'light']).optional(),
    launchAtLogin: z.boolean().optional(),
    toggleShortcut: z.string().max(64).optional(),
    memoryEnabled: z.boolean().optional(),
    memoryAutoExtract: z.boolean().optional(),
    memoryRecallCount: z.number().int().min(1).max(20).optional(),
    knowledgeEnabled: z.boolean().optional(),
    documentRecallCount: z.number().int().min(1).max(10).optional(),
    screenAutoCapture: z.boolean().optional(),
    screenPreWarm: z.boolean().optional(),
    overlayDisplay: z.union([z.literal('primary'), z.number().int().min(0).max(7)]).optional(),
    overlayAnswerCache: z.boolean().optional(),
    retentionDays: z.number().int().min(0).max(3650).optional(),
    interviewEphemeralDefault: z.boolean().optional(),
    onboardingComplete: z.boolean().optional(),
    allowUnencryptedSecrets: z.boolean().optional(),
    overlayPrivateMode: z.boolean().optional(),
    overlayOpacity: z.number().int().min(20).max(100).optional(),
    diagnosticsOptIn: z.boolean().optional(),
    providers: providersPatchSchema.optional()
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
    .optional(),
  pinnedDocumentId: z.string().min(1).max(80).optional(),
  useFastModel: z.boolean().optional(),
  // The interview this question belongs to, when it was heard in one.
  interviewId: z.string().min(1).max(80).optional(),
  source: z.enum(['voice', 'text']).optional()
})


const memoryDraftSchema = z.object({
  text: z.string().min(1).max(4000),
  tags: z.array(z.string().max(40)).max(12).optional(),
  source: z.enum(['user', 'auto', 'agent']).optional(),
  pinned: z.boolean().optional()
})

const memoryPatchSchema = memoryDraftSchema.partial().strict()



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
    if ('overlayPrivateMode' in parsed) applyOverlayPrivateMode()
    if ('overlayOpacity' in parsed) applyOverlayOpacity()
    if ('overlayDisplay' in parsed) applyOverlayDisplay()
    if ('retentionDays' in parsed) {
      interviews.prune()
      conversations.prune()
      audit.prune()
    }
    return next
  })

  handle(IPC.providerList, () => settingsDomain.statuses())

  handle(IPC.providerSetKey, (_event, provider: unknown, key: unknown) => {
    const id = providerIdSchema.parse(provider) as ProviderId
    const value = z.string().max(4000).parse(key)
    if (!PROVIDER_IDS.includes(id)) throw new Error('Unknown provider')
    secrets.set(id, value)
    return settingsDomain.statuses()
  })

  handle(IPC.providerClearKey, (_event, provider: unknown) => {
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
  handle(IPC.conversationGet, (_event, id: unknown, query: unknown) =>
    conversations.window(idSchema.parse(id), conversationQuerySchema.parse(query ?? {}))
  )
  handle(IPC.conversationCreate, () => conversations.create())
  handle(IPC.conversationRename, (_event, id: unknown, title: unknown) => {
    conversations.rename(idSchema.parse(id), z.string().max(120).parse(title))
  })
  handle(IPC.conversationDelete, (_event, id: unknown) => {
    conversations.remove(idSchema.parse(id))
  })
  handle(IPC.conversationSearch, (_event, query: unknown) => conversations.search(querySchema.parse(query ?? '')))

  handle(IPC.captureSources, () => listCaptureSources())
  handle(IPC.captureGrab, (_event, sourceId?: unknown) =>
    grabScreen(sourceId === undefined ? undefined : z.string().max(300).parse(sourceId))
  )

  handle(IPC.transcribe, (_event, audio: unknown, mimeType: unknown) => {
    // MediaRecorder reports full mime types with codec parameters
    // ("audio/webm;codecs=opus", "audio/ogg;codecs=opus"). The codec suffix is
    // dropped here and only the bare type is validated, so the parameter keys
    // and values never reach anything else.
    const mime = z
      .string()
      .max(100)
      .transform((value) => value.split(';')[0]?.trim() ?? '')
      .pipe(z.string().regex(/^audio\/[a-z0-9.+-]+$/i))
      .parse(mimeType)
    const bytes =
      audio instanceof ArrayBuffer
        ? new Uint8Array(audio)
        : ArrayBuffer.isView(audio)
          ? new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength)
          : null
    if (!bytes) throw new Error('Invalid audio payload')
    if (bytes.byteLength === 0) throw new Error('The recording is empty')
    if (bytes.byteLength > 30 * 1024 * 1024) throw new Error('Audio clips are limited to 30 MB')
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return transcribeAudio(copy, mime).then((text) => ({ text }))
  })

  handle(IPC.permissionsCheck, () => checkPermissions())

  handle(IPC.securityStatus, (): SecurityStatus => ({
    encryptionAvailable: secrets.isEncryptionAvailable(),
    plaintextAllowed: settingsDomain.get().allowUnencryptedSecrets,
    hasPlaintextSecrets: secrets.hasPlaintextSecrets()
  }))

  handle(IPC.dataSummary, () => privacy.summary())
  handle(IPC.dataClear, (_event, scope: unknown) => privacy.clear(dataScopeSchema.parse(scope) as DataScope))
  handle(IPC.storageSweep, (): DataSummary => ({ ...privacy.summary(), storage: maintenance.sweep() }))
  handle(IPC.diagnosticsList, () => diagnostics.list())
  handle(IPC.diagnosticsClear, () => diagnostics.clear())


  handle(IPC.memoryList, () => memory.list())
  handle(IPC.memoryAdd, (_event, draft: unknown) => {
    memory.add(memoryDraftSchema.parse(draft))
    return memory.list()
  })
  handle(IPC.memoryUpdate, (_event, id: unknown, patch: unknown) => {
    memory.update(idSchema.parse(id), memoryPatchSchema.parse(patch))
    return memory.list()
  })
  handle(IPC.memoryDelete, (_event, id: unknown) => {
    memory.remove(idSchema.parse(id))
    return memory.list()
  })
  handle(IPC.memoryClear, () => {
    memory.clear()
    return memory.list()
  })

  handle(IPC.documentList, () => documents.list())
  handle(IPC.documentImport, () => documents.importFromDialog())
  handle(IPC.documentDelete, (_event, id: unknown) => {
    documents.remove(idSchema.parse(id))
    return documents.list()
  })
  handle(IPC.documentClear, () => {
    documents.clear()
    return documents.list()
  })

  handle(IPC.knowledgeSearch, (_event, query: unknown) => {
    const value = querySchema.parse(query ?? '')
    if (!value.trim()) return []
    return [...memory.search(value), ...documents.search(value)].sort((a, b) => b.score - a.score).slice(0, 40)
  })



  handle(IPC.windowPrivateModeStatus, () => ({
    supported: overlayPrivateModeSupported(),
    enabled: settingsDomain.get().overlayPrivateMode === true
  }))

  handle(IPC.overlaySetRecordingSticky, (_event, sticky: unknown) => {
    setOverlayStickyRecording(sticky === true)
  })

  /* ---------- Audit log ---------- */
  handle(IPC.auditList, (_event, limit: unknown) => audit.list(limit === undefined ? 200 : z.number().int().min(1).max(2000).parse(limit)))
  handle(IPC.auditClear, () => audit.clear())


  handle(IPC.usageRows, () => usage.rows())
  handle(IPC.privacyProbeOverlay, () => probeOverlayVisibility())
  handle(IPC.localAgentsDetect, () => localAgents.detect())
  handle(IPC.antigravityStatus, () => antigravity.status())
  handle(IPC.antigravityStartService, () => antigravity.startService())
  handle(IPC.antigravityConnect, () => antigravity.connect())
  handle(IPC.antigravityDisconnect, () => {
    antigravity.disconnect()
    return { ok: true }
  })
  handle(IPC.localAgentStartOpenCode, () => localAgentLauncher.startOpenCode())
  handle(IPC.localAgentConnectOpenCode, () => localAgentLauncher.connectOpenCode())
  handle(IPC.localAgentOpenCodePickModel, (_event, baseUrl: unknown) => {
    const parsed = z.string().max(500).optional().safeParse(baseUrl)
    return localAgentLauncher.pickOpenCodeModel(parsed.success ? parsed.data : undefined)
  })
  handle(IPC.localAgentOpenCodeInstalled, () => ({ installed: Boolean(findOpenCodeBinary()) }))
  handle(IPC.localAgentClis, () => localAgents.agentClis())
  /* ---------- Interview history ---------- */
  handle(IPC.interviewsList, (_event, query: unknown) => {
    const parsed = z
      .object({
        search: z.string().max(200).optional(),
        company: z.string().max(120).optional(),
        role: z.string().max(120).optional(),
        bookmarked: z.boolean().optional(),
        kind: z.enum(['technical', 'behavioral', 'project', 'general']).optional(),
        since: z.number().int().min(0).optional()
      })
      .strict()
      .parse(query ?? {})
    return interviews.list(parsed)
  })
  handle(IPC.interviewsGet, (_event, id: unknown) => interviews.get(z.string().min(1).max(80).parse(id)))
  handle(IPC.interviewsStart, (_event, input: unknown) => {
    const parsed = z
      .object({
        company: z.string().max(120).optional(),
        role: z.string().max(120).optional(),
        ephemeral: z.boolean().optional()
      })
      .parse(input ?? {})
    return interviews.start(parsed.company ?? '', parsed.role ?? '', { ephemeral: parsed.ephemeral })
  })
  handle(IPC.interviewsAddQuestion, (_event, input: unknown) => {
    const parsed = z
      .object({
        id: z.string().min(1).max(80),
        text: z.string().min(1).max(4000),
        source: z.enum(['voice', 'text']).default('voice'),
        answer: z.string().max(20000).optional(),
        answerMs: z.number().int().min(0).optional()
      })
      .parse(input)
    return interviews.addQuestion(parsed.id, parsed)
  })
  handle(IPC.interviewsAddTranscript, (_event, input: unknown) => {
    const parsed = z.object({ id: z.string().min(1).max(80), line: z.string().max(4000) }).parse(input)
    interviews.addTranscript(parsed.id, parsed.line)
    return true
  })
  handle(IPC.interviewsUpdate, (_event, input: unknown) => {
    const parsed = z
      .object({
        id: z.string().min(1).max(80),
        company: z.string().max(120).optional(),
        role: z.string().max(120).optional(),
        notes: z.string().max(20000).optional(),
        summary: z.string().max(20000).optional(),
        tags: z.array(z.string().max(40)).max(20).optional(),
        stage: z.enum(['technical', 'behavioral', 'project', 'general']).optional(),
        ephemeral: z.boolean().optional()
      })
      .parse(input)
    const { id, ...patch } = parsed
    return interviews.update(id, patch)
  })
  handle(IPC.interviewsUpdateQuestion, (_event, input: unknown) => {
    const parsed = z
      .object({
        id: z.string().min(1).max(80),
        questionId: z.string().min(1).max(80),
        note: z.string().max(4000).optional(),
        progress: z.enum(['asked', 'answered', 'skipped', 'followup']).optional(),
        answer: z.string().max(20000).optional(),
        bookmarked: z.boolean().optional()
      })
      .parse(input)
    const { id, questionId, ...patch } = parsed
    interviews.updateQuestion(id, questionId, patch)
    return true
  })
  handle(IPC.interviewsToggleBookmark, (_event, input: unknown) => {
    const parsed = z
      .object({ id: z.string().min(1).max(80), questionId: z.string().min(1).max(80).optional() })
      .parse(input)
    interviews.toggleBookmark(parsed.id, parsed.questionId)
    return true
  })
  handle(IPC.interviewsKeep, (_event, id: unknown) =>
    interviews.keep(z.string().min(1).max(80).parse(id))
  )
  handle(IPC.interviewsRemove, (_event, id: unknown) => {
    interviews.remove(z.string().min(1).max(80).parse(id))
    return true
  })
  handle(IPC.interviewsClear, () => {
    interviews.clear()
    return true
  })
  handle(IPC.interviewsFacets, () => interviews.facets())
  handle(IPC.interviewsSummarize, async (_event, id: unknown) => {
    const sessionId = z.string().min(1).max(80).parse(id)
    const session = interviews.get(sessionId)
    if (!session) return null
    const written = await summarizeInterview(session)
    if (!written) return null
    interviews.update(sessionId, { summary: written.summary, summaryModel: written.model })
    return written
  })

  handle(IPC.overlayCatalogue, () => overlayCatalogue())
  handle(IPC.providerModels, (_event, input: unknown) => {
    const providerId = z.enum(PROVIDER_IDS).parse(input)
    return listProviderModels(providerId)
  })
  handle(IPC.providerDetectModels, (_event, input: unknown) => {
    const parsed = z
      .object({ baseUrl: z.string().max(300), kind: z.enum(['opencode', 'openai-compatible']) })
      .strict()
      .parse(input)
    if (parsed.kind === 'opencode') {
      return listOpenCodeModels(parsed.baseUrl, null).catch(() => [] as string[])
    }
    return fetch(`${trimSlash(parsed.baseUrl)}/models`, { signal: AbortSignal.timeout(2500) })
      .then(async (response) => {
        if (!response.ok) return [] as string[]
        const payload = (await response.json()) as { data?: Array<{ id?: string }> }
        return (payload.data ?? []).map((entry) => entry.id ?? '').filter(Boolean).slice(0, 60)
      })
      .catch(() => [] as string[])
  })
  handle(IPC.screenListDisplays, () => listDisplays())
  handle(IPC.usageClear, () => {
    usage.clear()
  })
}
