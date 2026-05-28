/**
 * Unit + integration tests for v1.5 Workstream #10 — Rejection-Learning Loop.
 *
 * Covers:
 *   - recordRejection: input validation (schema), persistence, dedup on prUrl
 *   - recallRejectionPatterns: empty input, depName-only, depName+changeType
 *     priority, limit cap
 *   - formatPatternsForPrompt: empty case, formatted output structure
 *
 * Uses the real Prisma DB but cleans up its own rows via afterEach.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { recordRejection, RecordRejectionSchema } from '@/lib/agent/learning/rejection-recorder'
import {
  recallRejectionPatterns,
  formatPatternsForPrompt,
  type RecalledPattern,
} from '@/lib/agent/learning/rejection-recall'

const TEST_PR_PREFIX = 'https://github.com/test/rejection-learning-suite/pull/'

beforeAll(() => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-key-32-chars-exactly-padded!'
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
})

afterEach(async () => {
  const { db } = await import('@/lib/db')
  // Clean every row this suite touched (prUrl starts with the test prefix).
  await db.rejectionPattern.deleteMany({
    where: { prUrl: { startsWith: TEST_PR_PREFIX } },
  })
})

/* ─── Schema validation ───────────────────────────────────────────────────── */

describe('RecordRejectionSchema validation', () => {
  it('accepts a valid input', () => {
    const parsed = RecordRejectionSchema.safeParse({
      depName: 'axios',
      changeType: 'removed',
      rejectionReason: 'breaks our auth flow',
      prUrl: TEST_PR_PREFIX + '1',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an empty rejectionReason', () => {
    const parsed = RecordRejectionSchema.safeParse({
      depName: 'axios',
      rejectionReason: '',
      prUrl: TEST_PR_PREFIX + '1',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a non-GitHub prUrl', () => {
    const parsed = RecordRejectionSchema.safeParse({
      depName: 'axios',
      rejectionReason: 'bad PR',
      prUrl: 'https://gitlab.com/x/y/-/merge_requests/1',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown changeType', () => {
    const parsed = RecordRejectionSchema.safeParse({
      depName: 'axios',
      changeType: 'something-else',
      rejectionReason: 'whatever',
      prUrl: TEST_PR_PREFIX + '1',
    })
    expect(parsed.success).toBe(false)
  })

  it('changeType is optional', () => {
    const parsed = RecordRejectionSchema.safeParse({
      depName: 'axios',
      rejectionReason: 'no type known',
      prUrl: TEST_PR_PREFIX + '1',
    })
    expect(parsed.success).toBe(true)
  })
})

/* ─── recordRejection: persist + dedup ────────────────────────────────────── */

describe('recordRejection', () => {
  it('creates a new row when prUrl is new', async () => {
    const result = await recordRejection({
      depName: 'axios',
      changeType: 'removed',
      rejectionReason: 'broke caller code',
      prUrl: TEST_PR_PREFIX + 'create-1',
    })
    expect(result.created).toBe(true)
    expect(result.id).toBeTruthy()
  })

  it('updates in place when the same prUrl is recorded again', async () => {
    const a = await recordRejection({
      depName: 'axios',
      changeType: 'removed',
      rejectionReason: 'original reason',
      prUrl: TEST_PR_PREFIX + 'dedup-1',
    })
    const b = await recordRejection({
      depName: 'axios',
      changeType: 'signature-changed',
      rejectionReason: 'updated reason — was wrong before',
      prUrl: TEST_PR_PREFIX + 'dedup-1',
    })
    expect(a.created).toBe(true)
    expect(b.created).toBe(false)
    expect(b.id).toBe(a.id)
    // verify the row was actually updated
    const patterns = await recallRejectionPatterns('axios')
    const found = patterns.find((p) => p.prUrl === TEST_PR_PREFIX + 'dedup-1')
    expect(found?.rejectionReason).toBe('updated reason — was wrong before')
    expect(found?.changeType).toBe('signature-changed')
  })
})

/* ─── recallRejectionPatterns: query semantics ────────────────────────────── */

describe('recallRejectionPatterns', () => {
  it('returns empty array when no patterns exist for the dep', async () => {
    const patterns = await recallRejectionPatterns('never-recorded-pkg')
    expect(patterns).toEqual([])
  })

  it('returns empty array when depName is empty', async () => {
    const patterns = await recallRejectionPatterns('')
    expect(patterns).toEqual([])
  })

  it('returns empty array when limit is 0', async () => {
    await recordRejection({
      depName: 'axios', changeType: 'removed',
      rejectionReason: 'reason-for-limit-0-test',
      prUrl: TEST_PR_PREFIX + 'limit-0',
    })
    const patterns = await recallRejectionPatterns('axios', { limit: 0 })
    expect(patterns).toEqual([])
  })

  it('returns depName matches when no changeType supplied', async () => {
    await recordRejection({
      depName: 'react', changeType: 'removed',
      rejectionReason: 'reason-one', prUrl: TEST_PR_PREFIX + 'react-1',
    })
    await recordRejection({
      depName: 'react', changeType: 'signature-changed',
      rejectionReason: 'reason-two', prUrl: TEST_PR_PREFIX + 'react-2',
    })
    const patterns = await recallRejectionPatterns('react')
    expect(patterns.length).toBe(2)
    expect(patterns.every((p) => p.depName === 'react')).toBe(true)
  })

  it('prioritizes exact (depName, changeType) match, then fills with depName-only', async () => {
    await recordRejection({
      depName: 'lodash', changeType: 'removed',
      rejectionReason: 'reason-A', prUrl: TEST_PR_PREFIX + 'lodash-removed',
    })
    await recordRejection({
      depName: 'lodash', changeType: 'signature-changed',
      rejectionReason: 'reason-B', prUrl: TEST_PR_PREFIX + 'lodash-sig',
    })
    await recordRejection({
      depName: 'lodash', changeType: 'behavior-changed',
      rejectionReason: 'reason-C', prUrl: TEST_PR_PREFIX + 'lodash-behavior',
    })
    const patterns = await recallRejectionPatterns('lodash', { changeType: 'removed' })
    // First should be the exact 'removed' match
    expect(patterns[0]?.changeType).toBe('removed')
    expect(patterns[0]?.rejectionReason).toBe('reason-A')
    // The rest should be other matches for the same dep
    expect(patterns.length).toBe(3)
    expect(patterns.map((p) => p.changeType).sort()).toEqual(['behavior-changed', 'removed', 'signature-changed'])
  })

  it('respects limit cap', async () => {
    for (let i = 0; i < 8; i++) {
      await recordRejection({
        depName: 'limited-pkg',
        rejectionReason: `reason-${i}-padded`,
        prUrl: TEST_PR_PREFIX + `limited-${i}`,
      })
    }
    const patterns = await recallRejectionPatterns('limited-pkg', { limit: 3 })
    expect(patterns.length).toBe(3)
  })

  it('orders by createdAt descending (most recent first)', async () => {
    const first = await recordRejection({
      depName: 'order-pkg',
      rejectionReason: 'older',
      prUrl: TEST_PR_PREFIX + 'order-older',
    })
    // Small delay so timestamps differ
    await new Promise((r) => setTimeout(r, 25))
    const second = await recordRejection({
      depName: 'order-pkg',
      rejectionReason: 'newer',
      prUrl: TEST_PR_PREFIX + 'order-newer',
    })
    const patterns = await recallRejectionPatterns('order-pkg')
    expect(patterns[0].id).toBe(second.id)
    expect(patterns[1].id).toBe(first.id)
  })
})

/* ─── formatPatternsForPrompt: structure for the LLM ──────────────────────── */

describe('formatPatternsForPrompt', () => {
  it('returns empty string for no patterns (so the diagnose prompt can skip the section)', () => {
    expect(formatPatternsForPrompt([])).toBe('')
  })

  it('produces a numbered list with date, dep, type, reason, PR URL', () => {
    const p: RecalledPattern = {
      id: 'x',
      depName: 'axios',
      changeType: 'removed',
      rejectionReason: 'broke our auth flow',
      prUrl: 'https://github.com/test/x/pull/1',
      createdAt: new Date('2026-05-27T12:00:00Z'),
    }
    const out = formatPatternsForPrompt([p])
    expect(out).toContain('Previously rejected fixes')
    expect(out).toContain('1.')
    expect(out).toContain('2026-05-27')
    expect(out).toContain('axios')
    expect(out).toContain('(removed)')
    expect(out).toContain('broke our auth flow')
    expect(out).toContain('https://github.com/test/x/pull/1')
    expect(out).toContain('Avoid repeating')
  })

  it('handles null depName + null changeType safely', () => {
    const p: RecalledPattern = {
      id: 'x',
      depName: null,
      changeType: null,
      rejectionReason: 'whatever',
      prUrl: 'https://github.com/test/x/pull/2',
      createdAt: new Date('2026-05-27T12:00:00Z'),
    }
    const out = formatPatternsForPrompt([p])
    expect(out).toContain('(unknown dep)')
    // No parens-with-empty-changetype noise
    expect(out).not.toContain('()')
  })
})
