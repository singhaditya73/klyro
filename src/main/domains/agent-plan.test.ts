import { describe, expect, it } from 'vitest'
import { coerceAction, describeAction, extractJson, isConsequential, mapCoords } from './agent-plan'

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"type":"done","summary":"ok"}')).toEqual({ type: 'done', summary: 'ok' })
  })

  it('ignores surrounding prose', () => {
    const text = 'Sure! Here is the action:\n{"type":"wait","ms":300}\nLet me know.'
    expect(extractJson(text)).toEqual({ type: 'wait', ms: 300 })
  })

  it('unwraps markdown fences', () => {
    expect(extractJson('```json\n{"type":"ask","question":"which app?"}\n```')).toEqual({
      type: 'ask',
      question: 'which app?'
    })
  })

  it('throws when no JSON object is present', () => {
    expect(() => extractJson('no action here')).toThrow(/did not return JSON/)
  })
})

describe('coerceAction', () => {
  it('keeps valid fields and drops unknown ones', () => {
    const action = coerceAction({ type: 'click', x: '12', y: 34, button: 'right', bogus: 1, reason: 'menu' })
    expect(action).toEqual({ type: 'click', x: 12, y: 34, button: 'right', reason: 'menu' })
  })

  it('rejects unknown action types', () => {
    expect(() => coerceAction({ type: 'launchMissiles' })).toThrow(/unsupported action type/)
  })

  it('ignores an out-of-range button', () => {
    expect(coerceAction({ type: 'click', x: 1, y: 1, button: 'thumb' }).button).toBeUndefined()
  })
})

describe('isConsequential', () => {
  it('flags state-changing actions', () => {
    expect(isConsequential({ type: 'click', x: 1, y: 1 })).toBe(true)
    expect(isConsequential({ type: 'type', text: 'hi' })).toBe(true)
    expect(isConsequential({ type: 'key', keys: 'Return' })).toBe(true)
    expect(isConsequential({ type: 'key', keys: 'ctrl+s' })).toBe(true)
  })

  it('allows navigation-only actions', () => {
    expect(isConsequential({ type: 'move', x: 1, y: 1 })).toBe(false)
    expect(isConsequential({ type: 'wait', ms: 100 })).toBe(false)
    expect(isConsequential({ type: 'key', keys: 'Down' })).toBe(false)
    expect(isConsequential({ type: 'scroll', dy: 3 })).toBe(false)
  })

  it('honours an explicit override', () => {
    expect(isConsequential({ type: 'move', x: 0, y: 0, requiresConfirmation: true })).toBe(true)
  })
})

describe('mapCoords', () => {
  it('passes coordinates through when spaces match', () => {
    expect(mapCoords({ type: 'click', x: 10, y: 20 }, 1920, 1080, 1920, 1080)).toMatchObject({ x: 10, y: 20 })
  })

  it('scales image coordinates into screen space', () => {
    expect(mapCoords({ type: 'click', x: 960, y: 540 }, 1920, 1080, 3840, 2160)).toMatchObject({
      x: 1920,
      y: 1080
    })
  })

  it('leaves coordinate-less actions untouched', () => {
    expect(mapCoords({ type: 'type', text: 'hi' }, 100, 100, 200, 200)).toEqual({ type: 'type', text: 'hi' })
  })
})

describe('describeAction', () => {
  it('produces human-readable descriptions', () => {
    expect(describeAction({ type: 'click', x: 4, y: 8 })).toBe('Click at (4, 8)')
    expect(describeAction({ type: 'type', text: 'abc' })).toBe('Type "abc"')
    expect(describeAction({ type: 'done', summary: 'finished' })).toBe('Finish: finished')
  })
})
