import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { DirectIntegrations, MCPServerConfig, MCPServerState, MeetingCrmNotes } from '@shared/types'
import { JsonStore } from '../store/json-store'
import { secrets } from '../security/secrets'
import { logger } from '../logger'
import { formatForCrm, formatForNotion, formatForSlack } from './meeting-notes'

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

  async sendCrm(payload: Record<string, unknown> | string, overrideUrl?: string): Promise<{ ok: boolean; error?: string }> {
    const url = (overrideUrl || this.getIntegrations().crmWebhookUrl || '').trim()
    if (!url) {
      return { ok: false, error: 'No CRM webhook URL configured' }
    }
    try {
      const body = typeof payload === 'string' ? JSON.stringify({ text: payload, notes: payload }) : JSON.stringify(payload)
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
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

  async sendLinear(
    issue: { title: string; description: string; teamId?: string },
    overrideKey?: string
  ): Promise<{ ok: boolean; issueUrl?: string; error?: string }> {
    const key = (overrideKey || this.getIntegrations().linearApiKey || '').trim()
    if (!key) {
      return { ok: false, error: 'No Linear API key configured in Settings → Integrations' }
    }
    try {
      let teamId = issue.teamId
      if (!teamId) {
        const teamsResp = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: key
          },
          body: JSON.stringify({
            query: 'query { teams(first: 1) { nodes { id name } } }'
          })
        })
        const teamsData = (await teamsResp.json()) as { data?: { teams?: { nodes?: Array<{ id: string }> } } }
        teamId = teamsData?.data?.teams?.nodes?.[0]?.id
        if (!teamId) {
          return { ok: false, error: 'No accessible Linear team found for this API key' }
        }
      }

      const mutation = `
        mutation IssueCreate($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              title
              url
            }
          }
        }
      `
      const resp = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: key
        },
        body: JSON.stringify({
          query: mutation,
          variables: {
            input: {
              title: issue.title,
              description: issue.description,
              teamId
            }
          }
        })
      })
      const result = (await resp.json()) as {
        data?: { issueCreate?: { success?: boolean; issue?: { id: string; url?: string } } }
        errors?: Array<{ message: string }>
      }
      const created = result?.data?.issueCreate?.issue
      if (result?.data?.issueCreate?.success && created) {
        return { ok: true, issueUrl: created.url }
      }
      return {
        ok: false,
        error: result?.errors?.[0]?.message || 'Failed to create Linear issue'
      }
    } catch (err) {
      logger.warn('Failed to dispatch Linear issue', (err as Error).message)
      return { ok: false, error: (err as Error).message }
    }
  }

  async sendNotion(
    page: { title: string; markdown: string; parentPageId?: string },
    overrideToken?: string
  ): Promise<{ ok: boolean; pageUrl?: string; error?: string }> {
    const token = (overrideToken || this.getIntegrations().notionToken || '').trim()
    if (!token) {
      return { ok: false, error: 'No Notion integration token configured in Settings → Integrations' }
    }
    try {
      const paragraphs = page.markdown
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 40)

      const children = paragraphs.map((para) => {
        if (para.startsWith('## ')) {
          return {
            object: 'block',
            type: 'heading_2',
            heading_2: {
              rich_text: [{ type: 'text', text: { content: para.replace(/^##\s+/, '') } }]
            }
          }
        }
        if (para.startsWith('- [ ] ') || para.startsWith('- [x] ')) {
          return {
            object: 'block',
            type: 'to_do',
            to_do: {
              rich_text: [{ type: 'text', text: { content: para.replace(/^- \[[ x]\]\s+/, '') } }],
              checked: para.startsWith('- [x] ')
            }
          }
        }
        if (para.startsWith('- ') || para.startsWith('* ')) {
          return {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: para.replace(/^[-*]\s+/, '') } }]
            }
          }
        }
        return {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: para.slice(0, 1900) } }]
          }
        }
      })

      let parent: { page_id: string } | null = page.parentPageId ? { page_id: page.parentPageId } : null
      if (!parent) {
        const searchResp = await fetch('https://api.notion.com/v1/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            filter: { value: 'page', property: 'object' },
            page_size: 1
          })
        })
        const searchData = (await searchResp.json()) as { results?: Array<{ id: string }> }
        const foundId = searchData?.results?.[0]?.id
        if (foundId) {
          parent = { page_id: foundId }
        }
      }

      if (!parent) {
        return {
          ok: false,
          error: 'No accessible Notion page found. Share a page with your Klyro integration in Notion.'
        }
      }

      const createResp = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          parent,
          properties: {
            title: {
              title: [{ text: { content: page.title } }]
            }
          },
          children
        })
      })

      const created = (await createResp.json()) as { id?: string; url?: string; message?: string }
      if (createResp.ok && created?.id) {
        return { ok: true, pageUrl: created.url || `https://notion.so/${created.id.replace(/-/g, '')}` }
      }
      return {
        ok: false,
        error: created?.message || `Notion HTTP error ${createResp.status}`
      }
    } catch (err) {
      logger.warn('Failed to dispatch Notion page', (err as Error).message)
      return { ok: false, error: (err as Error).message }
    }
  }

  async pushMeetingNotes(
    notes: MeetingCrmNotes,
    target: 'slack' | 'crm' | 'notion' | 'linear',
    title: string = 'Meeting Notes'
  ): Promise<{ ok: boolean; url?: string; error?: string }> {
    if (target === 'slack') {
      const formatted = formatForSlack(notes)
      return this.sendSlack(formatted)
    }
    if (target === 'crm') {
      const payload = formatForCrm(notes)
      return this.sendCrm(payload)
    }
    if (target === 'notion') {
      const md = formatForNotion(notes)
      return this.sendNotion({ title, markdown: md })
    }
    if (target === 'linear') {
      const desc =
        (notes.executiveSummary || '') +
        '\n\n### Action Items\n' +
        notes.actionItems.map((a) => `- [ ] ${a.task} (@${a.owner || 'unassigned'})`).join('\n')
      return this.sendLinear({ title, description: desc })
    }
    return { ok: false, error: `Unknown integration target: ${target}` }
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
