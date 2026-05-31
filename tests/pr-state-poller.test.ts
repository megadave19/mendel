/**
 * Tests for v1.5 Workstream #10 Push 2 (a) — automated PR-state polling.
 *
 * Pure helpers (no DB / network):
 *   - parsePrUrl, classifyPrState, buildAutoRejectionReason
 *
 * Orchestration (real Prisma DB, cleaned up; GitHub call injected as a fake
 * fetcher so there's no network):
 *   - merged PR → status 'pr-merged', no rejection
 *   - closed w/ comment → verbatim rejection reason + 'pr-rejected'
 *   - closed w/o comment → labeled [auto-detected] reason + 'pr-rejected'
 *   - open PR → unchanged, counted stillOpen
 *   - resolved issues are not re-polled
 *
 * Mirrors tests/rejection-learning.test.ts: real DB + afterEach cleanup.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import {
  parsePrUrl,
  classifyPrState,
  buildAutoRejectionReason,
  pollPrStates,
  classifyPollError,
  type PrStateFetcher,
} from '@/lib/agent/learning/pr-state-poller'
import { GitHubError } from '@/lib/github/types'

const REPO_TAG = 'pr-poller-suite'
const PR_BASE = `https://github.com/test/${REPO_TAG}/pull/`

beforeAll(() => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-key-32-chars-exactly-padded!'
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
})

afterEach(async () => {
  const { db } = await import('@/lib/db')
  await db.rejectionPattern.deleteMany({ where: { prUrl: { startsWith: PR_BASE } } })
  // Issues belong to scans tagged with our repo marker; delete issues then scans.
  const scans = await db.scan.findMany({ where: { repoUrl: { contains: REPO_TAG } }, select: { id: true } })
  const ids = scans.map((s) => s.id)
  if (ids.length) {
    await db.issue.deleteMany({ where: { scanId: { in: ids } } })
    await db.scan.deleteMany({ where: { id: { in: ids } } })
  }
})

/* ─── parsePrUrl ──────────────────────────────────────────────────────────── */

describe('parsePrUrl', () => {
  it('parses a standard PR URL', () => {
    expect(parsePrUrl('https://github.com/megadave19/mendel-test/pull/42')).toEqual({
      owner: 'megadave19', repo: 'mendel-test', number: 42,
    })
  })
  it('tolerates trailing path / hash / query', () => {
    expect(parsePrUrl('https://github.com/a/b/pull/7/files')).toEqual({ owner: 'a', repo: 'b', number: 7 })
    expect(parsePrUrl('https://github.com/a/b/pull/7#issuecomment-1')).toEqual({ owner: 'a', repo: 'b', number: 7 })
  })
  it('returns null for non-PR / non-github URLs', () => {
    expect(parsePrUrl('https://github.com/a/b/issues/7')).toBeNull()
    expect(parsePrUrl('https://gitlab.com/a/b/pull/7')).toBeNull()
    expect(parsePrUrl('not a url')).toBeNull()
    expect(parsePrUrl('https://github.com/a/b/pull/0')).toBeNull()
  })
})

/* ─── classifyPrState ─────────────────────────────────────────────────────── */

describe('classifyPrState', () => {
  it('open → open regardless of merged flag', () => {
    expect(classifyPrState({ state: 'open', merged: false })).toBe('open')
  })
  it('closed + merged → merged', () => {
    expect(classifyPrState({ state: 'closed', merged: true })).toBe('merged')
  })
  it('closed + not merged → rejected', () => {
    expect(classifyPrState({ state: 'closed', merged: false })).toBe('rejected')
  })
})

/* ─── buildAutoRejectionReason ────────────────────────────────────────────── */

