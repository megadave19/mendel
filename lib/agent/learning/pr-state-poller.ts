/**
 * v1.5 Workstream #10 Push 2 (a) / PRD F16 — automated GitHub PR-state polling.
 *
 * Push 1 shipped the rejection-learning loop but only fed by a MANUAL "Mark as
 * rejected" button. That misses the common case: a maintainer just closes the
 * PR on GitHub without ever touching Mendel. This module closes that gap by
 * polling the real state of every Mendel-opened PR and reacting automatically:
 *
 *   - merged                → Issue.status = 'pr-merged'  (accepted; positive)
 *   - closed without merge  → record a RejectionPattern + Issue.status = 'pr-rejected'
 *   - still open            → no change (re-polled next time)
 *
 * Once an issue resolves to merged/rejected we stop polling it (the status
 * filter excludes resolved issues), so this is safe to call repeatedly — from
 * a dashboard button now, or a cron later.
 *
 * Testability: the GitHub call is injected (`PrStateFetcher`) so the
 * orchestration logic is unit-tested with a fake fetcher + the real DB, no
 * network. Production uses the default fetcher backed by lib/github.
 *
 * §5b honesty:
 *   - When a closed PR has a human comment, that verbatim text is the reason.
 *   - When it doesn't, we store a clearly-labeled "[auto-detected]" reason —
 *     never a fabricated human-sounding justification.
 *   - changeType is best-effort (often unknown from persisted data) and left
 *     undefined rather than guessed.
 */

import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { GitHubError } from '@/lib/github/types'
import {
  getPullRequestState,
  getLatestPullRequestComment,
} from '@/lib/github'
import { recordRejection } from './rejection-recorder'

/* ─── PURE helpers (no DB, no network) ────────────────────────────────────── */

export interface ParsedPrUrl {
  owner: string
  repo: string
  number: number
}

const PR_URL_RE = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/#?].*)?$/

/**
 * Parse a GitHub PR URL into { owner, repo, number }. Returns null for
 * anything that isn't a github.com pull URL — the caller skips it rather
 * than throwing (one bad row must not abort the whole poll).
 */
export function parsePrUrl(url: string): ParsedPrUrl | null {
  const m = url.trim().match(PR_URL_RE)
  if (!m) return null
  const number = Number(m[3])
  if (!Number.isInteger(number) || number <= 0) return null
  return { owner: m[1], repo: m[2], number }
}

export type PrOutcome = 'merged' | 'rejected' | 'open'

/** Classify a PR's GitHub state into the outcome the learning loop cares about. */
export function classifyPrState(state: { state: 'open' | 'closed'; merged: boolean }): PrOutcome {
  if (state.state === 'open') return 'open'
  return state.merged ? 'merged' : 'rejected'
}

/**
 * Build the rejection reason for an auto-detected close. Prefers the verbatim
 * last comment; otherwise a clearly-labeled synthetic reason (≥ 3 chars to
 * satisfy RecordRejectionSchema). Never fabricates a human justification.
 */
export function buildAutoRejectionReason(opts: { comment?: string | null; closedAt?: string | null }): string {
  const comment = (opts.comment ?? '').trim()
  if (comment.length >= 3) return comment.slice(0, 2000)
  const when = opts.closedAt ? ` on ${opts.closedAt.slice(0, 10)}` : ''
  return `[auto-detected] PR was closed without merging${when}. No explicit reason was left on the PR.`
}

/* ─── Orchestrator ────────────────────────────────────────────────────────── */

export interface PrStateFetcherResult {
  state: 'open' | 'closed'
  merged: boolean
  mergedAt: string | null
  closedAt: string | null
  /** Latest comment body — fetched only when closed-without-merge. */
  latestComment: string | null
}

export type PrStateFetcher = (
  pat: string,
  owner: string,
  repo: string,
  prNumber: number,
) => Promise<PrStateFetcherResult>

/** Default fetcher: real GitHub. Only fetches the comment when it'll be used. */
const defaultFetcher: PrStateFetcher = async (pat, owner, repo, prNumber) => {
  const s = await getPullRequestState(pat, owner, repo, prNumber)
  const rejected = s.state === 'closed' && !s.merged
  const latestComment = rejected
    ? await getLatestPullRequestComment(pat, owner, repo, prNumber)
    : null
  return { ...s, latestComment }
}

/**
 * v2.0 — Honest classification of a per-PR poll failure. Surfaced in the
 * dashboard toast so the user sees the REAL reason (e.g. "repo deleted")
 * instead of a one-size-fits-all "network/auth" string.
 *
 * Sourced from the underlying GitHubError.kind on the thrown error, mapped
 * to a user-readable bucket. CLAUDE.md §5b: never lie about the cause of a
 * failure.
 */
export type PollErrorKind =
  | 'not-found'   // 404 — PR or repo no longer exists / was deleted
  | 'auth'        // 401/403 — PAT rejected, scope insufficient, account blocked
  | 'rate-limit'  // 429 — GitHub rate-limited the poll
  | 'network'     // genuine network / DNS failure
  | 'unknown'

