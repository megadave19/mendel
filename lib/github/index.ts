import { Octokit } from '@octokit/rest'
import simpleGit from 'simple-git'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import type {
  PatValidationResult,
  RepoMeta,
  MonorepoDetectionResult,
  OpenPR,
  PullRequestState,
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

// ─── Create PR (Phase 1C: Draft only; v1.5: gated standard or Draft) ─────────
//
// Backward-compatible: `draft` is optional and defaults to true so any v1.0
// caller that hasn't been updated still gets the Draft-only behaviour.
//
// CLAUDE.md §5b v1.5 rule 5: standard (non-Draft) PRs are ONLY permitted
// when the runner's threshold gate has resolved to mode='standard'. The
// gate logic lives in lib/agent/confidence/threshold.ts; this function just
// honors what the caller asks for.

export async function createDraftPR(
  pat: string,
  owner: string,
  repo: string,
  opts: { title: string; body: string; head: string; base: string; draft?: boolean },
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
      draft: opts.draft ?? true,
    })
    return data.html_url
  } catch (err) {
    throw wrapError(err)
  }
}

// ─── PR state (v1.5 W#10 Push 2 — automated rejection detection) ──────────────

/**
 * Fetch the current state of a single PR. Used by the PR-state poller to
 * detect when a Mendel-opened PR was merged (accepted) or closed without
 * merge (rejected → feeds the learning loop).
 */
export async function getPullRequestState(
  pat: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequestState> {
  const client = new Octokit({ auth: pat })
  try {
    const { data } = await client.rest.pulls.get({ owner, repo, pull_number: prNumber })
    return {
      state: data.state === 'closed' ? 'closed' : 'open',
      merged: data.merged ?? false,
      mergedAt: data.merged_at ?? null,
      closedAt: data.closed_at ?? null,
    }
  } catch (err) {
    throw wrapError(err)
  }
}

/**
 * Latest human comment on a PR (PRs are issues for the comments API). Used as
 * the verbatim rejection reason when a PR is closed without merge. Returns
 * null when there are no comments — the poller then uses a clearly-labeled
 * auto-detected reason instead of fabricating one (CLAUDE.md §5b).
 */
export async function getLatestPullRequestComment(
  pat: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<string | null> {
  const client = new Octokit({ auth: pat })
  try {
    const { data } = await client.rest.issues.listComments({
      owner, repo, issue_number: prNumber, per_page: 100,
    })
    if (data.length === 0) return null
    const last = data[data.length - 1]
    const body = (last.body ?? '').trim()
    return body.length > 0 ? body : null
  } catch {
    // Comment fetch is best-effort context; never fail the poll over it.
    return null
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
