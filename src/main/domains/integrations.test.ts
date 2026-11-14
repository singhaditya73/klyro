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

  it('fails gracefully when dispatching Linear issue without an API key', async () => {
    integrationsDomain.updateIntegrations({ linearApiKey: '' })
    const result = await integrationsDomain.sendLinear({
      title: 'Fix issue',
      description: 'Bug description'
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No Linear API key')
  })

  it('fails gracefully when dispatching Notion page without a token', async () => {
    integrationsDomain.updateIntegrations({ notionToken: '' })
    const result = await integrationsDomain.sendNotion({
      title: 'Meeting Notes',
      markdown: '## Summary\nTest notes'
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('No Notion integration token')
  })

  it('dispatches meeting notes to Slack when configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('ok', { status: 200 }))
    integrationsDomain.updateIntegrations({ slackWebhookUrl: 'https://hooks.slack.com/services/test' })

    const sampleNotes = {
      title: 'Architecture Sync',
      type: 'client_call' as const,
      executiveSummary: 'Executive summary',
      discussionTopics: ['Architecture'],
      actionItems: [{ task: 'Update DB', owner: 'Aditya', category: 'technical' as const }],
      keyDecisions: ['Approved design'],
      model: 'mock-model',
      generatedAt: Date.now()
    }

    const res = await integrationsDomain.pushMeetingNotes(sampleNotes, 'slack', 'Architecture Sync')
    expect(res.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
