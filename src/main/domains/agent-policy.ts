import type { AgentAction, AgentActionType } from '@shared/types'

/**
 * Central, versioned policy for agent actions.
 *
 * Two responsibilities, both enforced in the main process:
 *   1. `validateAgentAction` — strict, per-type validation of everything a model
 *      proposes (types, coordinates, key combos, text length, permitted range).
 *   2. `classifyAction` — a single source of truth for how risky an action is and
 *      whether it needs explicit user approval before it may run.
 *
 * The schema version is bumped whenever validation rules change meaning, so that
 * persisted step/task records can be interpreted against the rules that produced
 * them.
 */
export const AGENT_ACTION_SCHEMA_VERSION = 2

/** Screen-space coordinates are clamped/rejected against these absolute limits. */
export const MAX_COORDINATE = 32767
export const MAX_TYPE_CHARS = 4000
export const MAX_KEY_LENGTH = 64
export const MAX_WAIT_MS = 30_000

export const ACTION_TYPES: AgentActionType[] = [
  'move',
  'click',
  'doubleClick',
  'type',
  'key',
  'scroll',
  'wait',
  'screenshot',
  'done',
  'ask'
]

export interface ActionValidation {
  ok: boolean
  /** Normalised, clamped action when `ok` is true. */
  action?: AgentAction
  errors: string[]
}

export interface ScreenBounds {
  width: number
  height: number
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Key combos are restricted to printable key names joined by `+`. */
const KEY_PATTERN = /^[A-Za-z0-9_=+\-./[\] ,]*$/
/** Modifiers that, combined with anything, deserve extra scrutiny. */
const SYSTEM_MODIFIERS = ['super', 'cmd', 'command', 'meta', 'win']

function coordinate(
  value: unknown,
  label: string,
  bounds: ScreenBounds | undefined,
  errors: string[]
): number | undefined {
  if (value === undefined || value === null) return undefined
  if (!isFiniteNumber(value)) {
    errors.push(`${label} must be a finite number`)
    return undefined
  }
  const rounded = Math.round(value)
  if (rounded < 0 || rounded > MAX_COORDINATE) {
    errors.push(`${label} is outside the permitted range (0–${MAX_COORDINATE})`)
    return undefined
  }
  // Allow a small overshoot (edges of a device pixel) but reject nonsense.
  if (bounds && (rounded > bounds.width * 1.5 || rounded > MAX_COORDINATE)) {
    errors.push(`${label} is outside the capture (0–${bounds.width})`)
    return undefined
  }
  if (bounds && label === 'y' && rounded > bounds.height * 1.5) {
    errors.push(`y is outside the capture (0–${bounds.height})`)
    return undefined
  }
  return rounded
}

/**
 * Validate and normalise a raw planner action. Unlike the lenient
 * `coerceAction`, this rejects rather than silently drops invalid input.
 */
export function validateAgentAction(raw: unknown, bounds?: ScreenBounds): ActionValidation {
  const errors: string[] = []
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['Action must be an object'] }
  }
  const record = raw as Record<string, unknown>
  const type = String(record.type ?? '')
  if (!ACTION_TYPES.includes(type as AgentActionType)) {
    return { ok: false, errors: [`Unsupported action type: ${type || '(empty)'}`] }
  }

  const action: AgentAction = { type: type as AgentActionType, requiresConfirmation: false }
  const needsCoords = type === 'move' || type === 'click' || type === 'doubleClick'
  action.x = coordinate(record.x, 'x', bounds, errors)
  action.y = coordinate(record.y, 'y', bounds, errors)
  if (needsCoords) {
    if (action.x === undefined) errors.push('x is required for this action')
    if (action.y === undefined) errors.push('y is required for this action')
  }

  if (record.button === 'left' || record.button === 'right' || record.button === 'middle') {
    if (type === 'click' || type === 'doubleClick') action.button = record.button
  } else if (record.button !== undefined && record.button !== null) {
    errors.push('button must be "left", "right", or "middle"')
  }

  if (type === 'type') {
    const text = typeof record.text === 'string' ? record.text : ''
    if (!text.trim()) errors.push('type requires non-empty text')
    else if (text.length > MAX_TYPE_CHARS) errors.push(`text exceeds ${MAX_TYPE_CHARS} characters`)
    else action.text = text
  } else if (typeof record.text === 'string') {
    action.text = record.text
  }

  if (type === 'key') {
    const keys = typeof record.keys === 'string' ? record.keys.trim() : ''
    if (!keys) errors.push('key requires a key combination')
    else if (keys.length > MAX_KEY_LENGTH) errors.push(`key combination exceeds ${MAX_KEY_LENGTH} characters`)
    else if (!KEY_PATTERN.test(keys)) errors.push('key combination contains unsupported characters')
    else action.keys = keys
  }

  if (type === 'scroll') {
    if (!isFiniteNumber(record.dy)) errors.push('scroll requires a numeric dy')
    else {
      const dy = Math.max(-10, Math.min(10, Math.round(record.dy)))
      if (dy === 0) errors.push('scroll dy must be non-zero')
      else action.dy = dy
    }
  }

  if (type === 'wait') {
    if (!isFiniteNumber(record.ms)) action.ms = 500
    else action.ms = Math.max(0, Math.min(MAX_WAIT_MS, Math.round(record.ms)))
  }

  if (type === 'done') {
    const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
    if (!summary) errors.push('done requires a summary')
    else action.summary = summary.slice(0, 2000)
  }
  if (type === 'ask') {
    const question = typeof record.question === 'string' ? record.question.trim() : ''
    if (!question) errors.push('ask requires a question')
    else action.question = question.slice(0, 2000)
  }

  if (typeof record.requiresConfirmation === 'boolean') action.requiresConfirmation = record.requiresConfirmation
  if (typeof record.reason === 'string') action.reason = record.reason.slice(0, 1000)

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, action, errors: [] }
}

