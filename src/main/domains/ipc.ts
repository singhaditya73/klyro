import { app, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { AppSettings, DataScope, DataSummary, ProviderId, SendChatRequest, SecurityStatus, WorkflowDraft } from '@shared/types'
import { logger } from '../logger'
import { getProvider } from '../providers'
import { PROVIDER_IDS } from '../providers/defaults'
import { isTrustedRendererUrl } from '../security/origins'
import { secrets } from '../security/secrets'
import { sendChat, abortChat, respondTool } from './chat'
import { agentRunner } from './agent'
import { automation } from './automation'
import { documents } from './documents'
import { diagnostics } from '../diagnostics'
import { integrationStatuses, github, integrationTest } from './integrations'
import { meetings } from './meetings'
import { maintenance } from './maintenance'
import { memory } from './memory'
import { privacy } from './privacy'
import { workflows } from './workflows'
import { transcribeAudio } from './audio'
import { applyOverlayDisplay, applyOverlayOpacity, applyOverlayPrivateMode, getOverlayWindow, listDisplays, overlayPrivateModeSupported, setOverlayStickyRecording } from './windows'
import { conversations } from './conversations'
import { checkPermissions } from './permissions'
import { grabScreen, listCaptureSources, probeOverlayVisibility } from './screenshot'
import { settingsDomain } from './settings'
import { registerShortcuts } from './shortcuts'
import { mcp } from './mcp'
import { actions } from './actions'
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

const providerIdSchema = z.enum(['openai', 'anthropic', 'gemini', 'groq', 'ollama', 'openai-compatible'])

const idSchema = z.string().min(1).max(120)
const querySchema = z.string().max(500)
const titleSchema = z.string().max(200)
const bodySchema = z.string().max(20000)
const tokenSchema = z.string().max(500)
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
    agentConfirmConsequential: z.boolean().optional(),
    agentMaxSteps: z.number().int().min(1).max(30).optional(),
    memoryEnabled: z.boolean().optional(),
    memoryAutoExtract: z.boolean().optional(),
    memoryRecallCount: z.number().int().min(1).max(20).optional(),
    knowledgeEnabled: z.boolean().optional(),
    documentRecallCount: z.number().int().min(1).max(10).optional(),
    chatMcpTools: z.boolean().optional(),
    screenAutoCapture: z.boolean().optional(),
    screenPreWarm: z.boolean().optional(),
    overlayDisplay: z.union([z.literal('primary'), z.number().int().min(0).max(7)]).optional(),
    overlayAnswerCache: z.boolean().optional(),
    onboardingComplete: z.boolean().optional(),
    allowUnencryptedSecrets: z.boolean().optional(),
    overlayPrivateMode: z.boolean().optional(),
    overlayOpacity: z.number().int().min(20).max(100).optional(),
    diagnosticsOptIn: z.boolean().optional(),
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
    .optional(),
  pinnedDocumentId: z.string().min(1).max(80).optional(),
  useFastModel: z.boolean().optional()
    .optional()
})

const agentRunSchema = z.object({
  goal: z.string().min(1).max(4000),
  maxSteps: z.number().int().min(1).max(30).optional()
})

const memoryDraftSchema = z.object({
  text: z.string().min(1).max(4000),
  tags: z.array(z.string().max(40)).max(12).optional(),
  source: z.enum(['user', 'auto', 'agent']).optional(),
  pinned: z.boolean().optional()
})

const memoryPatchSchema = memoryDraftSchema.partial().strict()

const ownerRepoSchema = z.string().min(3).max(200)

const meetingDraftSchema = z.object({
  title: z.string().max(200),
  startedAt: z.number(),
  endedAt: z.number(),
  segments: z.array(z.object({ at: z.number(), text: z.string().max(4000) })).max(4000)
})

const workflowStepOptions = {
  id: z.string().max(60).optional(),
  name: z.string().min(1).max(80),
  onFailure: z.enum(['stop', 'continue']).optional(),
  retries: z.number().int().min(0).max(3).optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
  output: z.string().max(60).optional()
}