describe('buildAutoRejectionReason', () => {
  it('uses the verbatim comment when present', () => {
    expect(buildAutoRejectionReason({ comment: 'Breaks our SSR build', closedAt: null }))
      .toBe('Breaks our SSR build')
  })
  it('labels an auto-detected reason when no comment, including the date', () => {
    const r = buildAutoRejectionReason({ comment: null, closedAt: '2026-05-28T10:00:00Z' })
    expect(r).toContain('[auto-detected]')
    expect(r).toContain('2026-05-28')
  })
  it('falls back to labeled reason for a too-short comment (< 3 chars)', () => {
    expect(buildAutoRejectionReason({ comment: 'no', closedAt: null })).toContain('[auto-detected]')
  })
})

/* ─── orchestration ───────────────────────────────────────────────────────── */

async function seedIssue(prNumber: number, depName = 'axios'): Promise<{ scanId: string; issueId: string; prUrl: string }> {
  const { db } = await import('@/lib/db')
  const { encrypt } = await import('@/lib/crypto')
  const prUrl = `${PR_BASE}${prNumber}`
  const scan = await db.scan.create({
    data: {
      repoUrl: `https://github.com/test/${REPO_TAG}`,
      status: 'completed',
      schemaVersion: '1.5',
      encryptedPat: encrypt('ghp_faketokenforpollertest'),
    },
  })
  const issue = await db.issue.create({
    data: {
      scanId: scan.id,
      type: 'stale-dependency',
      severity: 'major',
      confidence: JSON.stringify({ level: 'medium' }),
      diagnosis: JSON.stringify({ dep: depName, currentVersion: '0.1.0', latestVersion: '1.0.0', what: '', why: '', evidence: [] }),
      notAnalyzed: JSON.stringify([]),
      prUrl,
      status: 'pr-opened',
    },
  })
  return { scanId: scan.id, issueId: issue.id, prUrl }
}

