import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { ChatStreamEvent, Conversation, ResponseStyle, SendChatRequest } from '@shared/types'
import { IPC } from '@shared/ipc'
import { logger } from '../logger'
import { getProvider } from '../providers'
import { DEFAULT_PROVIDERS } from '../providers/defaults'
import { classifyThrown, toUserMessage } from '../providers/errors'
import { resolveRoute } from '../providers/routing'
import type { ChatTurn } from '../providers/types'
import { audit } from './audit'
import { StreamStalledError, withIdleTimeout } from '../util/idle-timeout'
import { conversations } from './conversations'
import { buildKnowledgeContext } from './context'
import { documents } from './documents'
import { memory } from './memory'
import { mcp } from './mcp'
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

/** Hard cap on tool rounds per message so a chatty model cannot loop forever. */
const MAX_TOOL_ROUNDS = 5

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

  let conversation = conversations.get(request.conversationId)
  if (!conversation) conversation = conversations.create()
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
  // A pinned document replaces the BM25 grounding with the document itself.
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
      system: [settings.systemPrompt + styleSuffix(settings.responseStyle), knowledge.block]
        .filter(Boolean)
        .join('\n\n'),
      signal: abort.signal
    }

    // Turbo: the same question about the same screen was answered moments
    // ago, so replay it instead of paying for the same answer twice.
    if (request.useFastModel && settings.overlayAnswerCache) {
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
        return
      }
    }

    // The tool loop: the model may call MCP tools (when enabled and any are
    // configured). Each call waits for an explicit Allow; the loop runs at
    // most MAX_TOOL_ROUNDS times so no tool turns chat into a runaway agent.
    const tools = settings.chatMcpTools ? await mcp.toolSpecs() : []
    const toolSpecsForModel = tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
    let history: ChatTurn[] = turns
    for (let round = 0; round <= MAX_TOOL_ROUNDS && (round === 0 || toolSpecsForModel.length > 0); round += 1) {
      const calls: Array<{ id: string; name: string; argsJson: string }> = []
      let roundText = ''
      if (toolSpecsForModel.length > 0 && provider.chatWithTools) {
        for await (const chunk of withIdleTimeout(
          provider.chatWithTools({ ...baseOptions, turns: history, tools: toolSpecsForModel }),
          { onStall: () => abort.abort() }
        )) {
          if (chunk.kind === 'text') {
            if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt
            roundText += chunk.text
            text += chunk.text
            emit({ type: 'delta', messageId: assistantId, text: chunk.text })
          } else {
            calls.push(...chunk.calls)
          }
        }
      } else {
        for await (const delta of withIdleTimeout(provider.chat({ ...baseOptions, turns: history }), { onStall: () => abort.abort() })) {
          if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt
          roundText += delta
          text += delta
          emit({ type: 'delta', messageId: assistantId, text: delta })
        }
      }
      if (calls.length === 0 || round === MAX_TOOL_ROUNDS || abort.signal.aborted) break

      history = [...history, { role: 'assistant', text: roundText, toolCalls: calls }]
      for (const call of calls) {
        if (abort.signal.aborted) break
        const approved = await new Promise<boolean>((resolve) => {
          pendingTool = { messageId: assistantId, callId: call.id, name: call.name, args: call.argsJson.slice(0, 2000), resolve }
          emit({
            type: 'tool-pending',
            messageId: assistantId,
            callId: call.id,
            name: call.name,
            args: call.argsJson.slice(0, 2000)
          })
          if (abort.signal.aborted) {
            if (pendingTool?.callId === call.id) pendingTool = null
            resolve(false)
          }
        })
        let ok = false
        let detail: string
        if (approved) {
          const result = await mcp.invokeByName(call.name, call.argsJson)
          ok = result.ok
          detail = result.detail
          audit.record(
            'chat.tool-call',
            `${ok ? 'Allowed and ran' : 'Attempted to run'} ${call.name} in chat`,
            { ok, serverId: result.serverId, tool: result.toolName }
          )
          usage.record(providerId, 'chat', { toolCall: true })
        } else {
          detail = 'The user declined this tool call.'
          audit.record('chat.tool-call', `Declined ${call.name} in chat`)
        }
        pendingTool = null
        emit({ type: 'tool-resolved', messageId: assistantId, callId: call.id, ok })
        const marker = `\n\n🔧 **${call.name}** ${ok ? 'ran — result returned above' : 'not run'}`
        history.push({ role: 'tool', text: ok ? detail : `Not run. ${detail}`, toolCallId: call.id })
        text += marker
        emit({ type: 'delta', messageId: assistantId, text: marker })
      }
      if (abort.signal.aborted) break
    }

    conversations.updateMessage(conversationId, assistantId, { content: text })
    const totalMs = Date.now() - startedAt
    emit({ type: 'done', messageId: assistantId, ms: firstTokenMs ?? totalMs, totalMs, model: route.model })
    usage.record(providerId, 'chat')
    // Remember it: the same question about the same screen is instant next time.
    if (request.useFastModel && settings.overlayAnswerCache && text.trim().length > 0) {
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
    // Extraction costs a model call, so only run it for substantive exchanges.
    if (settings.memoryAutoExtract && text.trim().length >= 24 && request.content.trim().length >= 24) {
      const origin = `conversation:${conversation.title || conversationId}`
      void memory
        .extractFromExchange(request.content, text, origin)
        .catch((error) => logger.warn('Memory extraction failed', (error as Error).message))
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
