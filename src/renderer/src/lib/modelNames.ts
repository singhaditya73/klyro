/**
 * What a model id looked like last time it was listed.
 *
 * A provider's catalogue is not always there: an agent IDE can be closed, a
 * local server can be stopped. The model ids stay the same, so the names it
 * used are remembered here — on this machine only — and the picker shows
 * "Claude Opus 4.6" rather than "MODEL_PLACEHOLDER_M26".
 *
 * The ids themselves are never changed: they are what the provider is asked
 * for.
 */

const KEY = 'klyro.model-names'
/** How many names to keep. A few hundred is plenty and stays small. */
const LIMIT = 300

function read(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [id, name] of Object.entries(parsed)) {
      if (typeof id === 'string' && typeof name === 'string' && name.trim()) out[id] = name
    }
    return out
  } catch {
    return {}
  }
}

/** The names we know, by model id. */
export function knownModelNames(): Record<string, string> {
  return read()
}

/** Remember the names a catalogue just gave us. */
export function rememberModelNames(models: Array<{ id: string; name: string }>): void {
  if (models.length === 0) return
  const current = read()
  const next: Record<string, string> = {}
  for (const model of models) {
    if (model.id && model.name && model.name.trim()) next[model.id] = model.name.trim()
  }
  for (const [id, name] of Object.entries(current)) {
    if (!(id in next)) next[id] = name
  }
  const entries = Object.entries(next).slice(0, LIMIT)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // A profile without storage still works; it just forgets.
  }
}

/**
 * A readable label for an id we have no name for.
 *
 * Internal placeholders ("MODEL_PLACEHOLDER_M50") are not something to put
 * in front of a person, so the marker is dropped and the rest is tidied.
 */
export function tidyModelId(id: string): string {
  const tidied = id
    .replace(/^MODEL_PLACEHOLDER_/i, '')
    .replace(/^MODEL_PROVIDER_/i, '')
    .replace(/^MODEL_/i, '')
    .replace(/_/g, ' ')
    .trim()
  return tidied || id
}
