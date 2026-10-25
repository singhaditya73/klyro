import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { ChatStreamEvent, Conversation, ResponseStyle, SendChatRequest } from '@shared/types'
import { IPC } from '@shared/ipc'
import { logger } from '../logger'
import { getProvider } from '../providers'
import { DEFAULT_PROVIDERS, PROVIDER_META } from '../providers/defaults'
import { classifyThrown, ProviderError, toUserMessage } from '../providers/errors'
import { providerCarriesImages, resolveRoute, visionSupport } from '../providers/routing'
import { ocrExtractText } from './ocr'
import type { ChatTurn } from '../providers/types'
import type { ProviderId } from '@shared/types'
import { audit } from './audit'
import { StreamStalledError, withIdleTimeout } from '../util/idle-timeout'
import { conversations } from './conversations'
import { buildKnowledgeContext } from './context'
import { adviceFor, classifyQuestion, contextBlock } from './interview-model'
import { daemon } from './daemon'
import { interviews } from './interviews'
import { antigravity as antigravityDomain } from './antigravity'
import { findClaudeBinary } from '../providers/claude-code'
import { findCodexBinary } from '../providers/codex'
import { documents } from './documents'
import { memory } from './memory'
import { settingsDomain } from './settings'
import { usage } from './usage'
import { answerCache, AnswerCache } from './answer-cache'
import { wrapUntrusted } from '../security/untrusted'

let controller: AbortController | null = null

interface PendingTool {
  messageId: string
  callId: string
  name: string
  args: string
  resolve: (approved: boolean) => void
}
/** The tool call waiting for the user's answer, at most one at a time. */
let pendingTool: PendingTool | null = null

function emit(event: ChatStreamEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.chatStream, event)
  }
}

function styleSuffix(style: ResponseStyle): string {
  switch (style) {
    case 'concise':
      return '\n\nBe concise: prefer short, direct answers.'
    case 'detailed':
      return '\n\nBe thorough: explain your reasoning and provide detail.'
    default:
      return ''
  }
}

/**
 * The providers the daemon can answer for: the OpenAI-shaped family, which
 * is the same shape the daemon speaks.
 */
/** The agent CLI to run, for the providers that are programs. */
function binaryFor(providerId: ProviderId): string | null {
  if (providerId === 'claude-code') return findClaudeBinary()
  if (providerId === 'codex') return findCodexBinary()
  return null
}

const DAEMON_PROVIDERS = new Set<ProviderId>([
  'openai',
  'groq',
  'openai-compatible',
  'ollama',
  'opencode',
  'claude-code',
  'codex',
  'antigravity'
])

/**
 * How much history is sent to the model. Without a bound, a long conversation
 * grows every request (and its cost) forever; the newest turns are the ones that
 * matter for the next answer.
 */
export const MAX_CONTEXT_TURNS = 40
/** Images are the most expensive part of a request, so only the recent few go. */
export const MAX_CONTEXT_IMAGES = 4

function buildTurns(conversation: Conversation): ChatTurn[] {  const usable = conversation.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.content.trim().length > 0 || (m.attachments?.length ?? 0) > 0)

  const recent = usable.slice(-MAX_CONTEXT_TURNS)

  // Walk backwards so the image budget is spent on the most recent screenshots.
  const withImages = new Set<string>()
  let budget = MAX_CONTEXT_IMAGES
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const count = recent[index].attachments?.length ?? 0
    if (count === 0 || count > budget) continue
    budget -= count
    withImages.add(recent[index].id)
  }

  return recent.map((m) => ({
    role: m.role as 'user' | 'assistant',
    text: m.content,
    images: withImages.has(m.id) ? (m.attachments ?? []).map((a) => ({ dataUrl: a.dataUrl, mime: a.mime })) : []
  }))
}

