import type { AgentAction, AgentActionType } from '@shared/types'

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

/** Actions that can change the state of the machine (and so may need confirming). */
export function isConsequential(action: AgentAction): boolean {
  if (action.requiresConfirmation) return true
  if (action.type === 'click' || action.type === 'doubleClick' || action.type === 'type') return true
  if (action.type === 'key') {
    const keys = (action.keys ?? '').toLowerCase()
    return /return|enter|super|cmd|meta|win|ctrl\+|alt\+|delete|backspace/.test(keys)
  }
  return false
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function describeAction(action: AgentAction): string {
  switch (action.type) {
    case 'move':
      return `Move cursor to (${action.x}, ${action.y})`
    case 'click':
      return `${action.button === 'right' ? 'Right-click' : action.button === 'middle' ? 'Middle-click' : 'Click'} at (${action.x}, ${action.y})`
    case 'doubleClick':
      return `Double-click at (${action.x}, ${action.y})`
    case 'type':
      return `Type "${truncate(action.text ?? '', 60)}"`
    case 'key':
      return `Press ${action.keys}`
    case 'scroll':
      return `Scroll ${(action.dy ?? 0) >= 0 ? 'down' : 'up'} at (${action.x ?? '-'}, ${action.y ?? '-'})`
    case 'wait':
      return `Wait ${action.ms ?? 500} ms`
    case 'screenshot':
      return 'Capture screen'
    case 'done':
      return `Finish: ${action.summary ?? ''}`
    case 'ask':
      return `Ask user: ${action.question ?? ''}`
    default:
      return action.type
  }
}

/** Pull the first JSON object out of a model response that may include prose/fences. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('Planner did not return JSON')
  return JSON.parse(candidate.slice(start, end + 1))
}

/** Validate and normalise a raw planner response into an AgentAction. */
export function coerceAction(raw: unknown): AgentAction {
  if (typeof raw !== 'object' || raw === null) throw new Error('Planner returned a non-object action')
  const record = raw as Record<string, unknown>
  const type = String(record.type ?? '')
  if (!ACTION_TYPES.includes(type as AgentActionType)) {
    throw new Error(`Planner returned an unsupported action type: ${type || '(empty)'}`)
  }
  const action: AgentAction = { type: type as AgentActionType }
  const num = (value: unknown): number | undefined => {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  action.x = num(record.x)
  action.y = num(record.y)
  if (record.button === 'left' || record.button === 'right' || record.button === 'middle') {
    action.button = record.button
  }
  if (typeof record.text === 'string') action.text = record.text
  if (typeof record.keys === 'string') action.keys = record.keys
  action.dy = num(record.dy)
  action.ms = num(record.ms)
  if (typeof record.summary === 'string') action.summary = record.summary
  if (typeof record.question === 'string') action.question = record.question
  if (typeof record.requiresConfirmation === 'boolean') action.requiresConfirmation = record.requiresConfirmation
  if (typeof record.reason === 'string') action.reason = record.reason
  return action
}

/** Map coordinates from the planner's screenshot space to screen (DIP) space. */
export function mapCoords(
  action: AgentAction,
  imageWidth: number,
  imageHeight: number,
  screenWidth: number,
  screenHeight: number
): AgentAction {
  if (action.x === undefined || action.y === undefined) return action
  if (imageWidth === screenWidth && imageHeight === screenHeight) return action
  if (imageWidth <= 0 || imageHeight <= 0) return action
  return {
    ...action,
    x: Math.round(action.x * (screenWidth / imageWidth)),
    y: Math.round(action.y * (screenHeight / imageHeight))
  }
}
