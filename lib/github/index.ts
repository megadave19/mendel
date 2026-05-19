import { Octokit } from '@octokit/rest'
import simpleGit from 'simple-git'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import type {
  PatValidationResult,
  RepoMeta,
  MonorepoDetectionResult,
  OpenPR,
} from './types'
import { GitHubError } from './types'

const REQUIRED_SCOPES = ['repo', 'read:user']

// ─── PAT validation ───────────────────────────────────────────────────────────

export async function validatePAT(pat: string): Promise<PatValidationResult> {
  const client = new Octokit({ auth: pat })
  try {
    const { data: user, headers } = await client.rest.users.getAuthenticated()
    const scopeHeader = (headers as Record<string, string>)['x-oauth-scopes'] ?? ''
    const scopes = scopeHeader
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const missingScopes = REQUIRED_SCOPES.filter(
      (required) => !scopes.some((s) => s === required || s === 'repo'),
    )

    return {
      valid: missingScopes.length === 0,
      user: { login: user.login, name: user.name ?? null, email: user.email ?? null },
      scopes,
      missingScopes,
    }
  } catch (err) {
    return { valid: false, user: null, scopes: [], missingScopes: REQUIRED_SCOPES, error: wrapError(err).message }
  }
}

// ─── Repo metadata ────────────────────────────────────────────────────────────

export async function getRepoMeta(
  pat: string,
  owner: string,
  repo: string,
): Promise<RepoMeta> {
  const client = new Octokit({ auth: pat })
  try {
    const { data } = await client.rest.repos.get({ owner, repo })
    return {
      owner,
      repo,
      defaultBranch: data.default_branch,
      size: data.size,
      private: data.private,
      fork: data.fork,
    }
  } catch (err) {
    throw wrapError(err)
  }
}

// ─── Clone ────────────────────────────────────────────────────────────────────

export async function cloneRepo(url: string, destPath: string): Promise<void> {
  const git = simpleGit()
  try {
    await git.clone(url, destPath, ['--depth=1'])
  } catch (err) {
    throw new GitHubError('network', `Clone failed: ${String(err)}`)
  }
}

// ─── Monorepo detection ───────────────────────────────────────────────────────

const SIMPLE_MONOREPO_MARKERS = ['lerna.json', 'rush.json', 'nx.json', 'turbo.json']

export function detectMonorepo(localPath: string): MonorepoDetectionResult {
  const indicators: string[] = []

  for (const marker of SIMPLE_MONOREPO_MARKERS) {
    if (existsSync(path.join(localPath, marker))) {
      indicators.push(marker)
    }
  }

  // pnpm-workspace.yaml is only a monorepo marker if it declares `packages`
  // (it is also used for allowBuilds config in single-package repos)
  const pnpmWs = path.join(localPath, 'pnpm-workspace.yaml')
  if (existsSync(pnpmWs)) {
    const content = readFileSync(pnpmWs, 'utf-8')
    if (content.includes('packages:')) indicators.push('pnpm-workspace.yaml')
  }

  const pkgPath = path.join(localPath, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      workspaces?: unknown
    }
    if (pkg.workspaces) indicators.push('package.json#workspaces')
  }

  return { isMonorepo: indicators.length > 0, indicators }
}

// ─── Open PRs (dedup check) ───────────────────────────────────────────────────

export async function findOpenPRsByHeadPattern(
  pat: string,
  owner: string,
  repo: string,
  headPattern: string,
): Promise<OpenPR[]> {
  const client = new Octokit({ auth: pat })
  try {
    const prs: OpenPR[] = []
    // Paginate through all open PRs
    for await (const response of client.paginate.iterator(client.rest.pulls.list, {
      owner,
      repo,
      state: 'open',
      per_page: 100,
    })) {
      for (const pr of response.data) {
        if (pr.head.ref.includes(headPattern)) {
          prs.push({
            number: pr.number,
            title: pr.title,
            url: pr.html_url,
            headRef: pr.head.ref,
            draft: pr.draft ?? false,
          })
        }
      }
    }
    return prs
  } catch (err) {
    throw wrapError(err)
  }
}

// ─── Create Draft PR (Phase 1C) ───────────────────────────────────────────────

export async function createDraftPR(
  pat: string,
  owner: string,
  repo: string,
  opts: { title: string; body: string; head: string; base: string },
): Promise<string> {
  const client = new Octokit({ auth: pat })
  try {
    const { data } = await client.rest.pulls.create({
      owner,
      repo,
      title: opts.title,
      body: opts.body,
      head: opts.head,
      base: opts.base,
      draft: true,
    })
    return data.html_url
  } catch (err) {
    throw wrapError(err)
  }
}

// ─── Error normalisation ──────────────────────────────────────────────────────

function wrapError(err: unknown): GitHubError {
  if (err instanceof GitHubError) return err
  if (err && typeof err === 'object' && 'status' in err) {
    const e = err as { status: number; message?: string; response?: { headers?: Record<string, string> } }
    const retryAfter = e.response?.headers?.['retry-after']
    if (e.status === 401 || e.status === 403) {
      return new GitHubError('auth', e.message ?? 'Auth failed')
    }
    if (e.status === 429) {
      return new GitHubError('rate-limit', 'Rate limited', retryAfter ? Number(retryAfter) * 1000 : 60_000)
    }
    if (e.status === 404) {
      return new GitHubError('not-found', e.message ?? 'Not found')
    }
    if (e.status === 422) {
      return new GitHubError('validation', e.message ?? 'Validation failed')
    }
  }
  return new GitHubError('unknown', String(err))
}
