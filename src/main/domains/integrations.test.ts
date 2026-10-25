import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-integrations-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  // A fake OS keychain: enough to prove nothing is written in plaintext.
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`).toString('base64'),
    decryptString: (value: string) => Buffer.from(value, 'base64').toString().replace(/^enc:/, '')
  }
}))

beforeAll(() => {
  // An earlier build wrote a token straight into the JSON store.
  writeFileSync(
    join(userData, 'integrations.json'),
    JSON.stringify({
      integrations: { notionToken: 'legacy-notion-token', crmType: 'hubspot' },
      servers: []
    })
  )
})

const { integrationsDomain } = await import('./integrations')

describe('integration credentials', () => {
  it('moves a plaintext token out of the JSON store on first read', () => {
    expect(integrationsDomain.getIntegrations().notionToken).toBe('legacy-notion-token')

    const json = readFileSync(join(userData, 'integrations.json'), 'utf8')
    expect(json).not.toContain('legacy-notion-token')

    const stored = JSON.parse(readFileSync(join(userData, 'secrets.json'), 'utf8')) as {
      encrypted: boolean
      keys: Record<string, string>
    }
    expect(stored.encrypted).toBe(true)
    expect(stored.keys['integration.notion-token']).toBeTruthy()
  })

  it('writes a webhook URL encrypted and keeps non-secrets readable', () => {
    const url = 'https://hooks.slack.com/services/T000/B000/XXXX'
    const saved = integrationsDomain.updateIntegrations({
      slackWebhookUrl: url,
      crmType: 'salesforce',
      gmailRecipient: 'ops@example.com'
    })

    expect(saved.slackWebhookUrl).toBe(url)
    expect(saved.crmType).toBe('salesforce')
    expect(integrationsDomain.getIntegrations().slackWebhookUrl).toBe(url)

    const json = readFileSync(join(userData, 'integrations.json'), 'utf8')
    expect(json).not.toContain(url)
    expect(json).toContain('ops@example.com')
  })

  it('reports MCP servers as saved definitions, not as running', () => {
    const added = integrationsDomain.addServer({ name: 'Local Files', command: 'npx' })
    expect(added.enabled).toBe(true)
    expect(added.tools).toEqual([])

    const saved = integrationsDomain.listServers().find((server) => server.config.id === added.config.id)
    expect(saved?.enabled).toBe(true)
    expect(saved?.tools).toEqual([])
  })

  it('checks the command exists instead of claiming a connection', async () => {
    const added = integrationsDomain.addServer({
      name: 'Missing',
      command: 'klyro-command-that-does-not-exist'
    })
    const result = await integrationsDomain.testServer(added.config.id)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not found')
  })
})
