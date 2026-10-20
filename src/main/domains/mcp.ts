import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type {
  MCPPrompt,
  MCPResource,
  MCPServerConfig,
  MCPServerState,
  MCPTool,
  ToolSpec
} from '@shared/types'
import { isExternalHttpUrl } from '../security/origins'
import { logger } from '../logger'
import { JsonStore } from '../store/json-store'
import { audit } from './audit'

/**
 * Bring-your-own tools via the Model Context Protocol. Servers are user-defined
 * stdio commands (the standard local MCP transport): Klyro spawns the command
 * directly — never through a shell — and speaks the protocol with the
 * official client SDK, so handshake, framing, capability negotiation and
 * timeouts behave exactly as the specification says.
 *
 * The protocol client is the official `@modelcontextprotocol/sdk`; the agent
 * loop, the approval gates and the audit trail around it are ours.
 */

interface McpState {
  servers: MCPServerConfig[]
}

interface ServerConnection {
  client: Client
  transport: StdioClientTransport
  /** Serialise requests; MCP stdio sessions are single-request at a time. */
  queue: Promise<unknown>
}

const REQUEST_TIMEOUT_MS = 20000
const CONNECT_TIMEOUT_MS = 15000
const MAX_TOOLS = 200
const MAX_RESOURCES = 100
const MAX_PROMPTS = 100

function safeCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed || trimmed.includes('\0')) return false
  // URL-style commands (http:, ssh:) are refused: MCP here is local stdio only.
  if (isExternalHttpUrl(trimmed)) return false
  return true
}

/** Turn an SDK error into something a person can act on. */
function friendlyError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/timed out|timeout/i.test(message)) {
    return new Error('The MCP server did not answer in time.')
  }
  if (/ENOENT|spawn|not found|ENOENT/i.test(message)) {
    return new Error(`Could not launch the MCP server: ${message}`)
  }
  if (/Connection closed|not connected/i.test(message)) {
    return new Error(`Could not launch the MCP server: ${message}`)
  }
  return new Error(message)
}

class McpDomain {
  private readonly store = new JsonStore<McpState>('mcp.json', { servers: [] })
  private readonly connections = new Map<string, ServerConnection>()

  list(): MCPServerConfig[] {
    return this.store.get().servers
  }

  add(name: string, command: string, args: string[]): MCPServerConfig {
    const cleanName = name.trim().slice(0, 80) || command.trim().slice(0, 40)
    if (!safeCommand(command)) throw new Error('A plain executable command is required (no URLs, no shell strings).')
    const config: MCPServerConfig = {
      id: randomUUID(),
      name: cleanName,
      command: command.trim(),
      args: args.map((arg) => arg.trim()).filter(Boolean).slice(0, 32)
    }
    this.store.update((state) => {
      // Replace a same-name entry to keep the list human-predictable.
      state.servers = [...state.servers.filter((server) => server.name !== cleanName), config]
    })
    audit.record('mcp.server-added', `Added MCP server ${cleanName} (${command})`)
    return config
  }

  remove(id: string): void {
    this.kill(id)
    this.store.update((state) => {
      state.servers = state.servers.filter((server) => server.id !== id)
    })
    audit.record('mcp.server-removed', `Removed MCP server ${id}`)
  }

  async states(): Promise<MCPServerState[]> {
    const configs = this.list()
    return await Promise.all(
      configs.map(async (config) => {
        let tools: MCPTool[] = []
        let resources: MCPResource[] = []
        let prompts: MCPPrompt[] = []
        let lastError: string | null = null
        try {
          const listing = await this.describe(config.id)
          tools = listing.tools
          resources = listing.resources
          prompts = listing.prompts
        } catch (error) {
          lastError = (error as Error).message
        }
        return {
          config,
          running: this.connections.has(config.id),
          tools,
          resources,
          prompts,
          lastError
        }
      })
    )
  }

  /** Tools, resources and prompts a server offers. */
  async describe(id: string): Promise<{ tools: MCPTool[]; resources: MCPResource[]; prompts: MCPPrompt[] }> {
    const client = await this.connect(id)
    const request = { timeout: REQUEST_TIMEOUT_MS }
    const tools = await client.listTools(undefined, request)
    let resources: MCPResource[] = []
    let prompts: MCPPrompt[] = []
    // A server may implement only part of the protocol; missing capabilities
    // are normal, not an error.
    try {
      const listed = await client.listResources(undefined, request)
      resources = (listed.resources ?? []).slice(0, MAX_RESOURCES) as MCPResource[]
    } catch {
      resources = []
    }
    try {
      const listed = await client.listPrompts(undefined, request)
      prompts = (listed.prompts ?? []).slice(0, MAX_PROMPTS) as MCPPrompt[]
    } catch {
      prompts = []
    }
    return {
      tools: (tools.tools ?? []).slice(0, MAX_TOOLS),
      resources,
      prompts
    }
  }

  async tools(id: string): Promise<MCPTool[]> {
    return (await this.describe(id)).tools
  }

