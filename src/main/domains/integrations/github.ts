import type { GitHubAccount, GitHubIssue, GitHubRepo } from '@shared/types'
import { logger } from '../../logger'
import { secrets } from '../../security/secrets'

const SECRET_ID = 'integration:github'
const API = 'https://api.github.com'
const OWNER_REPO = /^[\w.-]+\/[\w.-]+$/

interface RawIssue {
  number: number
  title: string
  state: string
  html_url: string
  created_at: string
  labels: Array<{ name: string }>
  user: { login: string } | null
  pull_request?: unknown
}

/** GitHub REST integration. The token lives in the encrypted secret store. */
class GitHubIntegration {
  readonly id = 'github' as const
  readonly label = 'GitHub'

  private account: GitHubAccount | null = null

  private token(): string | null {
    return secrets.get(SECRET_ID)
  }

  connected(): boolean {
    return Boolean(this.token())
  }

  setToken(token: string): void {
    secrets.set(SECRET_ID, token)
    this.account = null
  }

  clearToken(): void {
    secrets.delete(SECRET_ID)
    this.account = null
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.token()
    if (!token) throw new Error('GitHub is not connected. Add a personal access token first.')

    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        authorization: `Bearer ${token}`,
        'user-agent': 'Klyro',
        ...(init?.body ? { 'content-type': 'application/json' } : {})
      }
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      if (response.status === 401) throw new Error('GitHub rejected the token (401).')
      if (response.status === 403) throw new Error('GitHub refused the request — check token scopes or rate limit (403).')
      if (response.status === 404) throw new Error('Repository not found, or the token cannot see it (404).')
      throw new Error(`GitHub error ${response.status}: ${detail.slice(0, 200)}`)
    }
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  private assertRepo(ownerRepo: string): string {
    const value = ownerRepo.trim()
    if (!OWNER_REPO.test(value)) throw new Error('Repository must look like "owner/name".')
    return value
  }

  private toIssue(raw: RawIssue): GitHubIssue {
    return {
      number: raw.number,
      title: raw.title,
      state: raw.state,
      url: raw.html_url,
      labels: (raw.labels ?? []).map((label) => label.name),
      createdAt: raw.created_at,
      author: raw.user?.login ?? 'unknown',
      isPullRequest: Boolean(raw.pull_request)
    }
  }

  async whoami(): Promise<GitHubAccount> {
    if (this.account) return this.account
    const raw = await this.request<{ login: string; name: string | null; avatar_url: string }>('/user')
    this.account = { login: raw.login, name: raw.name, avatarUrl: raw.avatar_url }
    return this.account
  }

  async repos(limit = 20): Promise<GitHubRepo[]> {
    const raw = await this.request<
      Array<{ full_name: string; description: string | null; private: boolean; updated_at: string; open_issues_count: number }>
    >(`/user/repos?per_page=${Math.min(limit, 100)}&sort=updated&affiliation=owner,collaborator,organization_member`)
    return raw.map((repo) => ({
      fullName: repo.full_name,
      description: repo.description,
      isPrivate: repo.private,
      updatedAt: repo.updated_at,
      openIssues: repo.open_issues_count
    }))
  }

  async issues(ownerRepo: string, limit = 20): Promise<GitHubIssue[]> {
    const repo = this.assertRepo(ownerRepo)
    const raw = await this.request<RawIssue[]>(
      `/repos/${repo}/issues?state=open&per_page=${Math.min(limit, 100)}&sort=updated`
    )
    return raw.map((issue) => this.toIssue(issue))
  }

  async createIssue(ownerRepo: string, title: string, body: string): Promise<GitHubIssue> {
    const repo = this.assertRepo(ownerRepo)
    const cleanTitle = title.trim().slice(0, 200)
    if (!cleanTitle) throw new Error('An issue title is required.')
    const raw = await this.request<RawIssue>(`/repos/${repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title: cleanTitle, body: body.slice(0, 20000) })
    })
    logger.info(`GitHub: created issue #${raw.number} in ${repo}`)
    return this.toIssue(raw)
  }

  status(): { connected: boolean; detail: string } {
    return this.connected()
      ? { connected: true, detail: 'Token stored (encrypted)' }
      : { connected: false, detail: 'Add a personal access token with the "repo" scope' }
  }
}

export const github = new GitHubIntegration()
