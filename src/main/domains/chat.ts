import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { ChatStreamEvent, Conversation, ResponseStyle, SendChatRequest } from '@shared/types'
import { IPC } from '@shared/ipc'
import { logger } from '../logger'
import { getProvider } from '../providers'
import type { ChatTurn } from '../providers/types'
import { conversations } from './conversations'
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
  const apiKey = settingsDomain.apiKey(providerId)
  const providerSettings = settings.providers[providerId]

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
    model: providerSettings.model
  })

  emit({
    type: 'start',
    conversationId,
    messageId: assistantId,
    model: providerSettings.model,
    provider: providerId
  })

  const turns = buildTurns(conversations.get(conversationId) ?? conversation)
  const abort = new AbortController()
  controller = abort
  let text = ''

  try {
    for await (const delta of provider.chat({
      model: providerSettings.model,
      baseUrl: providerSettings.baseUrl,
      apiKey,
      system: settings.systemPrompt + styleSuffix(settings.responseStyle),
      turns,
      signal: abort.signal
    })) {
      text += delta
      emit({ type: 'delta', messageId: assistantId, text: delta })
    }
    conversations.updateMessage(conversationId, assistantId, { content: text })
    emit({ type: 'done', messageId: assistantId })
  } catch (error) {
    const aborted = abort.signal.aborted
    if (aborted) {
      conversations.updateMessage(conversationId, assistantId, { content: text || '(cancelled)' })
      emit({ type: 'done', messageId: assistantId })
    } else {
      const message = (error as Error).message || 'Request failed'
      logger.error('Chat failed', message)
      conversations.updateMessage(conversationId, assistantId, { content: text || message, error: true })
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
