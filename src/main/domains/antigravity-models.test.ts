import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/klyro-antigravity-test', getVersion: () => '0-test' }
}))
vi.mock('../security/secrets', () => ({
  secrets: {
    get: () => null,
    set: () => undefined,
    remove: () => undefined,
    count: () => 0,
    setPlaintextPolicy: () => undefined
  }
}))

const { isChatModel } = await import('./antigravity')

/**
 * The catalogue Antigravity hands over is not a list of chat models. It also
 * contains internal aliases that answer 404 and autocomplete models that take
 * no conversation. The first entry is what a picker chooses, so offering them
 * is the difference between "Antigravity does not work" and an answer.
 */
describe('the Antigravity model catalogue', () => {
  it('keeps the models that answer a conversation', () => {
    expect(isChatModel({ id: 'MODEL_PLACEHOLDER_M26', name: 'Claude Opus 4.6 (Thinking)' })).toBe(true)
    expect(isChatModel({ id: 'MODEL_PLACEHOLDER_M35', name: 'Claude Sonnet 4.6 (Thinking)' })).toBe(true)
    expect(isChatModel({ id: 'MODEL_GOOGLE_GEMINI_2_5_PRO', name: 'Gemini 2.5 Pro' })).toBe(true)
    expect(isChatModel({ id: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM', name: 'GPT-OSS 120B (Medium)' })).toBe(true)
  })

  it('drops the internal aliases that answer 404', () => {
    expect(isChatModel({ id: 'MODEL_CHAT_20706', name: 'chat_20706' })).toBe(false)
    expect(isChatModel({ id: 'MODEL_CHAT_23310', name: 'chat_23310' })).toBe(false)
  })

  it('drops the autocomplete models', () => {
    expect(isChatModel({ id: 'MODEL_PLACEHOLDER_M19', name: 'tab_flash_lite_preview' })).toBe(false)
    expect(isChatModel({ id: 'MODEL_PLACEHOLDER_M28', name: 'tab_jump_flash_lite_preview' })).toBe(false)
  })

  it('leaves a real model first in the observed catalogue', () => {
    // The order the server returned on 2026-10-22, with the unusable entries first.
    const observed = [
      { id: 'MODEL_CHAT_20706', name: 'chat_20706' },
      { id: 'MODEL_CHAT_23310', name: 'chat_23310' },
      { id: 'MODEL_PLACEHOLDER_M26', name: 'Claude Opus 4.6 (Thinking)' },
      { id: 'MODEL_PLACEHOLDER_M35', name: 'Claude Sonnet 4.6 (Thinking)' },
      { id: 'MODEL_GOOGLE_GEMINI_2_5_FLASH', name: 'Gemini 3.5 Flash Lite' },
      { id: 'MODEL_PLACEHOLDER_M19', name: 'tab_flash_lite_preview' },
      { id: 'MODEL_PLACEHOLDER_M28', name: 'tab_jump_flash_lite_preview' }
    ]
    const usable = observed.filter(isChatModel)
    expect(usable[0].id).toBe('MODEL_PLACEHOLDER_M26')
    expect(usable.some((model) => model.id.startsWith('MODEL_CHAT_'))).toBe(false)
  })
})
