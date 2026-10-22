import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recentModels, rememberModel } from './recent'

/**
 * The picker offers the models used recently, first. The list lives on this
 * machine and holds model ids only.
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

describe('the recently used models', () => {
  it('starts empty', () => {
    expect(recentModels()).toEqual([])
  })

  it('remembers the last choice first', () => {
    rememberModel('a')
    rememberModel('b')
    expect(recentModels()).toEqual(['b', 'a'])
  })

  it('does not repeat a model', () => {
    rememberModel('a')
    rememberModel('b')
    rememberModel('a')
    expect(recentModels()).toEqual(['a', 'b'])
  })

  it('keeps only the last few', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) rememberModel(id)
    expect(recentModels()).toEqual(['f', 'e', 'd', 'c', 'b'])
  })
})