export type RiskLevel = 'read-only' | 'low' | 'medium' | 'high' | 'consequential'

export interface RiskAssessment {
  level: RiskLevel
  requiresApproval: boolean
  reasons: string[]
}

const LEVEL_RANK: Record<RiskLevel, number> = {
  'read-only': 0,
  low: 1,
  medium: 2,
  high: 3,
  consequential: 4
}

function escalate(current: RiskLevel, next: RiskLevel, reasons: string[], reason: string): RiskLevel {
  if (LEVEL_RANK[next] > LEVEL_RANK[current]) {
    reasons.push(reason)
    return next
  }
  return current
}

/**
 * The single source of truth for action risk. Read-only inspection stays
 * frictionless; anything that can change machine state needs approval.
 */
export function classifyAction(action: AgentAction): RiskAssessment {
  const reasons: string[] = []
  let level: RiskLevel = 'read-only'

  switch (action.type) {
    case 'move':
    case 'scroll':
    case 'wait':
    case 'screenshot':
    case 'done':
    case 'ask':
      level = 'read-only'
      break
    case 'click':
    case 'doubleClick':
      level = 'medium'
      reasons.push('Clicking can activate a control, link, or button.')
      break
    case 'type':
      level = 'medium'
      reasons.push('Typing can enter data or commands.')
      break
    case 'key': {
      level = 'low'
      break
    }
    default:
      level = 'medium'
  }

  if (action.type === 'key') {
    const keys = (action.keys ?? '').toLowerCase()
    if (keys) {
      const parts = keys.split('+').map((part) => part.trim())
      const base = parts[parts.length - 1]
      if (SYSTEM_MODIFIERS.some((modifier) => parts.includes(modifier))) {
        level = escalate(level, 'high', reasons, 'Uses a system/command modifier.')
      }
      if (/(^|\+)(ctrl|control)\+/.test(keys) || parts.includes('ctrl') || parts.includes('control')) {
        level = escalate(level, 'high', reasons, 'Uses a Ctrl shortcut.')
      }
      if (parts.includes('alt') || parts.includes('option')) {
        level = escalate(level, 'high', reasons, 'Uses an Alt shortcut.')
      }
      if (base === 'return' || base === 'enter') {
        level = escalate(level, 'high', reasons, 'Pressing Enter submits the current form or message.')
      }
      if (base === 'delete' || base === 'backspace' || base === 'del') {
        level = escalate(level, 'high', reasons, 'Deletes content.')
      }
    }
  }

  if (action.requiresConfirmation) {
    level = escalate(level, 'consequential', reasons, 'The planner flagged this as consequential.')
  }

  const requiresApproval = LEVEL_RANK[level] >= LEVEL_RANK.medium
  return { level, requiresApproval, reasons }
}

/** Backwards-compatible boolean view used by the planner loop. */
export function isConsequential(action: AgentAction): boolean {
  return classifyAction(action).requiresApproval
}

/**
 * True when the screen changed enough to count as an observable effect.
 * `move`, `wait` and `screenshot` are expected to leave the screen untouched.
 */
export function expectsScreenChange(type: AgentActionType): boolean {
  return type === 'click' || type === 'doubleClick' || type === 'type' || type === 'key' || type === 'scroll'
}
