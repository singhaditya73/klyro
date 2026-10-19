import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-workflow-'))

/** Knobs the provider mock reads, so individual tests can change behaviour. */
const behaviour = vi.hoisted(() => ({ hang: false, calls: 0 }))

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^enc:/, '')
  }
}))

// Deterministic model: echo the prompt so template substitution is observable.
vi.mock('../providers', () => ({
  getProvider: () => ({
    id: 'fake',
    async *chat(options: { turns: { text: string }[] }) {
      behaviour.calls += 1
      if (behaviour.hang) await new Promise(() => undefined)
      yield `ECHO(${options.turns[0].text})`
    },
    test: async () => ({ ok: true, detail: 'fake' })
  })
}))

const { workflows, BUILTIN_WORKFLOWS, workflowToolCatalogue } = await import('./workflows')
const { conversations } = await import('./conversations')
const { github } = await import('./integrations')
const { documents } = await import('./documents')
const { memory } = await import('./memory')
const { secrets } = await import('../security/secrets')

// Provider routing refuses to call a hosted provider with no key; these tests
// exercise the engine, so configure a key rather than weakening the guard.
secrets.set('openai', 'test-key')

afterEach(() => {
  vi.unstubAllGlobals()
  behaviour.hang = false
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
    expect(result.status).toBe('failed')
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]).toMatchObject({ name: 'fetch', ok: false })
    expect(result.steps[0].output).toMatch(/owner\/name/)
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

  it('describes every step type it can run', () => {
    const catalogue = workflowToolCatalogue()
    expect(catalogue.map((tool) => tool.kind).sort()).toEqual(
      ['githubCreateIssue', 'githubIssues', 'knowledge', 'meetingSummary', 'prompt'].sort()
    )
    for (const tool of catalogue) expect(tool.description.length).toBeGreaterThan(10)
  })

  it('keeps a durable record of each run', async () => {
    const workflow = workflows.create({
      name: 'Recorded',
      steps: [{ kind: 'prompt', name: 'only', template: 'hello {{input}}' }]
    })
    const result = await workflows.run(workflow.id, 'world')
    const record = workflows.runs().find((run) => run.id === result.runId)

    expect(record).toBeDefined()
    expect(record?.status).toBe('completed')
    expect(record?.finishedAt).toBeGreaterThanOrEqual(record?.startedAt ?? 0)
    expect(record?.steps).toEqual([
      expect.objectContaining({ id: 'only', name: 'only', status: 'done', attempts: 1 })
    ])
  })

  it('retries a transient failure before giving up', async () => {
    github.setToken('retry-token')
    let attempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempts += 1
        if (attempts === 1) throw new Error('network hiccup')
        return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
      })
    )

    const workflow = workflows.create({
      name: 'Retrying',
      steps: [{ kind: 'githubIssues', name: 'fetch', repo: '{{input}}', retries: 1, output: 'issues' }]
    })
    const result = await workflows.run(workflow.id, 'singhaditya73/klyro')

    expect(attempts).toBe(2)
    expect(result.status).toBe('completed')
    expect(result.steps[0]).toMatchObject({ ok: true, attempts: 2 })
  })

  it('continues past a step whose failure policy says so', async () => {
    const workflow = workflows.create({
      name: 'Tolerant',
      steps: [
        { kind: 'githubIssues', name: 'fetch', repo: '{{input}}', onFailure: 'continue', output: 'issues' },
        { kind: 'prompt', name: 'summarise', template: 'summary of {{input}}' }
      ]
    })
    const result = await workflows.run(workflow.id, 'not-a-repo')

    expect(result.status).toBe('completed')
    expect(result.steps.map((step) => step.ok)).toEqual([false, true])
    expect(result.steps[1].output).toBe('ECHO(summary of not-a-repo)')
  })

  it('times out a step that never answers', async () => {
    behaviour.hang = true
    const workflow = workflows.create({
      name: 'Hanging',
      steps: [{ kind: 'prompt', name: 'hang', template: 'never returns', timeoutMs: 1000 }]
    })
    const result = await workflows.run(workflow.id, '')

    expect(result.status).toBe('failed')
    expect(result.steps[0].ok).toBe(false)
    expect(result.steps[0].output).toMatch(/timed out after 1s/)
  }, 10_000)

  it('grounds a step in local memories and documents', async () => {
    memory.clear()
    memory.add({ text: 'The user deploys with the release workflow' })
    documents.importText('notes.md', 'Deployment uses the release workflow on a tag.', '/tmp/notes.md')

    const workflow = workflows.create({
      name: 'Knowledge',
      steps: [{ kind: 'knowledge', name: 'recall', query: 'release workflow deployment' }]
    })
    const result = await workflows.run(workflow.id, '')

    expect(result.steps[0].ok).toBe(true)
    expect(result.steps[0].output).toMatch(/release workflow/i)
  })

  it('marks a run interrupted by a crash instead of leaving it running', async () => {
    writeFileSync(
      join(userData, 'workflows.json'),
      JSON.stringify({
        custom: [],
        runs: [
          {
            id: 'run-crashed',
            workflowId: 'w1',
            workflowName: 'Crashed',
            input: '',
            conversationId: 'c1',
            status: 'running',
            startedAt: 1,
            finishedAt: 0,
            steps: [{ id: 's1', name: 'Step', status: 'running', attempts: 1 }]
          }
        ]
      })
    )

    vi.resetModules()
    const reloaded = (await import('./workflows')).workflows
    const [run] = reloaded.runs()

    expect(run.status).toBe('interrupted')
    expect(run.error).toMatch(/closed before this run finished/)
    expect(run.steps[0].status).toBe('failed')
  })
})
