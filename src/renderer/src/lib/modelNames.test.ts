import { beforeEach, describe, expect, it, vi } from 'vitest'
import { knownModelNames, rememberModelNames, tidyModelId } from './modelNames'

/**
 * The names of models are remembered on this machine, so a provider that is
 * not listing right now still shows a name instead of an internal id.
 */

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key)
    }
  })
})

describe('the names a model had', () => {
  it('starts empty', () => {
    expect(knownModelNames()).toEqual({})
  })

  it('remembers what a catalogue said', () => {
    rememberModelNames([{ id: 'MODEL_PLACEHOLDER_M26', name: 'Claude Opus 4.6 (Thinking)' }])
    expect(knownModelNames()['MODEL_PLACEHOLDER_M26']).toBe('Claude Opus 4.6 (Thinking)')
  })

  it('keeps the names it already had', () => {
    rememberModelNames([{ id: 'a', name: 'A' }])
    rememberModelNames([{ id: 'b', name: 'B' }])
    expect(Object.keys(knownModelNames()).sort()).toEqual(['a', 'b'])
  })

  it('does not keep a name without one', () => {
    rememberModelNames([{ id: 'a', name: '  ' }])
    expect(knownModelNames()).toEqual({})
  })
})

describe('an id a person should not have to read', () => {
  it('drops the internal marker', () => {
    expect(tidyModelId('MODEL_PLACEHOLDER_M50')).toBe('M50')
  })

  it('leaves a real id alone', () => {
    expect(tidyModelId('minimax/minimax-m3.1-flash:free')).toBe('minimax/minimax-m3.1-flash:free')
  })

  it('never returns nothing', () => {
    expect(tidyModelId('')).toBe('')
  })
})
