import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MCPServerConfig } from '@shared/types'
import { logger } from '../logger'

/**
 * Import MCP servers that are already configured elsewhere.
 *
 * If the user already runs MCP servers — in OpenCode, Claude Code, Cursor —
 * they have already set up the commands, the arguments and the environment.
 * Making them type it all again would be silly, so Klyro reads those configs
 * and offers to take the servers as they are.
 */

export interface DiscoveredMcpServer {
  /** Where it came from: 'opencode', 'claude' … */
  source: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  /** True when Klyro already has a server with this name. */
  alreadyAdded: boolean
}

/** Strip // and /* *\/ comments and trailing commas so JSONC parses as JSON. */
export function parseJsonc(text: string): unknown {
  const withoutComments = text
    .replace(/\\"/g, '\\u0000')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\\u0000/g, '\\"')
  const withoutTrailingCommas = withoutComments.replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(withoutTrailingCommas)
}

/** The config files we know how to read. */
function configPaths(): Array<{ source: string; path: string }> {
  const home = homedir()
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    return [
      { source: 'opencode', path: join(appData, 'opencode', 'opencode.jsonc') },
      { source: 'opencode', path: join(appData, 'opencode', 'opencode.json') },
      { source: 'claude', path: join(home, '.claude.json') }
    ]
  }
  const configHome = process.env.XDG_CONFIG_HOME ?? join(home, '.config')
  return [
    { source: 'opencode', path: join(configHome, 'opencode', 'opencode.jsonc') },
    { source: 'opencode', path: join(configHome, 'opencode', 'opencode.json') },
    { source: 'claude', path: join(home, '.claude.json') },
    { source: 'claude', path: join(configHome, 'claude', 'mcp.json') }
  ]
}

/** One entry, in whichever shape the tool used. */
function toServer(source: string, name: string, entry: Record<string, unknown>): DiscoveredMcpServer | null {
  // OpenCode's local form: { type: 'local', command: ['bin', 'arg', …], environment: {…} }
  const command = entry.command
  if (Array.isArray(command)) {
    const [bin, ...args] = command.map((part) => String(part))
    if (!bin) return null
    const env = (entry.environment ?? entry.env) as Record<string, string> | undefined
    return { source, name, command: bin, args, env, alreadyAdded: false }
  }
  // The common form: { command: 'bin', args: [...], env: {…} }
  if (typeof command === 'string' && command.trim()) {
    const args = Array.isArray(entry.args) ? entry.args.map((part) => String(part)) : []
    const env = (entry.env ?? entry.environment) as Record<string, string> | undefined
    return { source, name, command: command.trim(), args, env, alreadyAdded: false }
  }
  // Remote servers are out of scope for the local stdio transport.
  return null
}

class McpImportDomain {
  /** Every MCP server we can find in the tools the user already runs. */
  discover(existing: MCPServerConfig[]): DiscoveredMcpServer[] {
    const found: DiscoveredMcpServer[] = []
    for (const { source, path } of configPaths()) {
      if (!existsSync(path)) continue
      try {
        const parsed = parseJsonc(readFileSync(path, 'utf8')) as Record<string, unknown>
        const blocks = [
          ...(parsed.mcp && typeof parsed.mcp === 'object' ? Object.entries(parsed.mcp as Record<string, unknown>) : []),
          ...(parsed.mcpServers && typeof parsed.mcpServers === 'object'
            ? Object.entries(parsed.mcpServers as Record<string, unknown>)
            : [])
        ]
        for (const [name, entry] of blocks) {
          if (!entry || typeof entry !== 'object') continue
          const record = entry as Record<string, unknown>
          if (record.enabled === false) continue
          const server = toServer(source, name, record)
          if (!server) continue
          server.alreadyAdded = existing.some(
            (current) => current.name === server.name && current.command === server.command
          )
          found.push(server)
        }
      } catch (error) {
        logger.debug(`Could not read MCP config ${path}`, error)
      }
    }
    return found
  }
}

export const mcpImport = new McpImportDomain()
