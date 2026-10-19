import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { MCPServerConfig, MCPServerState, MCPTool, ToolSpec } from '@shared/types'
import { isExternalHttpUrl } from '../security/origins'
import { logger } from '../logger'
import { JsonStore } from '../store/json-store'
import { audit } from './audit'

/**
 * Bring-your-own tools via the Model Context Protocol. Servers are user-defined
 * stdio commands (the standard local MCP transport): Klyro spawns the command,
 * speaks newline-delimited JSON-RPC (initialize → initialized → tools/list →
 * tools/call), and never runs a shell — the command and args are passed
 * directly to the OS. Child processes are kept alive while the app runs and are
 * killed when the app exits or the server is removed.
 */

interface ServerConnection {
  child: ChildProcessWithoutNullStreams
  handshaken: boolean
  lastError: string | null
  /** Serialise requests; MCP stdio sessions are single-request at a time. */
  queue: Promise<unknown>
  nextId: number
}

const PROTOCOL_VERSION = '2025-06-18'
const REQUEST_TIMEOUT_MS = 20000
const MAX_BUFFER_BYTES = 2 * 1024 * 1024
const MAX_TOOLS = 200

interface McpState {
  servers: MCPServerConfig[]
}

function safeCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed || trimmed.includes('\0')) return false
  // URL-style commands (http:, ssh:) are refused: MCP here is local stdio only.
  if (isExternalHttpUrl(trimmed)) return false
  return true
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
        let lastError: string | null = null
        try {
          tools = await this.tools(config.id)
        } catch (error) {
          lastError = (error as Error).message
        }
        return { config, running: this.connections.has(config.id), tools: tools.slice(0, MAX_TOOLS), lastError }
      })
    )
  }

  async tools(id: string): Promise<MCPTool[]> {
    const result = await this.request<{ tools?: MCPTool[] }>(id, {
      method: 'tools/list',
      params: {}
    })
    return (result.tools ?? []).slice(0, MAX_TOOLS)
  }

  async call(id: string, name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
    const result = await this.request<{ content?: Array<{ type?: string; text?: string }>; isError?: boolean }>(id, {
      method: 'tools/call',
      params: { name, arguments: args ?? {} }
    })
    const text = (result.content ?? [])
      .filter((entry) => entry.type === 'text' || typeof entry.text === 'string')
      .map((entry) => entry.text ?? '')
      .join('\n')
      .slice(0, 100000)
    const ok = result.isError !== true && Boolean(text.trim())
    audit.record('mcp.tool-call', `Called ${name} on an MCP server`, { serverId: id, ok })
    return { ok, text: text || (ok ? '(empty result)' : '(the tool reported an error)') }
  }

  /** One JSON-RPC request/response turn on a server connection. */
  private request<T>(id: string, body: { method: string; params: unknown }): Promise<T> {
    const config = this.list().find((server) => server.id === id)
    if (!config) throw new Error('Unknown MCP server.')
    let connection = this.connections.get(id)
    if (!connection || connection.child.exitCode !== null) {
      connection = this.connect(config)
      this.connections.set(id, connection)
    }
    // Every new child must handshake (initialize → initialized) before any
    // other call; established children skip straight to the method.
    const run = connection.queue.then(
      () => this.doRequest<T>(connection as ServerConnection, body),
      () => this.doRequest<T>(connection as ServerConnection, body)
    )
    connection.queue = run.catch(() => undefined)
    return run
  }

  private async doRequest<T>(connection: ServerConnection, body: { method: string; params: unknown }): Promise<T> {
    await this.handshaken(connection)
    return await this.exchange<T>(connection, {
      jsonrpc: '2.0',
      id: ++connection.nextId,
      method: body.method,
      params: body.params
    })
  }

  private connect(config: MCPServerConfig): ServerConnection {
    const child = spawn(config.command, config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(config.env ?? {}) }
    }) as ChildProcessWithoutNullStreams
    const connection: ServerConnection = { child, handshaken: false, lastError: null, queue: Promise.resolve(), nextId: 0 }
    child.on('exit', () => {
      if (this.connections.get(config.id) === connection) this.connections.delete(config.id)
    })
    return connection
  }

  /** Performs the MCP handshake exactly once per child process. */
  private async handshaken(connection: ServerConnection): Promise<void> {
    if (connection.handshaken) return
    await this.exchange(connection, {
      jsonrpc: '2.0',
      id: ++connection.nextId,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'Klyro', version: app.getVersion() }
      }
    })
    connection.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    connection.handshaken = true
  }

  /** Low-level write-one, read-until-matching-id RPC with a hard timeout. */
  private exchange<T>(connection: ServerConnection, message: { id?: number; jsonrpc: string; method: string; params?: unknown }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const child = connection.child
      let buffer = ''
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('The MCP server did not answer in time.'))
      }, REQUEST_TIMEOUT_MS)
      const lines: Array<(payload: Record<string, unknown>) => void> = []

      function cleanup(): void {
        clearTimeout(timer)
        child.stdout.off('data', onData)
      }

      function onData(chunk: Buffer): void {
        buffer += chunk.toString('utf8')
        if (buffer.length > MAX_BUFFER_BYTES) {
          cleanup()
          reject(new Error('The MCP server produced too much output.'))
          return
        }
        let index = buffer.indexOf('\n')
        while (index !== -1) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (!line) continue
          let payload: Record<string, unknown> | null = null
          try {
            payload = JSON.parse(line) as Record<string, unknown>
          } catch {
            continue // Hands handshake noise / logs straight to the void.
          }
          if (payload.error) {
            cleanup()
            reject(new Error(`MCP server error: ${String((payload.error as Record<string, unknown>).message ?? 'unknown')}`))
            return
          }
          if (payload.id && payload.result) {
            cleanup()
            resolve(payload.result as T)
            return
          }
          void lines
        }
      }

      child.stdout.on('data', onData)
      child.once('error', (error) => {
        cleanup()
        reject(new Error(`Could not launch the MCP server: ${(error as Error).message}`))
      })

      const payload = message.params === undefined ? { jsonrpc: '2.0', id: message.id, method: message.method } : message
      try {
        child.stdin.write(JSON.stringify(payload) + '\n')
      } catch (error) {
        cleanup()
        reject(new Error(`Could not send to the MCP server: ${(error as Error).message}`))
      }
    })
  }

  private kill(id: string): void {
    const connection = this.connections.get(id)
    if (!connection) return
    try {
      connection.child.kill()
    } catch (error) {
      logger.warn('Failed to kill MCP child', error)
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
