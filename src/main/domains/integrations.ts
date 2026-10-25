import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { DirectIntegrations, MCPServerConfig, MCPServerState } from '@shared/types'
import { JsonStore } from '../store/json-store'
import { secrets } from '../security/secrets'
import { logger } from '../logger'

interface IntegrationsStoreData {
  integrations: DirectIntegrations
  servers: MCPServerConfig[]
}

/**
 * Credentials are never written to `integrations.json`.
 *
 * They go through the same OS-encrypted store as provider API keys
 * (`secrets.ts`), which refuses plaintext unless the user explicitly allows it.
 * The JSON file keeps only non-secret settings (CRM type, recipient).
 */
const SECRET_FIELDS = {
  slackWebhookUrl: 'integration.slack-webhook',
  crmWebhookUrl: 'integration.crm-webhook',
  notionToken: 'integration.notion-token',
  linearApiKey: 'integration.linear-key'
} as const

type SecretField = keyof typeof SECRET_FIELDS

const isSecretField = (field: string): field is SecretField => field in SECRET_FIELDS

const DEFAULT_STORE: IntegrationsStoreData = {
  integrations: {
    slackWebhookUrl: '',
    crmWebhookUrl: '',
    crmType: 'hubspot',
    gmailRecipient: '',
    notionToken: '',
    linearApiKey: ''
  },
  servers: [
    {
      id: 'default-slack',
      name: 'Slack MCP Server',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      enabled: false,
      description: 'Official Slack MCP server: post to channels, search messages, and manage user threads.'
    },
    {
      id: 'default-github',
      name: 'GitHub MCP Server',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      enabled: false,
      description: 'GitHub MCP server: create pull requests, file issues, and search code repositories.'
    },
    {
      id: 'default-fs',
      name: 'Local Filesystem MCP',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
      enabled: false,
      description: 'Secure local filesystem server: read and index local files and directories.'
    }
  ]
}

/** Is `command` something this machine can run? */
function commandExists(command: string): boolean {
  if (command.includes('/') || command.includes('\\')) return existsSync(command)
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], {
      stdio: 'ignore',
      timeout: 2000
    })
    return true
  } catch {
    return false
  }
}

export class IntegrationsDomain {
  private store: JsonStore<IntegrationsStoreData> | null = null

  private getStore(): JsonStore<IntegrationsStoreData> {
    if (!this.store) {
      this.store = new JsonStore<IntegrationsStoreData>('integrations.json', DEFAULT_STORE)
      this.migratePlaintextSecrets(this.store)
    }
    return this.store
  }

  /**
   * An earlier build wrote webhook URLs and tokens into `integrations.json`.
   * Move them into the encrypted store and blank the JSON copy. If the OS has
   * no keychain and plaintext is not allowed, the value is left where it is
   * rather than silently lost — `hasPlaintextSecrets` then reports it.
   */
  private migratePlaintextSecrets(store: JsonStore<IntegrationsStoreData>): void {
    const stored = store.get().integrations
    const moved: string[] = []
    for (const field of Object.keys(SECRET_FIELDS) as SecretField[]) {
      const legacy = stored[field]
      if (!legacy) continue
      try {
        if (secrets.get(SECRET_FIELDS[field]) === null) secrets.set(SECRET_FIELDS[field], legacy)
      } catch (error) {
        logger.warn('Could not move an integration credential into the encrypted store', (error as Error).message)
        continue
      }
      store.update((draft) => {
        draft.integrations[field] = ''
      })
      moved.push(field)
    }
    if (moved.length > 0) logger.info(`Moved ${moved.length} integration credential(s) into the encrypted store`)
  }

  getIntegrations(): DirectIntegrations {
    const stored = this.getStore().get().integrations
    const result: DirectIntegrations = { ...stored }
    for (const field of Object.keys(SECRET_FIELDS) as SecretField[]) {
      result[field] = secrets.get(SECRET_FIELDS[field]) ?? stored[field] ?? ''
    }
    return result
  }