  /** Read a resource's contents (a file, a note, a database row — whatever the server exposes). */
  async readResource(id: string, uri: string): Promise<string> {
    const client = await this.connect(id)
    const result = await client.readResource({ uri }, { timeout: REQUEST_TIMEOUT_MS })
    const contents = result.contents ?? []
    const text = contents
      .map((entry) => {
        const record = entry as { text?: string; blob?: string; uri?: string }
        if (typeof record.text === 'string') return record.text
        if (typeof record.blob === 'string') return `[binary resource ${record.uri ?? uri}]`
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .slice(0, 100000)
    audit.record('mcp.resource-read', `Read resource ${uri} from an MCP server`, { serverId: id })
    return text
  }

  async call(id: string, name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
    const client = await this.connect(id)
    const result = await client.callTool({ name, arguments: args ?? {} }, undefined, { timeout: REQUEST_TIMEOUT_MS })
    const payload = result as {
      content?: Array<{ type?: string; text?: string }>
      isError?: boolean
      structuredContent?: unknown
    }
    const text = (payload.content ?? [])
      .filter((entry) => entry.type === 'text' || typeof entry.text === 'string')
      .map((entry) => entry.text ?? '')
      .join('\n')
      .slice(0, 100000)
    const ok = payload.isError !== true && Boolean(text.trim())
    audit.record('mcp.tool-call', `Called ${name} on an MCP server`, { serverId: id, ok })
    return { ok, text: text || (ok ? '(empty result)' : '(the tool reported an error)') }
  }

  /** Connect (or reuse) a server and return its MCP client. */
  private async connect(id: string): Promise<Client> {
    const config = this.list().find((server) => server.id === id)
    if (!config) throw new Error('Unknown MCP server.')
    let connection = this.connections.get(id)
    if (connection) return connection.client

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      // The full environment, so servers can find node/npx and their own
      // tooling; plus anything the user configured for this server.
      env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
      stderr: 'pipe'
    })
    const client = new Client(
      { name: 'Klyro', version: app.getVersion() },
      { capabilities: {} }
    )
    try {
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS })
    } catch (error) {
      try {
        await client.close()
      } catch {
        // The transport may never have started.
      }
      throw friendlyError(error)
    }
    connection = { client, transport, queue: Promise.resolve() }
    this.connections.set(id, connection)
    // A server that dies takes its connection with it.
    client.onclose = () => {
      if (this.connections.get(id) === connection) this.connections.delete(id)
    }
    client.onerror = (error: Error) => {
      logger.warn('MCP client error', error)
    }
    return client
  }

  private kill(id: string): void {
    const connection = this.connections.get(id)
    if (!connection) return
    try {
      void connection.client.close()
    } catch (error) {
      logger.warn('Failed to close MCP client', error)
    }
    this.connections.delete(id)
  }

  /** App teardown: never leave user-defined servers running behind us. */
  shutdown(): void {
    for (const id of [...this.connections.keys()]) this.kill(id)
  }

  /* ---------------------------------------------------------------------
   * Chat tool-calling bridge. Tools are presented to the model under a
   * unique OpenAI-compatible name (<server>__<tool>); the registry maps
   * that name back to the server + tool so calls can be routed. Tool calls
   * are always approval-gated in the chat domain before they run here.
   * -------------------------------------------------------------------- */

  private toolName(server: MCPServerConfig, tool: MCPTool): string | null {
    const slug = server.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    const base = slug || 'server'
    const raw = `${base}__${tool.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(raw)) return null
    return raw
  }

  /** Tool definitions for provider function-calling, with routing metadata. */
  async toolSpecs(max = 32): Promise<Array<ToolSpec & { serverId: string; toolName: string }>> {
    const states = await this.states()
    const specs: Array<ToolSpec & { serverId: string; toolName: string }> = []
    for (const state of states) {
      for (const tool of state.tools) {
        if (specs.length >= max) return specs
        const name = this.toolName(state.config, tool)
        if (!name) continue
        const description = (tool.description ?? tool.name).replace(/\s+/g, ' ').trim().slice(0, 500)
        const parameters = isJsonObjectSchema(tool.inputSchema) ? tool.inputSchema : { type: 'object', properties: {} }
        specs.push({
          name,
          description,
          parameters,
          serverId: state.config.id,
          toolName: tool.name
        })
      }
    }
    return specs
  }

  /** Execute a routed tool call by its provider-facing name. */
  async invokeByName(name: string, argsJson: string): Promise<{ ok: boolean; detail: string; serverId: string; toolName: string }> {
    const states = await this.states()
    for (const state of states) {
      for (const tool of state.tools) {
        const routed = this.toolName(state.config, tool)
        if (routed !== name) continue
        let parsed: unknown
        try {
          parsed = JSON.parse(argsJson.length > 0 ? argsJson : '{}')
        } catch {
          return { ok: false, detail: 'The tool arguments were not valid JSON.', serverId: state.config.id, toolName: tool.name }
        }
        if (typeof parsed !== 'object' || parsed === null) {
          return { ok: false, detail: 'Tool arguments must be an object.', serverId: state.config.id, toolName: tool.name }
        }
        try {
          const result = await this.call(state.config.id, tool.name, parsed as Record<string, unknown>)
          return { ok: result.ok, detail: result.text.slice(0, 20000), serverId: state.config.id, toolName: tool.name }
        } catch (error) {
          return { ok: false, detail: (error as Error).message.slice(0, 2000), serverId: state.config.id, toolName: tool.name }
        }
      }
    }
    return { ok: false, detail: 'That tool is not available from the configured MCP servers.', serverId: '', toolName: name }
  }
}

function isJsonObjectSchema(schema: unknown): schema is Record<string, unknown> {
  return typeof schema === 'object' && schema !== null && !Array.isArray(schema) && (schema as Record<string, unknown>).type === 'object'
}

export const mcp = new McpDomain()