describe('pollPrStates orchestration (fake fetcher + real DB)', () => {
  it('marks a merged PR as pr-merged and records no rejection', async () => {
    const { db } = await import('@/lib/db')
    const { scanId, issueId } = await seedIssue(101)

    const fetcher: PrStateFetcher = async () => ({ state: 'closed', merged: true, mergedAt: '2026-05-28T00:00:00Z', closedAt: '2026-05-28T00:00:00Z', latestComment: null })
    const summary = await pollPrStates({ scanId, fetcher })

    expect(summary.merged).toBe(1)
    expect(summary.rejected).toBe(0)
    const issue = await db.issue.findUnique({ where: { id: issueId } })
    expect(issue?.status).toBe('pr-merged')
    const rejections = await db.rejectionPattern.count({ where: { prUrl: { startsWith: PR_BASE } } })
    expect(rejections).toBe(0)
  })

  it('records a verbatim rejection for a closed-with-comment PR and marks pr-rejected', async () => {
    const { db } = await import('@/lib/db')
    const { scanId, issueId, prUrl } = await seedIssue(102, 'left-pad')

    const fetcher: PrStateFetcher = async () => ({ state: 'closed', merged: false, mergedAt: null, closedAt: '2026-05-28T00:00:00Z', latestComment: 'We are not upgrading this, breaks IE11.' })
    const summary = await pollPrStates({ scanId, fetcher })

    expect(summary.rejected).toBe(1)
    const issue = await db.issue.findUnique({ where: { id: issueId } })
    expect(issue?.status).toBe('pr-rejected')
    const rec = await db.rejectionPattern.findFirst({ where: { prUrl } })
    expect(rec?.depName).toBe('left-pad')
    expect(rec?.rejectionReason).toBe('We are not upgrading this, breaks IE11.')
  })

  it('records a labeled auto-detected reason when a closed PR has no comment', async () => {
    const { db } = await import('@/lib/db')
    const { scanId, prUrl } = await seedIssue(103)

    const fetcher: PrStateFetcher = async () => ({ state: 'closed', merged: false, mergedAt: null, closedAt: '2026-05-28T00:00:00Z', latestComment: null })
    await pollPrStates({ scanId, fetcher })

    const rec = await db.rejectionPattern.findFirst({ where: { prUrl } })
    expect(rec?.rejectionReason).toContain('[auto-detected]')
  })

  it('leaves an open PR untouched and counts it stillOpen', async () => {
    const { db } = await import('@/lib/db')
    const { scanId, issueId } = await seedIssue(104)

    const fetcher: PrStateFetcher = async () => ({ state: 'open', merged: false, mergedAt: null, closedAt: null, latestComment: null })
    const summary = await pollPrStates({ scanId, fetcher })

    expect(summary.stillOpen).toBe(1)
    const issue = await db.issue.findUnique({ where: { id: issueId } })
    expect(issue?.status).toBe('pr-opened')
  })

  it('does not re-poll an already-resolved issue', async () => {
    const { db } = await import('@/lib/db')
    const { scanId, issueId } = await seedIssue(105)
    // Resolve it first.
    await db.issue.update({ where: { id: issueId }, data: { status: 'pr-merged' } })

    let called = false
    const fetcher: PrStateFetcher = async () => { called = true; return { state: 'open', merged: false, mergedAt: null, closedAt: null, latestComment: null } }
    const summary = await pollPrStates({ scanId, fetcher })

    expect(called).toBe(false)
    expect(summary.checked).toBe(0)
  })

  // ─── v2.0: dedup + honest error classification ─────────────────────────────

  it('dedups multiple Issue rows pointing to the SAME PR URL — fetcher called once, all rows resolve together', async () => {
    // Reproduces the megadave19/mendel-test case: 3 scans of the same repo
    // → 3 Issue rows → 3 calls to fetcher → 3 "errors" for ONE deleted PR.
    const { db } = await import('@/lib/db')
    const { scanId: sA, issueId: iA, prUrl } = await seedIssue(200)
    const { issueId: iB } = await seedIssue(200) // SAME PR number → SAME url
    const { issueId: iC } = await seedIssue(200)
    expect(iA).not.toBe(iB)

    let calls = 0
    const fetcher: PrStateFetcher = async () => {
      calls++
      return { state: 'closed', merged: true, mergedAt: '2026-05-30T00:00:00Z', closedAt: '2026-05-30T00:00:00Z', latestComment: null }
    }
    const summary = await pollPrStates({ fetcher })

    expect(calls).toBe(1) // one network call for one unique URL
    expect(summary.checked).toBe(1)
    expect(summary.merged).toBe(1)
    // ALL THREE Issue rows pointing to the merged URL flip together.
    const rows = await db.issue.findMany({ where: { prUrl } })
    expect(rows.every((r) => r.status === 'pr-merged')).toBe(true)
    // Sanity: the scanId-scoped seed used three different scans.
    void sA
    void iC
  })

  it('classifies a 404 (repo deleted) as kind=not-found — NOT misleading "network/auth"', async () => {
    await seedIssue(201)
    const fetcher: PrStateFetcher = async () => {
      throw new GitHubError('not-found', 'Not Found')
    }
    const summary = await pollPrStates({ fetcher })

    expect(summary.errors).toHaveLength(1)
    expect(summary.errors[0].kind).toBe('not-found')
    expect(summary.checked).toBe(0)
  })

  it('classifies a 403 / blocked-account as kind=auth (the execa-blocked case)', async () => {
    await seedIssue(202)
    const fetcher: PrStateFetcher = async () => {
      throw new GitHubError('auth', 'User is blocked')
    }
    const summary = await pollPrStates({ fetcher })

    expect(summary.errors[0].kind).toBe('auth')
  })

  it("classifyPollError maps an unknown thrown value to 'unknown' (never throws itself)", () => {
    expect(classifyPollError(new Error('boom'))).toBe('unknown')
    expect(classifyPollError(undefined)).toBe('unknown')
    expect(classifyPollError(new GitHubError('rate-limit', 'slow down'))).toBe('rate-limit')
  })
})