export interface PollSummary {
  checked: number
  merged: number
  rejected: number
  stillOpen: number
  /** Issues skipped because their PR URL / PAT couldn't be resolved. */
  skipped: number
  /**
   * Per-PR errors — surfaced, never swallowed silently. Each entry corresponds
   * to one UNIQUE PR URL (the poller dedups before counting), so this count
   * matches what a human would call "broken PRs", not the raw Issue-row count.
   */
  errors: Array<{ prUrl: string; reason: string; kind: PollErrorKind }>
}

/**
 * Pure mapping from a thrown poll error → a PollErrorKind. The underlying
 * GitHubError already carries a precise `kind` (auth/rate-limit/not-found/
 * network/validation/unknown); we just narrow it to the poll vocabulary.
 * Exported so tests + future MCP/CLI surfaces can reuse it.
 */
export function classifyPollError(err: unknown): PollErrorKind {
  if (err instanceof GitHubError) {
    switch (err.kind) {
      case 'not-found':   return 'not-found'
      case 'auth':        return 'auth'
      case 'rate-limit':  return 'rate-limit'
      case 'network':     return 'network'
      default:            return 'unknown'
    }
  }
  return 'unknown'
}

export interface PollOptions {
  /** Restrict to one scan's issues (dashboard per-scan sync). */
  scanId?: string
  /** Injected for tests; defaults to the real GitHub-backed fetcher. */
  fetcher?: PrStateFetcher
}

/**
 * Poll GitHub for every unresolved Mendel-opened PR and react to merge/close
 * transitions. Returns a summary; per-PR errors are collected, not thrown, so
 * one failing PR never aborts the rest.
 */
export async function pollPrStates(opts: PollOptions = {}): Promise<PollSummary> {
  const fetcher = opts.fetcher ?? defaultFetcher
  const summary: PollSummary = { checked: 0, merged: 0, rejected: 0, stillOpen: 0, skipped: 0, errors: [] }

  // Only issues with an open PR we haven't resolved yet. include scan for PAT.
  const issues = await db.issue.findMany({
    where: {
      status: 'pr-opened',
      prUrl: { not: null },
      ...(opts.scanId ? { scanId: opts.scanId } : {}),
    },
    include: { scan: { select: { encryptedPat: true } } },
  })

  // v2.0 — DEDUP by prUrl. Re-scanning the same repo creates multiple Issue
  // rows pointing to the same PR (one per scan). Without dedup the poller (a)
  // counts 3 failures for ONE deleted repo and (b) hammers GitHub redundantly.
  // We group rows by prUrl, poll each URL ONCE, then apply the outcome to
  // every Issue row pointing to it. Skipped/error counts now reflect unique
  // PRs — matching what a human would call "broken PRs."
  const byUrl = new Map<string, typeof issues>()
  for (const issue of issues) {
    const url = issue.prUrl as string
    const bucket = byUrl.get(url)
    if (bucket) bucket.push(issue)
    else byUrl.set(url, [issue])
  }

  for (const [prUrl, rows] of byUrl) {
    const parsed = parsePrUrl(prUrl)
    if (!parsed) {
      summary.skipped++
      continue
    }

    // Pick the first row with a usable encryptedPat (different scans of the
    // same repo may have rotated PATs; the freshest-decryptable wins).
    let pat: string | null = null
    for (const row of rows) {
      const enc = row.scan?.encryptedPat
      if (!enc) continue
      try { pat = decrypt(enc); break } catch { /* try next */ }
    }
    if (!pat) {
      summary.skipped++
      continue
    }

    try {
      const result = await fetcher(pat, parsed.owner, parsed.repo, parsed.number)
      summary.checked++
      const outcome = classifyPrState(result)

      if (outcome === 'open') {
        summary.stillOpen++
        continue
      }

      // Apply the resolution to EVERY row pointing to this URL so a re-scan's
      // duplicate Issue rows resolve together.
      const ids = rows.map((r) => r.id)

      if (outcome === 'merged') {
        await db.issue.updateMany({ where: { id: { in: ids } }, data: { status: 'pr-merged' } })
        summary.merged++
        continue
      }

      // rejected — record the pattern once (depName comes from any row),
      // then resolve every duplicate.
      const depName = readDepName(rows[0].diagnosis)
      if (depName) {
        await recordRejection({
          depName,
          rejectionReason: buildAutoRejectionReason({ comment: result.latestComment, closedAt: result.closedAt }),
          prUrl,
        })
      }
      await db.issue.updateMany({ where: { id: { in: ids } }, data: { status: 'pr-rejected' } })
      summary.rejected++
    } catch (err) {
      // §5b honest classification — surface the REAL kind instead of a
      // misleading "network/auth" catch-all. The dashboard toast reads this
      // to tell the user "1 deleted, 2 auth-blocked" vs. one bucket count.
      const kind = classifyPollError(err)
      const reason = err instanceof Error ? err.message : String(err)
      summary.errors.push({ prUrl, reason, kind })
    }
  }

  return summary
}

/** Pull depName from the persisted diagnosis blob ({ dep: string, ... }). */
function readDepName(diagnosisJson: string): string | null {
  try {
    const obj = JSON.parse(diagnosisJson) as { dep?: unknown }
    return typeof obj.dep === 'string' && obj.dep.length > 0 ? obj.dep : null
  } catch {
    return null
  }
}