export async function sendChat(request: SendChatRequest): Promise<void> {
  const settings = settingsDomain.get()
  const providerId = settings.activeProvider
  const provider = getProvider(providerId)
  // Recorded on the message even when the request never reaches the provider.
  const displayModel = (settings.providers[providerId]?.model ?? '').trim() || DEFAULT_PROVIDERS[providerId].model

  // The session this question belongs to. When it is ephemeral, nothing about
  // the exchange may reach a file: not the conversation, not the answer cache,
  // not the memory extractor.
  const session = request.interviewId ? interviews.get(request.interviewId) : null
  const ephemeral = session?.ephemeral === true

  let conversation = conversations.get(request.conversationId)
  if (!conversation) conversation = conversations.create({ ephemeral })
  else if (ephemeral) {
    // The overlay keeps one conversation across sessions, so this one may
    // already hold history that is not part of this session. It is not the
    // session's to delete: the session answers through a stand-in in memory and
    // the stored conversation is left where it is.
    conversation = conversations.forEphemeral(request.conversationId)
  }
  const conversationId = conversation.id

  conversations.addMessage(conversationId, {
    id: randomUUID(),
    role: 'user',
    content: request.content,
    attachments: request.attachments,
    createdAt: Date.now()
  })

  const assistantId = randomUUID()
  conversations.addMessage(conversationId, {
    id: assistantId,
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    model: displayModel
  })

  const abort = new AbortController()
  // Registered before anything is emitted, so a Stop pressed the instant the
  // answer starts is never ignored.
  controller = abort

  emit({
    type: 'start',
    conversationId,
    messageId: assistantId,
    model: displayModel,
    provider: providerId
  })

  const turns = buildTurns(conversations.get(conversationId) ?? conversation)
  // The session carries what has been decided and what the terms mean, and the
  // answer goes back into it.
  const questionKind = classifyQuestion(request.content)
  const advice = adviceFor(questionKind)
  // What the assistant knows about the user: their notes, their documents,
  // their resume. This is what makes an answer grounded instead of generic.
  // A pinned document replaces the recall with the document itself.
  const pinned = request.pinnedDocumentId ? documents.documentText(request.pinnedDocumentId) : null
  const pinnedBlock = pinned ? wrapUntrusted(`pinned document: ${pinned.name}`, pinned.text, { maxChars: 24000 }) : ''
  const knowledge = pinnedBlock
    ? { memories: 0, documents: 1, block: pinnedBlock }
    : buildKnowledgeContext(request.content)
  if (knowledge.memories || knowledge.documents || pinned) {
    emit({ type: 'context', messageId: assistantId, memories: knowledge.memories, documents: knowledge.documents })
  }
  let text = ''
  const startedAt = Date.now()
  let firstTokenMs: number | null = null

  /**
   * The history: what was asked, and what came back.
   *
   * An interview is what the user is in the middle of; the questions and the
   * answers belong to it.
   */
  const recordInHistory = (answer: string, ms: number): void => {
    if (!session) return
    interviews.addQuestion(session.id, {
      text: request.content,
      source: request.source ?? 'text',
      answer,
      answerMs: ms
    })
    interviews.addTranscript(session.id, request.content)
  }

  try {
    // Resolved here so a missing key or an empty model fails with a message that
    // says what to fix, rather than a 401 from the endpoint.
    const route = resolveRoute({
      settings,
      apiKey: settingsDomain.apiKey(providerId),
      purpose: request.useFastModel ? 'overlay' : 'chat'
    })
    const baseOptions = {
      model: route.model,
      baseUrl: route.baseUrl,
      apiKey: route.apiKey,
      ...(request.useFastModel ? { maxTokens: 400, temperature: 0.3 } : {}),
      system: [
        settings.systemPrompt + styleSuffix(settings.responseStyle),
        knowledge.block,
        // What was decided earlier in this conversation, and what the terms mean.
        session ? contextBlock(session.context) : '',
        // How this kind of question should be answered.
        advice.guidance
      ]
        .filter(Boolean)
        .join('\n\n'),
      signal: abort.signal
    }

    // Check if the provider/model can carry and understand images.
    // When a model is text-only (e.g. Antigravity, OpenCode text models, Ollama, DeepSeek),
    // local OCR extracts text and code from the screen so the model can read it!
    const attachments = request.attachments ?? []
    let promptContent = request.content
    let effectiveImages = attachments.map((a) => ({ dataUrl: a.dataUrl, mime: a.mime }))

    const canCarryImage = providerCarriesImages(providerId)
    const vision = visionSupport(providerId, route.model)
    const isImageCapable = canCarryImage && vision !== 'no'

    if (attachments.length > 0 && !isImageCapable) {
      const ocrText = await ocrExtractText(attachments[0].dataUrl).catch(() => '')
      if (ocrText.trim()) {
        promptContent = `${promptContent}\n\n[Screen Content (via Local OCR)]:\n\`\`\`\n${ocrText.trim()}\n\`\`\`\n`
        effectiveImages = []
      } else if (!canCarryImage) {
        const note = `⚠️ **${PROVIDER_META[providerId]?.label ?? providerId} cannot carry an image.** No readable text was detected on screen by local OCR.`
        text = note
        emit({ type: 'delta', messageId: assistantId, text: note })
      }
    }

    if (promptContent !== request.content && turns.length > 0) {
      const lastUserTurn = [...turns].reverse().find((t) => t.role === 'user')
      if (lastUserTurn) {
        lastUserTurn.text = promptContent
        lastUserTurn.images = effectiveImages
      }
    }

    // Turbo: the same question about the same screen was answered moments
    // ago, so replay it instead of paying for the same answer twice.
    if (request.useFastModel && settings.overlayAnswerCache && !ephemeral) {
      const cacheKey = answerCache.key(
        route.model,
        request.content,
        AnswerCache.captureHash(request.attachments?.[0]?.dataUrl)
      )
      const cached = answerCache.get(cacheKey)
      if (cached) {
        const replay = cached.answer
        text = replay
        emit({ type: 'delta', messageId: assistantId, text: replay })
        conversations.updateMessage(conversationId, assistantId, { content: replay })
        emit({ type: 'done', messageId: assistantId, cached: true, ms: 0, totalMs: 0, model: route.model })
        usage.record(providerId, 'chat', { toolCall: false })
        audit.record('chat.cached', `Replayed a cached answer for "${request.content.slice(0, 80)}"`)
        // A replay is still an answer: it belongs in the history too.
        recordInHistory(replay, 0)
        return
      }
    }

    // The daemon, when it is there, answers the question: it is a process that
    // starts in milliseconds and lives in a few megabytes, so the overlay's
    // answer does not wait on a browser runtime. It carries every provider,
    // local agents included; this is the overlay's hot path, and everything
    // else — the control panel's own chats, the summaries — goes through the
    // app. When the daemon is absent the app answers with the same clients.
    const daemonCanAnswer = request.useFastModel === true && DAEMON_PROVIDERS.has(providerId)
    // Antigravity's service belongs to the app; the daemon only places the
    // call. When the service is not reachable the app's own client answers,
    // because it can say what to open.
    const antigravity =
      daemonCanAnswer && providerId === 'antigravity' ? await antigravityDomain.endpoint() : null
    const antigravityReady = providerId !== 'antigravity' || antigravity !== null
    if (daemonCanAnswer && antigravityReady && (await daemon.available())) {
      let daemonError: string | null = null
      const answered = await daemon.ask(
        {
          provider: providerId,
          model: route.model,
          baseUrl: route.baseUrl,
          apiKey: route.apiKey,
          prompt: promptContent,
          images: effectiveImages,
          // The agent CLIs are programs: the daemon runs the same one the app
          // would have run.
          binary: binaryFor(providerId) ?? '',
          // Antigravity's service speaks Connect-RPC on its own port.
          port: antigravity?.port ?? 0,
          csrf: antigravity?.token ?? ''
        },
        (event) => {
          if (event.kind === 'delta') {
            if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt
            text += event.text
            emit({ type: 'delta', messageId: assistantId, text: event.text })
            return
          }
          if (event.kind === 'error') {
            // The daemon said what went wrong; it is raised once the answer
            // has finished, so the transcript is not left half-written.
            daemonError = event.message
          }
        }
      )
      if (!answered) {
        // The daemon did not take it: fall through to the app's own client.
      } else if (daemonError) {
        throw new ProviderError(daemonError, { kind: 'bad_request', provider: providerId })
      } else {
        conversations.updateMessage(conversationId, assistantId, { content: text })
        const totalMs = Date.now() - startedAt
        emit({ type: 'done', messageId: assistantId, ms: firstTokenMs ?? totalMs, totalMs, model: route.model })
        usage.record(providerId, 'chat')
        recordInHistory(text, firstTokenMs ?? totalMs)
        return
      }
    }

    // One pass, one answer. The assistant answers questions; it does not call
    // tools, so there is no loop to bound and nothing to approve.
    for await (const delta of withIdleTimeout(provider.chat({ ...baseOptions, turns }), { onStall: () => abort.abort() })) {
      if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt
      text += delta
      emit({ type: 'delta', messageId: assistantId, text: delta })
    }

    conversations.updateMessage(conversationId, assistantId, { content: text })
    const totalMs = Date.now() - startedAt
    emit({ type: 'done', messageId: assistantId, ms: firstTokenMs ?? totalMs, totalMs, model: route.model })
    usage.record(providerId, 'chat')
    recordInHistory(text, firstTokenMs ?? totalMs)
    // Extraction costs a model call, so only run it for substantive exchanges.
    if (
      settings.memoryAutoExtract &&
      !ephemeral &&
      text.trim().length >= 24 &&
      request.content.trim().length >= 24
    ) {
      const origin = `conversation:${conversation.title || conversationId}`
      void memory
        .extractFromExchange(request.content, text, origin)
        .catch((error) => logger.warn('Memory extraction failed', (error as Error).message))
    }
    // Remember it: the same question about the same screen is instant next time.
    if (request.useFastModel && settings.overlayAnswerCache && !ephemeral && text.trim().length > 0) {
      answerCache.set(
        answerCache.key(
          route.model,
          request.content,
          AnswerCache.captureHash(request.attachments?.[0]?.dataUrl)
        ),
        text,
        route.model
      )
    }
  } catch (error) {
    usage.record(providerId, 'chat', { failed: true })
    // A stalled stream aborts the request too, so check the stall *before* the
    // abort flag — otherwise a dead provider looks like the user pressed Stop.
    const stalled = error instanceof StreamStalledError
    const aborted = !stalled && abort.signal.aborted
    if (aborted) {
      conversations.updateMessage(conversationId, assistantId, { content: text || '(cancelled)' })
      emit({ type: 'done', messageId: assistantId })
    } else {
      const message = stalled ? error.message : toUserMessage(classifyThrown(error, { provider: providerId }))
      logger.error('Chat failed', message)
      // Keep whatever streamed, but never leave a truncated answer unexplained.
      const partial = text.trimEnd()
      conversations.updateMessage(conversationId, assistantId, {
        content: partial ? `${partial}\n\n${message}` : message,
        error: true
      })
      emit({ type: 'error', messageId: assistantId, message })
    }
  } finally {
    // No approval request may outlive the request that created it.
    if (pendingTool && pendingTool.messageId === assistantId) {
      pendingTool.resolve(false)
      pendingTool = null
    }
    if (controller === abort) controller = null
  }
}

/** Answer the pending tool-call approval from the renderer. */
export function respondTool(callId: string, approved: boolean): void {
  if (!pendingTool || pendingTool.callId !== callId) return
  const resolve = pendingTool.resolve
  pendingTool = null
  resolve(approved)
}

export function abortChat(): void {
  if (pendingTool) {
    const resolve = pendingTool.resolve
    pendingTool = null
    resolve(false)
  }
  controller?.abort()
  controller = null
}