const workflowStepSchema = z.union([
  z.object({ ...workflowStepOptions, kind: z.literal('prompt'), template: z.string().min(1).max(8000) }),
  z.object({ ...workflowStepOptions, kind: z.literal('githubIssues'), repo: z.string().max(300) }),
  z.object({
    ...workflowStepOptions,
    kind: z.literal('githubCreateIssue'),
    repo: z.string().max(300),
    title: z.string().max(200),
    body: z.string().max(20000)
  }),
  z.object({ ...workflowStepOptions, kind: z.literal('knowledge'), query: z.string().max(500) }),
  z.object({ ...workflowStepOptions, kind: z.literal('meetingSummary'), meetingId: z.string().max(80) })
])

const workflowDraftSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
  steps: z.array(workflowStepSchema).min(1).max(12)
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
    if ('overlayPrivateMode' in parsed) applyOverlayPrivateMode()
    if ('overlayOpacity' in parsed) applyOverlayOpacity()
    if ('overlayDisplay' in parsed) applyOverlayDisplay()
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

  handle(IPC.agentCapabilities, () => automation.capabilities())
  handle(IPC.agentStatus, () => agentRunner.status())
  handle(IPC.agentTasks, () => agentRunner.tasks())
  handle(IPC.agentRun, async (_event, request: unknown) => {
    const parsed = agentRunSchema.parse(request)
    if (agentRunner.status().running) throw new Error('A task is already running.')
    const caps = await automation.capabilities()
    if (!caps.available) {
      const hint = caps.installHint ? ` Install a backend, e.g.: ${caps.installHint}` : ''
      throw new Error(`Desktop automation is unavailable on this system.${hint}`)
    }
    // Fire-and-forget: progress and outcome arrive via the agentEvent channel.
    void agentRunner.run(parsed).catch((error) => logger.error('Agent run rejected', (error as Error).message))
  })
  handle(IPC.agentCancel, () => {
    agentRunner.cancel()
  })
  handle(IPC.agentPause, () => {
    agentRunner.pause()
  })
  handle(IPC.agentResume, () => {
    agentRunner.resume()
  })
  handle(IPC.agentConfirm, (_event, runId: string, approved: boolean) => {
    if (typeof runId !== 'string' || runId.length > 120) throw new Error('Invalid run id')
    agentRunner.confirm(runId, approved === true)
  })

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

  handle(IPC.integrationList, () => integrationStatuses())
  handle(IPC.integrationTest, (_event, id: unknown) =>
    integrationTest(z.enum(['github']).parse(idSchema.parse(id)))
  )
  handle(IPC.githubSetToken, (_event, token: unknown) => {
    github.setToken(tokenSchema.parse(token ?? '').trim())
    return integrationStatuses()
  })
  handle(IPC.githubClearToken, () => {
    github.clearToken()
    return integrationStatuses()
  })
  handle(IPC.githubAccount, () => github.whoami())
  handle(IPC.githubRepos, () => github.repos(30))
  handle(IPC.githubIssues, (_event, ownerRepo: unknown) => github.issues(ownerRepoSchema.parse(ownerRepo), 30))
  handle(IPC.githubCreateIssue, (_event, ownerRepo: unknown, title: unknown, body: unknown) =>
    github.createIssue(ownerRepoSchema.parse(ownerRepo), titleSchema.parse(title ?? ''), bodySchema.parse(body ?? ''))
  )



  handle(IPC.meetingList, () => meetings.list())
  handle(IPC.meetingSave, (_event, draft: unknown) => {
    meetings.save(meetingDraftSchema.parse(draft))
    return meetings.list()
  })
  handle(IPC.meetingSummarize, async (_event, id: unknown) => {
    await meetings.summarize(idSchema.parse(id))
    return meetings.list()
  })
  handle(IPC.meetingDelete, (_event, id: unknown) => {
    meetings.remove(idSchema.parse(id))
    return meetings.list()
  })
  handle(IPC.meetingTranscriptAppend, (_event, text: unknown) =>
    meetings.appendTranscript(z.string().max(40000).parse(text ?? ''))
  )
  handle(IPC.meetingTranscriptGap, () => meetings.markTranscriptGap())
  handle(IPC.meetingTranscriptGet, () => meetings.liveTranscript())
  handle(IPC.meetingTranscriptDiscard, () => {
    meetings.discardLiveTranscript()
    return meetings.list()
  })

  handle(IPC.workflowList, () => workflows.list())
  handle(IPC.workflowCreate, (_event, draft: unknown) => {
    workflows.create(workflowDraftSchema.parse(draft) as WorkflowDraft)
    return workflows.list()
  })
  handle(IPC.workflowDelete, (_event, id: string) => {
    workflows.remove(String(id))
    return workflows.list()
  })
  handle(IPC.workflowRun, (_event, id: unknown, input: unknown) =>
    workflows.run(idSchema.parse(id), z.string().max(40000).parse(input ?? ''))
  )
  handle(IPC.workflowRuns, () => workflows.runs())
  handle(IPC.workflowCancel, (_event, runId: unknown) => workflows.cancel(idSchema.parse(runId)))

  handle(IPC.windowHideOverlay, () => {
    const win = getOverlayWindow()
    win?.hide()
  })

  handle(IPC.windowPrivateModeStatus, () => ({
    supported: overlayPrivateModeSupported(),
    enabled: settingsDomain.get().overlayPrivateMode === true
  }))

  handle(IPC.overlaySetRecordingSticky, (_event, sticky: unknown) => {
    setOverlayStickyRecording(sticky === true)
  })

  /* ---------- MCP connector ---------- */
  handle(IPC.mcpServers, () => mcp.states())

  const mcpServerSchema = z
    .object({
      name: z.string().min(1).max(80),
      command: z.string().min(1).max(500),
      args: z.array(z.string().max(500)).max(32).optional()
    })
    .strict()
  handle(IPC.mcpAddServer, (_event, input: unknown) => {
    const parsed = mcpServerSchema.parse(input)
    return mcp.add(parsed.name, parsed.command, parsed.args ?? [])
  })

  handle(IPC.mcpRemoveServer, (_event, id: unknown) => {
    mcp.remove(z.string().min(1).max(80).parse(id))
  })

  handle(IPC.mcpRefreshTools, (_event, id: unknown) => mcp.tools(z.string().min(1).max(80).parse(id)))

  handle(IPC.mcpCallTool, (_event, input: unknown) => {
    const parsed = z
      .object({ serverId: z.string().min(1).max(80), name: z.string().min(1).max(200), args: z.record(z.string(), z.unknown()).optional() })
      .strict()
      .parse(input)
    return mcp.call(parsed.serverId, parsed.name, parsed.args ?? {})
  })

  /* ---------- Post-meeting action agent ---------- */
  handle(IPC.meetingProposeActions, (_event, id: unknown) => actions.propose(z.string().min(1).max(80).parse(id)))

  handle(IPC.meetingExecuteActions, (_event, input: unknown) => {
    const parsed = z
      .object({
        meetingId: z.string().min(1).max(80),
        proposals: z
          .array(
            z
              .object({
                kind: z.enum(['github-issue', 'manual']),
                repo: z.string().max(300).nullable().optional(),
                title: z.string().min(1).max(200),
                body: z.string().max(12000),
                reason: z.string().max(300)
              })
              .strict()
          )
          .max(20)
      })
      .strict()
      .parse(input)
    return actions.execute(
      parsed.meetingId,
      parsed.proposals.map((proposal) => ({ ...proposal, repo: proposal.repo ?? null }))
    )
  })

  /* ---------- Audit log ---------- */
  handle(IPC.auditList, (_event, limit: unknown) => audit.list(limit === undefined ? 200 : z.number().int().min(1).max(2000).parse(limit)))
  handle(IPC.auditClear, () => audit.clear())

  handle(IPC.chatRespondTool, (_event, input: unknown) => {
    const parsed = z
      .object({ callId: z.string().min(1).max(120), approved: z.boolean() })
      .strict()
      .parse(input)
    respondTool(parsed.callId, parsed.approved)
  })

  handle(IPC.usageRows, () => usage.rows())
  handle(IPC.privacyProbeOverlay, () => probeOverlayVisibility())
  handle(IPC.localAgentsDetect, () => localAgents.detect())
  handle(IPC.localAgentStartOpenCode, () => localAgentLauncher.startOpenCode())
  handle(IPC.localAgentOpenCodeInstalled, () => ({ installed: Boolean(findOpenCodeBinary()) }))
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
  handle(IPC.mcpReadResource, async (_event, input: unknown) => {
    const parsed = z
      .object({ serverId: z.string().min(1).max(80), uri: z.string().min(1).max(2000) })
      .strict()
      .parse(input)
    return { text: await mcp.readResource(parsed.serverId, parsed.uri) }
  })
  handle(IPC.screenListDisplays, () => listDisplays())
  handle(IPC.usageClear, () => {
    usage.clear()
  })
}
