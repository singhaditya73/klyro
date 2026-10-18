import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'klyro-github-'))

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

const { github } = await import('./github')

interface Call {
  url: string
  init?: RequestInit
}

let calls: Call[] = []

function stubJson(payload: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
    })
  )
}

beforeEach(() => {
  calls = []
  github.setToken('test-token')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('github integration', () => {
  it('reports disconnected until a token is set', () => {
    github.clearToken()
    expect(github.status().connected).toBe(false)
    expect(github.status().detail).toMatch(/token/i)
  })

  it('refuses API calls without a token', async () => {
    github.clearToken()
    await expect(github.whoami()).rejects.toThrow(/not connected/i)
  })

  it('authenticates requests and maps the account', async () => {
    stubJson({ login: 'octocat', name: 'Mona', avatar_url: 'https://example.com/a.png' })
    const account = await github.whoami()
    expect(account).toEqual({ login: 'octocat', name: 'Mona', avatarUrl: 'https://example.com/a.png' })

    const headers = calls[0].init?.headers as Record<string, string>
    expect(calls[0].url).toContain('https://api.github.com/user')
    expect(headers.authorization).toBe('Bearer test-token')
    expect(headers.accept).toContain('application/vnd.github+json')
  })

  it('caches the account after the first lookup', async () => {
    stubJson({ login: 'octocat', name: null, avatar_url: 'x' })
    await github.whoami()
    await github.whoami()
    expect(calls).toHaveLength(1)
  })

  it('maps repositories', async () => {
    stubJson([
      {
        full_name: 'singhaditya73/klyro',
        description: 'assistant',
        private: false,
        updated_at: '2026-01-01T00:00:00Z',
        open_issues_count: 3
      }
    ])
    const repos = await github.repos(10)
    expect(repos).toEqual([
      { fullName: 'singhaditya73/klyro', description: 'assistant', isPrivate: false, updatedAt: '2026-01-01T00:00:00Z', openIssues: 3 }
    ])
    expect(calls[0].url).toContain('per_page=10')
  })

  it('maps issues and flags pull requests', async () => {
    stubJson([
      {
        number: 7,
        title: 'Fix the thing',
        state: 'open',
        html_url: 'https://github.com/singhaditya73/klyro/issues/7',
        created_at: '2026-01-01T00:00:00Z',
        labels: [{ name: 'bug' }, { name: 'p1' }],
        user: { login: 'octocat' }
      },
      {
        number: 8,
        title: 'A PR',
        state: 'open',
        html_url: 'https://github.com/singhaditya73/klyro/pull/8',
        created_at: '2026-01-02T00:00:00Z',
        labels: [],
        user: null,
        pull_request: { url: 'x' }
      }
    ])
    const issues = await github.issues('singhaditya73/klyro')
    expect(issues[0]).toMatchObject({ number: 7, labels: ['bug', 'p1'], author: 'octocat', isPullRequest: false })
    expect(issues[1]).toMatchObject({ isPullRequest: true, author: 'unknown' })
  })

  it('rejects malformed repository identifiers', async () => {
    await expect(github.issues('not-a-repo')).rejects.toThrow(/owner\/name/)
    expect(calls).toHaveLength(0)
  })

  it('creates an issue with the right payload', async () => {
    stubJson(
      {
        number: 9,
        title: 'Ship Stage C',
        state: 'open',
        html_url: 'https://github.com/singhaditya73/klyro/issues/9',
        created_at: '2026-01-03T00:00:00Z',
        labels: [],
        user: { login: 'octocat' }
      },
      201
    )
    const issue = await github.createIssue('singhaditya73/klyro', '  Ship Stage C  ', 'body text')
    expect(issue.number).toBe(9)
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ title: 'Ship Stage C', body: 'body text' })
  })

  it('requires a title when creating an issue', async () => {
    await expect(github.createIssue('singhaditya73/klyro', '   ', 'body')).rejects.toThrow(/title is required/i)
    expect(calls).toHaveLength(0)
  })

  it('translates HTTP failures into readable errors', async () => {
    stubJson({ message: 'Bad credentials' }, 401)
    await expect(github.whoami()).rejects.toThrow(/rejected the token \(401\)/)
    vi.unstubAllGlobals()
    stubJson({ message: 'rate limited' }, 403)
    await expect(github.repos()).rejects.toThrow(/403/)
    vi.unstubAllGlobals()
    stubJson({ message: 'Not Found' }, 404)
    await expect(github.issues('a/b')).rejects.toThrow(/404/)
  })
})
