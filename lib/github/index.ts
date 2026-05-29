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
  RepoIssue,
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

// ─── Open issues (for issue-linking, CLAUDE.md §5c.2) ─────────────────────────
//
// Read-only. We link PRs to issues the maintainer ALREADY opened (consent
// exists); we never create issues on repos we don't own. Excludes PRs (the
// issues API returns both; a PR has a `pull_request` field).

export async function listOpenIssues(
  pat: string,
  owner: string,
  repo: string,
  max = 100,
): Promise<RepoIssue[]> {
  const client = new Octokit({ auth: pat })
  try {
    const out: RepoIssue[] = []
    for await (const response of client.paginate.iterator(client.rest.issues.listForRepo, {
      owner,
      repo,
      state: 'open',
      per_page: 100,
    })) {
      for (const iss of response.data) {
        if (iss.pull_request) continue // exclude PRs
        out.push({
          number: iss.number,
          title: iss.title,
          url: iss.html_url,
          labels: (iss.labels ?? [])
            .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
            .filter(Boolean),
          body: (iss.body ?? '').slice(0, 2000),
        })
        if (out.length >= max) return out
      }
      if (out.length >= max) break
    }
    return out
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

// ─── Fork support (so Mendel can PR against repos the user doesn't own) ───────
//
// v1.5 fix (2026-05-28): submitDraftPR used to push the fix branch directly to
// the upstream repo. For any repo the user lacks write access to (i.e. every
// repo they don't own), the push 403'd and no PR ever opened — yet the scan
// still completed. This adds the fork-and-PR path the PRD/Phase-1B gate always
// assumed existed: fork → push to the fork → open the PR fork→upstream.

/** Login of the PAT owner — used to build the fork remote + cross-repo PR head. */
export async function getAuthenticatedLogin(pat: string): Promise<string> {
  const client = new Octokit({ auth: pat })
  try {
    const { data } = await client.rest.users.getAuthenticated()
    return data.login
  } catch (err) {
    throw wrapError(err)
  }
}

// ─── Pre-flight: can this token actually deliver a PR? ────────────────────────
//
// Decide BEFORE a scan does minutes of clone/install/analysis, so a token that
// can neither push nor fork fails fast with ONE clear instruction instead of
// 403'ing at submit. Autonomy is bounded by granted authority (CLAUDE.md §5c):
// we surface the one-time credential fix — we never escalate our own perms.

export type SubmitCapability =
  | { mode: 'direct' } // can push to upstream → PR pushes directly
  | { mode: 'fork' } //   no upstream write, but can fork (or a fork exists) → PR from fork
  | { mode: 'blocked'; reason: string } // can neither push nor fork → tell the user the one-time fix

/** Pure decision from the three facts we can fetch. Unit-tested. */
export function decideSubmitCapability(input: {
  canPushUpstream: boolean
  existingForkPushable: boolean
  tokenCanFork: boolean
}): SubmitCapability {
  if (input.canPushUpstream) return { mode: 'direct' }
  if (input.existingForkPushable) return { mode: 'fork' }
  if (input.tokenCanFork) return { mode: 'fork' }
  return {
    mode: 'blocked',
    reason:
      "Mendel can't open a PR with the current GitHub token: you don't have write access to this " +
      "repo, and the token can't create a fork. One-time fix → create a CLASSIC personal access " +
      'token with the "repo" scope (GitHub → Settings → Developer settings → Tokens (classic); add ' +
      '"workflow" too if the repo uses GitHub Actions), paste it in Mendel → Settings, and re-scan. ' +
      'After that Mendel forks, pushes, and opens PRs autonomously on any repo. ' +
      '(Fine-grained tokens generally cannot fork repositories owned by other people.)',
  }
}

/** Gather the three facts (≤3 API calls, ~2s) and decide. */
export async function assessSubmitCapability(
  pat: string,
  owner: string,
  repo: string,
): Promise<SubmitCapability> {
  const client = new Octokit({ auth: pat })
  let canPushUpstream = false
  let tokenCanFork = false
  let me = ''
  try {
    const upstream = await client.rest.repos.get({ owner, repo })
    canPushUpstream = Boolean(upstream.data.permissions?.push)

    const auth = await client.rest.users.getAuthenticated()
    me = auth.data.login
    // Classic tokens expose granted scopes; `repo`/`public_repo` can fork public
    // repos. Fine-grained tokens send no x-oauth-scopes header → treated as
    // can't-fork (accurate: they can't fork repos owned by others).
    const scopes = ((auth.headers as Record<string, string>)['x-oauth-scopes'] ?? '')
      .split(',')
      .map((s) => s.trim())
    tokenCanFork = scopes.includes('repo') || scopes.includes('public_repo')
  } catch (err) {
    throw wrapError(err)
  }

  // Is there already a pushable fork under the user? (Escape hatch for restricted
  // tokens: a fork made once on github.com can still be pushed to.)
  let existingForkPushable = false
  if (!canPushUpstream && me) {
    try {
      const { data: f } = await client.rest.repos.get({ owner: me, repo })
      const parent = (f as { parent?: { full_name?: string } }).parent?.full_name
      const matchesUpstream = !parent || parent.toLowerCase() === `${owner}/${repo}`.toLowerCase()
      existingForkPushable = Boolean(f.fork && matchesUpstream && f.permissions?.push)
    } catch {
      /* no fork under the user — fine */
    }
  }

  return decideSubmitCapability({ canPushUpstream, existingForkPushable, tokenCanFork })
}

/** Whether the PAT can push to owner/repo (true for repos the user owns / collaborates on). */
export async function canPushToRepo(pat: string, owner: string, repo: string): Promise<boolean> {
  const client = new Octokit({ auth: pat })
  try {
    const { data } = await client.rest.repos.get({ owner, repo })
    return Boolean(data.permissions?.push)
  } catch (err) {
    throw wrapError(err)
  }
}

/**
 * Ensure a fork of owner/repo exists under the authenticated user and is ready
 * to push to.
 *
 * Strategy (2026-05-28 hardening — surfaced when a PAT couldn't fork execa):
 *  1. REUSE an existing fork first. `repos.get({owner: me, repo})` only needs
 *     read access, so this works even with a restricted token (fine-grained
 *     PAT, or classic missing fork perms) as long as the user forked once
 *     manually. This is the escape hatch when createFork is denied.
 *  2. Otherwise createFork (needs write/admin perms). Forks are async → poll
 *     until gettable (~30s). If createFork is denied (403 "Resource not
 *     accessible by personal access token" — the classic fine-grained-PAT
 *     failure), throw a CLEAR, actionable error instead of the raw 403.
 */
export async function ensureFork(
  pat: string,
  owner: string,
  repo: string,
): Promise<{ owner: string; repo: string }> {
  const client = new Octokit({ auth: pat })

  // (0) who am I — needed to look up an existing fork under my account.
  let me: string
  try {
    me = (await client.rest.users.getAuthenticated()).data.login
  } catch (err) {
    throw wrapError(err)
  }

  // (1) reuse an existing fork (read-only — works with restricted tokens).
  try {
    const { data: existing } = await client.rest.repos.get({ owner: me, repo })
    const parent = (existing as { parent?: { full_name?: string } }).parent?.full_name
    const matchesUpstream = !parent || parent.toLowerCase() === `${owner}/${repo}`.toLowerCase()
    if (existing.fork && matchesUpstream) {
      return { owner: me, repo }
    }
    // A same-named repo exists that isn't a fork of this upstream — fall through;
    // createFork will resolve to the real fork name (or fail with a clear error).
  } catch {
    // 404 — no repo by that name under the user. Proceed to create the fork.
  }

  // (2) create the fork (needs write permission on the token).
  let forkOwner: string
  let forkRepo: string
  try {
    const { data: fork } = await client.rest.repos.createFork({ owner, repo })
    forkOwner = fork.owner.login
    forkRepo = fork.name
  } catch (err) {
    const wrapped = wrapError(err)
    if (wrapped.kind === 'auth') {
      throw new GitHubError(
        'auth',
        `Cannot fork ${owner}/${repo} — your GitHub token isn't allowed to create forks. ` +
          `Fix: use a CLASSIC personal access token with the "repo" (or "public_repo") scope ` +
          `[+ "workflow" if the repo has GitHub Actions], OR fork ${owner}/${repo} to your account ` +
          `once on github.com and re-scan (Mendel will reuse the existing fork). ` +
          `Fine-grained tokens generally cannot fork repositories owned by others.`,
      )
    }
    throw wrapped
  }

  // Poll for readiness — the new fork becomes gettable once GitHub provisions it.
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      await client.rest.repos.get({ owner: forkOwner, repo: forkRepo })
      return { owner: forkOwner, repo: forkRepo }
    } catch {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  // Final attempt — let a genuine failure throw rather than silently proceed.
  await client.rest.repos.get({ owner: forkOwner, repo: forkRepo })
  return { owner: forkOwner, repo: forkRepo }
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
