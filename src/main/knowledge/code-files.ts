/** Pure rules for deciding what a code-workspace index should include. */

export const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts',
  'scala', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'php', 'swift', 'm', 'mm', 'dart', 'lua', 'r',
  'jl', 'ex', 'exs', 'erl', 'hs', 'clj', 'cljs', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd', 'sql',
  'graphql', 'gql', 'proto', 'vue', 'svelte', 'astro', 'html', 'htm', 'css', 'scss', 'sass', 'less', 'json',
  'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'env', 'properties', 'xml', 'gradle', 'tf', 'tfvars',
  'dockerfile', 'makefile', 'cmake', 'md', 'mdx', 'rst', 'txt'
])

export const IGNORED_DIRECTORIES = new Set([
  'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'target', 'bin', 'obj',
  'coverage', '__pycache__', 'venv', '.venv', 'site-packages', 'Pods', 'DerivedData',
  '.git', '.hg', '.svn', '.next', '.nuxt', '.cache', '.turbo', '.parcel-cache', '.gradle',
  '.idea', '.vs', '.terraform', 'tmp', 'temp', 'logs'
])

export const IGNORED_FILE_SUFFIXES = [
  '.min.js', '.min.css', '.min.mjs', '.map', '.lock', '.snap', '.log', '.pb.go', '_pb2.py', '.generated.ts'
]

export function shouldSkipDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name)
}

/**
 * Files that commonly hold credentials or private keys. These are excluded from
 * indexing so secrets never end up in prompts, exports, or the search index.
 */
const SECRET_FILE_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,
  /^\.envrc$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.pgpass$/i,
  /^\.git-credentials$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i,
  /^(secrets?|credentials?)\.(json|ya?ml|toml|ini|txt)$/i,
  /^(\.htpasswd)$/i
]

export function isSecretFile(name: string): boolean {
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(name))
}

/** Files with no extension but a known tooling name (Dockerfile, Makefile…). */
const EXTENSIONLESS_NAMES = new Set(['dockerfile', 'makefile', 'cmakelists', 'gemfile', 'procfile', 'justfile'])

export function isIndexableFile(relativePath: string, sizeBytes: number, maxBytes = 512 * 1024): boolean {
  if (sizeBytes <= 0 || sizeBytes > maxBytes) return false
  const name = relativePath.split('/').pop() ?? ''
  if (isSecretFile(name)) return false
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return EXTENSIONLESS_NAMES.has(name.toLowerCase())
  const extension = name.slice(dot + 1).toLowerCase()
  if (!CODE_EXTENSIONS.has(extension)) return false
  const lower = name.toLowerCase()
  if (IGNORED_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return false
  return true
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyi: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  kt: 'kotlin', kts: 'kotlin', scala: 'scala', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp',
  cxx: 'cpp', hpp: 'cpp', hh: 'cpp', cs: 'csharp', php: 'php', swift: 'swift',
  dart: 'dart', lua: 'lua', r: 'r', jl: 'julia', hs: 'haskell', ex: 'elixir', exs: 'elixir',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'powershell',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', proto: 'protobuf',
  vue: 'vue', svelte: 'svelte', html: 'html', htm: 'html', css: 'css', scss: 'scss',
  less: 'less', json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  ini: 'ini', xml: 'xml', gradle: 'groovy', tf: 'terraform', md: 'markdown', mdx: 'markdown'
}

export function detectLanguage(filePath: string): string {
  const name = filePath.split('/').pop() ?? filePath
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return EXTENSIONLESS_NAMES.has(name.toLowerCase()) ? name.toLowerCase() : 'text'
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? 'text'
}

/** Render `{{var}}` placeholders, leaving unknown names empty. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => vars[key] ?? '')
}

const ACTION_KEYS = ['actions', 'actionItems', 'action_items', 'followUps', 'follow_ups', 'todos']

/** Clean one action item: no bullets, quotes, or trailing punctuation soup. */
function cleanAction(item: string): string {
  return item
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/** Keep the first mention of each action; models like to repeat themselves. */
function uniqueActions(items: string[], limit = 20): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const cleaned = cleanAction(item)
    if (cleaned.length < 3) continue
    const key = cleaned.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(cleaned)
    if (result.length >= limit) break
  }
  return result
}

/**
 * Split a model answer into a summary plus structured action items.
 *
 * Accepts the JSON shape we ask for, tolerates fenced or chatty JSON, and falls
 * back to reading bullets out of plain text.
 */
export function parseMeetingSummary(raw: string): { summary: string; actions: string[] } {
  const text = raw.trim()
  if (!text) return { summary: '', actions: [] }

  const jsonStart = text.indexOf('{')
  const jsonEnd = text.lastIndexOf('}')
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>
      const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 4000) : ''
      const rawActions = ACTION_KEYS.map((key) => parsed[key]).find((value) => Array.isArray(value) || typeof value === 'string')
      const actions = uniqueActions(
        Array.isArray(rawActions)
          ? rawActions.filter((item): item is string => typeof item === 'string')
          : typeof rawActions === 'string'
            ? rawActions.split('\n')
            : []
      )
      if (summary || actions.length) return { summary, actions }
    } catch {
      // fall through to text parsing
    }
  }

  const actions: string[] = []
  const summaryLines: string[] = []
  for (const line of text.split('\n')) {
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/)
    if (bullet && bullet[1].trim()) actions.push(bullet[1].trim())
    else if (line.trim()) summaryLines.push(line.trim())
  }
  return { summary: summaryLines.join(' ').trim(), actions: uniqueActions(actions) }
}
