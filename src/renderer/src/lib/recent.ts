/**
 * The models the person used last.
 *
 * The picker offers them first: the model someone picked a minute ago is
 * usually the one they want again. It is a short list on this machine only —
 * nothing leaves it, and it holds model ids, never questions.
 */

const KEY = 'klyro.recent-models'
const LIMIT = 5

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

export function recentModels(): string[] {
  return read()
}

/** Remember a model as the most recently used one. */
export function rememberModel(modelId: string): string[] {
  if (!modelId) return read()
  const next = [modelId, ...read().filter((entry) => entry !== modelId)].slice(0, LIMIT)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // A profile without storage still works; it just forgets.
  }
  return next
}
