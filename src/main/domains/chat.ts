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
import { StreamStalledError, withIdleTimeout } from '../util/idle-timeout'
import { conversations } from './conversations'
import { buildKnowledgeContext } from './context'
import { memory } from './memory'
import { settingsDomain } from './settings'

let controller: AbortController | null = null

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

function buildTurns(conversation: Conversation): ChatTurn[] {
  return conversation.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.content.trim().length > 0 || (m.attachments?.length ?? 0) > 0)
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      text: m.content,
      images: (m.attachments ?? []).map((a) => ({ dataUrl: a.dataUrl, mime: a.mime }))
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
  const knowledge = buildKnowledgeContext(request.content)
  if (knowledge.memories || knowledge.documents) {
    emit({ type: 'context', messageId: assistantId, memories: knowledge.memories, documents: knowledge.documents })
  }
  let text = ''

  try {
    // Resolved here so a missing key or an empty model fails with a message that
    // says what to fix, rather than a 401 from the endpoint.
    const route = resolveRoute({ settings, apiKey: settingsDomain.apiKey(providerId), purpose: 'chat' })
    for await (const delta of withIdleTimeout(
      provider.chat({
        model: route.model,
        baseUrl: route.baseUrl,
        apiKey: route.apiKey,
        system: [settings.systemPrompt + styleSuffix(settings.responseStyle), knowledge.block]
          .filter(Boolean)
          .join('\n\n'),
        turns,
        signal: abort.signal
      }),
      { onStall: () => abort.abort() }
    )) {
      text += delta
      emit({ type: 'delta', messageId: assistantId, text: delta })
    }
    conversations.updateMessage(conversationId, assistantId, { content: text })
    emit({ type: 'done', messageId: assistantId })
    // Extraction costs a model call, so only run it for substantive exchanges.
    if (settings.memoryAutoExtract && text.trim().length >= 24 && request.content.trim().length >= 24) {
      const origin = `conversation:${conversation.title || conversationId}`
      void memory
        .extractFromExchange(request.content, text, origin)
        .catch((error) => logger.warn('Memory extraction failed', (error as Error).message))
    }
  } catch (error) {
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
    if (controller === abort) controller = null
  }
}

export function abortChat(): void {
  controller?.abort()
  controller = null
}
