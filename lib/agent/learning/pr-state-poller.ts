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

export interface PollSummary {
  checked: number
  merged: number
  rejected: number
  stillOpen: number
  /** Issues skipped because their PR URL / PAT couldn't be resolved. */
  skipped: number
  /** Per-PR errors (network, auth, etc.) — surfaced, never swallowed silently. */
  errors: Array<{ prUrl: string; reason: string }>
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

  for (const issue of issues) {
    const prUrl = issue.prUrl as string
    const parsed = parsePrUrl(prUrl)
    if (!parsed) {
      summary.skipped++
      continue
    }

    // PAT lives encrypted on the scan. No PAT → can't query → skip honestly.
    const enc = issue.scan?.encryptedPat
    if (!enc) {
      summary.skipped++
      continue
    }
    let pat: string
    try {
      pat = decrypt(enc)
    } catch {
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

      if (outcome === 'merged') {
        await db.issue.update({ where: { id: issue.id }, data: { status: 'pr-merged' } })
        summary.merged++
        continue
      }

      // rejected — record the pattern + mark resolved.
      const depName = readDepName(issue.diagnosis)
      if (depName) {
        await recordRejection({
          depName,
          rejectionReason: buildAutoRejectionReason({ comment: result.latestComment, closedAt: result.closedAt }),
          prUrl,
        })
      }
      await db.issue.update({ where: { id: issue.id }, data: { status: 'pr-rejected' } })
      summary.rejected++
    } catch (err) {
      summary.errors.push({ prUrl, reason: err instanceof Error ? err.message : String(err) })
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
