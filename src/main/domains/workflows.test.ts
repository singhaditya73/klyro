import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-workflow-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

// Deterministic model: echo the prompt so template substitution is observable.
vi.mock('../providers', () => ({
  getProvider: () => ({
    id: 'fake',
    async *chat(options: { turns: { text: string }[] }) {
      yield `ECHO(${options.turns[0].text})`
    },
    test: async () => ({ ok: true, detail: 'fake' })
  })
}))

const { workflows, BUILTIN_WORKFLOWS } = await import('./workflows')
const { conversations } = await import('./conversations')
const { github } = await import('./integrations')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('workflows', () => {
  it('ships the built-in workflows', () => {
    const ids = workflows.list().map((workflow) => workflow.id)
    expect(ids).toEqual(expect.arrayContaining(BUILTIN_WORKFLOWS.map((workflow) => workflow.id)))
  })

  it('runs a prompt workflow, substituting the input', async () => {
    const result = await workflows.run('builtin:notes-to-actions', 'ship Stage D')
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0].ok).toBe(true)
    expect(result.steps[0].output).toContain('ship Stage D')

    const conversation = conversations.get(result.conversationId)
    expect(conversation?.title).toBe('Turn notes into action items')
    expect(conversation?.messages).toHaveLength(2)
    expect(conversation?.messages[0].role).toBe('user')
    expect(conversation?.messages[1].role).toBe('assistant')
  })

  it('chains steps through {{prev}}', async () => {
    const workflow = workflows.create({
      name: 'Chain',
      description: 'two steps',
      steps: [
        { kind: 'prompt', name: 'first', template: 'one {{input}}' },
        { kind: 'prompt', name: 'second', template: 'two {{prev}}' }
      ]
    })
    const result = await workflows.run(workflow.id, 'hello')
    expect(result.steps.map((step) => step.name)).toEqual(['first', 'second'])
    expect(result.steps[0].output).toBe('ECHO(one hello)')
    expect(result.steps[1].output).toBe('ECHO(two ECHO(one hello))')
  })

  it('feeds fetched GitHub issues into the next step', async () => {
    github.setToken('test-token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify([
            {
              number: 12,
              title: 'Fix the overlay',
              state: 'open',
              html_url: 'https://example.com/12',
              created_at: '2026-01-01T00:00:00Z',
              labels: [{ name: 'bug' }],
              user: { login: 'singhaditya73' }
            }
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      })
    )

    const result = await workflows.run('builtin:standup', 'singhaditya73/klyro')
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0].output).toContain('#12 Fix the overlay')
    expect(result.steps[1].output).toContain('#12 Fix the overlay')
  })

  it('stops at the first failing step and reports it', async () => {
    const workflow = workflows.create({
      name: 'Failing',
      steps: [{ kind: 'githubIssues', name: 'fetch', repo: '{{input}}' }]
    })
    const result = await workflows.run(workflow.id, 'not-a-repo')
    expect(result.steps).toEqual([{ name: 'fetch', output: expect.stringMatching(/owner\/name/), ok: false }])
  })

  it('validates workflow definitions', () => {
    expect(() => workflows.create({ name: '  ', steps: [{ kind: 'prompt', name: 'a', template: 'x' }] })).toThrow(
      /needs a name/
    )
    expect(() => workflows.create({ name: 'Empty', steps: [] })).toThrow(/at least one step/)
  })

  it('refuses to delete built-in workflows', () => {
    expect(() => workflows.remove('builtin:standup')).toThrow(/Built-in/)
  })
})
