import { describe, expect, it } from 'vitest'
import {
  AGENT_ACTION_SCHEMA_VERSION,
  classifyAction,
  expectsScreenChange,
  isConsequential,
  validateAgentAction
} from './agent-policy'

describe('validateAgentAction', () => {
  it('accepts a well-formed click and normalises numbers', () => {
    const result = validateAgentAction({ type: 'click', x: 10.4, y: 20.6, button: 'right' })
    expect(result.ok).toBe(true)
    expect(result.action).toMatchObject({ type: 'click', x: 10, y: 21, button: 'right' })
  })

  it('rejects unknown types and non-objects', () => {
    expect(validateAgentAction({ type: 'launchMissiles' }).ok).toBe(false)
    expect(validateAgentAction('nope').ok).toBe(false)
    expect(validateAgentAction(null).ok).toBe(false)
  })

  it('requires finite coordinates within range for pointer actions', () => {
    expect(validateAgentAction({ type: 'click' }).errors).toEqual(
      expect.arrayContaining(['x is required for this action'])
    )
    expect(validateAgentAction({ type: 'click', x: Number.NaN, y: 5 }).ok).toBe(false)
    expect(validateAgentAction({ type: 'move', x: -5, y: 5 }).ok).toBe(false)
  })

  it('rejects coordinates outside the capture bounds', () => {
    const result = validateAgentAction({ type: 'move', x: 5000, y: 100 }, { width: 1920, height: 1080 })
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toMatch(/outside the capture/)
  })

  it('enforces text length and non-emptiness', () => {
    expect(validateAgentAction({ type: 'type', text: '   ' }).ok).toBe(false)
    expect(validateAgentAction({ type: 'type', text: 'x'.repeat(4001) }).ok).toBe(false)
    expect(validateAgentAction({ type: 'type', text: 'hello' }).action?.text).toBe('hello')
  })

  it('rejects malformed key combinations', () => {
    expect(validateAgentAction({ type: 'key', keys: '   ' }).ok).toBe(false)
    expect(validateAgentAction({ type: 'key', keys: 'a; rm -rf /' }).ok).toBe(false)
    expect(validateAgentAction({ type: 'key', keys: 'ctrl+l' }).ok).toBe(true)
    expect(validateAgentAction({ type: 'key', keys: 'Return' }).ok).toBe(true)
  })

  it('requires a non-zero scroll delta', () => {
    expect(validateAgentAction({ type: 'scroll', dy: 0 }).ok).toBe(false)
    expect(validateAgentAction({ type: 'scroll', dy: 99 }).action?.dy).toBe(10)
  })

  it('defaults wait and requires done/ask payloads', () => {
    expect(validateAgentAction({ type: 'wait' }).action?.ms).toBe(500)
    expect(validateAgentAction({ type: 'done' }).ok).toBe(false)
    expect(validateAgentAction({ type: 'done', summary: 'ok' }).ok).toBe(true)
    expect(validateAgentAction({ type: 'ask' }).ok).toBe(false)
    expect(validateAgentAction({ type: 'ask', question: 'which file?' }).ok).toBe(true)
  })

  it('exposes a schema version', () => {
    expect(AGENT_ACTION_SCHEMA_VERSION).toBeGreaterThanOrEqual(2)
  })
})

describe('classifyAction', () => {
  it('treats inspection and navigation as low risk', () => {
    for (const action of [
      { type: 'move' as const, x: 1, y: 1 },
      { type: 'wait' as const, ms: 100 },
      { type: 'scroll' as const, dy: 2 },
      { type: 'key' as const, keys: 'Down' }
    ]) {
      const risk = classifyAction(action)
      expect(risk.requiresApproval).toBe(false)
      expect(risk.level === 'read-only' || risk.level === 'low').toBe(true)
    }
  })

  it('requires approval for state-changing actions', () => {
    expect(classifyAction({ type: 'click', x: 1, y: 1 }).requiresApproval).toBe(true)
    expect(classifyAction({ type: 'type', text: 'hi' }).requiresApproval).toBe(true)
    expect(classifyAction({ type: 'key', keys: 'Return' }).requiresApproval).toBe(true)
    expect(classifyAction({ type: 'key', keys: 'ctrl+s' }).requiresApproval).toBe(true)
    expect(classifyAction({ type: 'key', keys: 'super+l' }).requiresApproval).toBe(true)
    expect(classifyAction({ type: 'key', keys: 'Delete' }).requiresApproval).toBe(true)
  })

  it('escalates explicitly flagged actions and records reasons', () => {
    const risk = classifyAction({ type: 'move', x: 0, y: 0, requiresConfirmation: true })
    expect(risk.level).toBe('consequential')
    expect(risk.requiresApproval).toBe(true)
    expect(risk.reasons.length).toBeGreaterThan(0)
  })

  it('keeps the legacy isConsequential behaviour', () => {
    expect(isConsequential({ type: 'click', x: 1, y: 1 })).toBe(true)
    expect(isConsequential({ type: 'wait', ms: 10 })).toBe(false)
  })
})

describe('expectsScreenChange', () => {
  it('expects changes for input actions only', () => {
    expect(expectsScreenChange('click')).toBe(true)
    expect(expectsScreenChange('type')).toBe(true)
    expect(expectsScreenChange('key')).toBe(true)
    expect(expectsScreenChange('move')).toBe(false)
    expect(expectsScreenChange('wait')).toBe(false)
  })
})