  updateIntegrations(patch: Partial<DirectIntegrations>): DirectIntegrations {
    const stored: Partial<DirectIntegrations> = {}
    for (const field of Object.keys(patch) as Array<keyof DirectIntegrations>) {
      const value = patch[field]
      if (typeof value !== 'string') continue
      if (isSecretField(field)) {
        // Throws when no keychain is available and plaintext is not allowed;
        // the renderer shows that message instead of writing the secret to disk.
        secrets.set(SECRET_FIELDS[field], value)
        continue
      }
      if (field === 'crmType') {
        if (value === 'hubspot' || value === 'salesforce' || value === 'generic') stored.crmType = value
      } else if (field === 'gmailRecipient') {
        stored.gmailRecipient = value
      }
    }
    this.getStore().update((draft) => {
      draft.integrations = { ...draft.integrations, ...stored }
    })
    return this.getIntegrations()
  }

  async sendSlack(message: string, overrideUrl?: string): Promise<{ ok: boolean; error?: string }> {
    const url = (overrideUrl || this.getIntegrations().slackWebhookUrl || '').trim()
    if (!url) {
      return { ok: false, error: 'No Slack webhook URL configured' }
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message })
      })
      if (!response.ok) {
        return { ok: false, error: `Slack HTTP error ${response.status}: ${response.statusText}` }
      }
      return { ok: true }
    } catch (err) {
      logger.warn('Failed to dispatch Slack webhook', (err as Error).message)
      return { ok: false, error: (err as Error).message }
    }
  }

  async sendCrm(payload: Record<string, unknown>, overrideUrl?: string): Promise<{ ok: boolean; error?: string }> {
    const url = (overrideUrl || this.getIntegrations().crmWebhookUrl || '').trim()
    if (!url) {
      return { ok: false, error: 'No CRM webhook URL configured' }
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!response.ok) {
        return { ok: false, error: `CRM webhook HTTP error ${response.status}` }
      }
      return { ok: true }
    } catch (err) {
      logger.warn('Failed to dispatch CRM webhook', (err as Error).message)
      return { ok: false, error: (err as Error).message }
    }
  }

  /* ---------- MCP server definitions ---------- */
  // Klyro does not start or speak to MCP servers yet: this stores the
  // definitions so the client can be built on top of them. Nothing here
  // reports a server as connected.

  listServers(): MCPServerState[] {
    return this.getStore().get().servers.map((config) => ({
      config,
      enabled: config.enabled ?? false,
      tools: [],
      resources: [],
      prompts: [],
      lastError: null
    }))
  }

  addServer(input: {
    name: string
    command: string
    args?: string[]
    env?: Record<string, string>
    description?: string
  }): MCPServerState {
    const config: MCPServerConfig = {
      id: randomUUID(),
      name: input.name.trim() || 'Custom MCP Server',
      command: input.command.trim() || 'npx',
      args: input.args ?? [],
      env: input.env,
      enabled: true,
      description: input.description
    }

    this.getStore().update((draft) => {
      draft.servers.push(config)
    })

    return {
      config,
      enabled: true,
      tools: [],
      resources: [],
      prompts: [],
      lastError: null
    }
  }

  removeServer(id: string): boolean {
    let removed = false
    this.getStore().update((draft) => {
      const idx = draft.servers.findIndex((s) => s.id === id)
      if (idx !== -1) {
        draft.servers.splice(idx, 1)
        removed = true
      }
    })
    return removed
  }

  toggleServer(id: string, enabled: boolean): MCPServerState | null {
    let updated: MCPServerConfig | null = null
    this.getStore().update((draft) => {
      const server = draft.servers.find((s) => s.id === id)
      if (server) {
        server.enabled = enabled
        updated = server
      }
    })
    if (!updated) return null
    return {
      config: updated,
      enabled,
      tools: [],
      resources: [],
      prompts: [],
      lastError: null
    }
  }

  /** Check that the configured command exists. Does not start a server. */
  async testServer(id: string): Promise<{ ok: boolean; toolsCount: number; error?: string }> {
    const server = this.getStore().get().servers.find((s) => s.id === id)
    if (!server) return { ok: false, toolsCount: 0, error: 'Server not found' }
    if (!server.command) return { ok: false, toolsCount: 0, error: 'No command specified' }
    if (!commandExists(server.command)) {
      return { ok: false, toolsCount: 0, error: `Command not found on this machine: ${server.command}` }
    }
    return { ok: true, toolsCount: 0 }
  }
}

export const integrationsDomain = new IntegrationsDomain()
