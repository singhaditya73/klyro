import type { AgentAction, AgentStepStatus } from '@shared/types'

export function describeAction(action: AgentAction): string {
  switch (action.type) {
    case 'move':
      return `Move cursor to (${action.x}, ${action.y})`
    case 'click':
      return `${action.button === 'right' ? 'Right-click' : action.button === 'middle' ? 'Middle-click' : 'Click'} at (${action.x}, ${action.y})`
    case 'doubleClick':
      return `Double-click at (${action.x}, ${action.y})`
    case 'type': {
      const text = action.text ?? ''
      return `Type "${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`
    }
    case 'key':
      return `Press ${action.keys}`
    case 'scroll':
      return `Scroll ${(action.dy ?? 0) >= 0 ? 'down' : 'up'} at (${action.x ?? '?'}, ${action.y ?? '?'})`
    case 'wait':
      return `Wait ${action.ms ?? 500} ms`
    case 'screenshot':
      return 'Capture screen'
    case 'done':
      return action.summary ?? 'Finish'
    case 'ask':
      return action.question ?? 'Ask the user'
    default:
      return String(action.type)
  }
}

export const STATUS_ICON: Record<AgentStepStatus, string> = {
  planned: '○',
  executing: '◐',
  executed: '●',
  verified: '✔',
  unverified: '?',
  ambiguous: '~',
  failed: '✗',
  blocked: '⛔',
  skipped: '–'
}
