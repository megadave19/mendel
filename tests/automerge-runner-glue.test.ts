/**
 * v2.3 / F24 sub-phase 2 — runner-glue tests.
 *
 * The pure policy tests live in tests/automerge-policy.test.ts. This file
 * tests the IO/orchestration layer:
 *   - input gathering from a fake Prisma
 *   - persistence of AgentLog rows + Issue.autoMerge blob
 *   - dwell window respects the RepoSetting's autoMergeDwellSeconds
 *   - GitHub merge wrapper called with the right shape
 *   - skip vs merged vs failed outcome shapes are written verbatim
 *   - the signal-agreement + bump-classification helpers
 *
 * Fakes everywhere: no real DB, no real network, no real clock. Tests
 * that touch real Octokit live in tests/submit-capability.test.ts; the
 * §11b.1 Docker-class tests live elsewhere — auto-merge is pure
 * orchestration so a unit-level fake suffices.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  runAutoMergeFor,
  countSemanticDiffBreakingChanges,
  computeSignalsAgree,
  classifyVersionBump,
  parseRepoFullName,
  clampDwell,
  type AutoMergeContext,
  type AutoMergePrisma,
  type AutoMergeIO,
  type AutoMergeOutcome,
} from '@/lib/agent/automerge/runner-glue'
import type { BreakingChange } from '@/lib/agent/signals/changelog'
import type { SemanticDiff } from '@/lib/agent/signals/semantic-diff'
import type { ConfidenceScore } from '@/lib/agent/confidence/score'

// ── Fake builders ─────────────────────────────────────────────────────────────

function makeConfidence(overall: number, bucket: 'high' | 'medium' | 'low' = 'high'): ConfidenceScore {
  return {
    overall,
    bucket,
    perBreakingChange: [],
    perPatchedFile: [],
    analysisCoverage: { symbolsAnalyzed: 10, symbolsTotal: 10, percentCovered: 100, analysisTier: 'dts', notAnalyzed: [] },
    verificationCapped: false,
    smokeCapped: false,
  }
}

function makeContext(overrides: Partial<AutoMergeContext> = {}): AutoMergeContext {
  return {
    scanId: 'scan-1',
    issueId: 'issue-1',
    repoFullName: 'megadave19/mendel-test',
    prNumber: 42,
    prUrl: 'https://github.com/megadave19/mendel-test/pull/42',
    depName: 'axios',
    depChangeType: 'patch',
    fromVersion: '1.6.0',
    toVersion: '1.6.1',
    breakingChanges: [],
    semanticDiff: makeSemanticDiff(),
    confidence: makeConfidence(95),
    verificationPassed: true,
    smokePassed: true,
    threshold: 70,
    patHasMergeRights: true,
    ...overrides,
  }
}

function makeSemanticDiff(overrides: Partial<SemanticDiff> = {}): SemanticDiff {
  return {
    removedExports: [],
    signatureChanges: [],
    newDeprecations: [],
    affectedSitesInRepo: [],
    coveragePercent: 100,
    unanalyzableSymbols: [],
    analysisTier: 'dts',
    ...overrides,
  }
}

interface FakeRecord {
  table: string
  data: Record<string, unknown>
}

function makePrisma(initial: {
  setting?: { autoMergeEnabled: boolean; autoMergeConfidenceFloor: number; autoMergeDwellSeconds: number } | null
  rejection?: { id: string } | null
}): { db: AutoMergePrisma; writes: FakeRecord[] } {
  const writes: FakeRecord[] = []
  const db = {
    repoSetting: {
      findUnique: vi.fn(async () => initial.setting ?? null),
    },
    rejectionPattern: {
      findFirst: vi.fn(async () => initial.rejection ?? null),
    },
    agentLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        writes.push({ table: 'agentLog', data })
        return data
      }),
    },
    issue: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        writes.push({ table: 'issue.update', data })
        return data
      }),
    },
  } as unknown as AutoMergePrisma
  return { db, writes }
}

function makeIO(opts: { mergeOk?: boolean; mergeSha?: string; mergeReason?: string } = {}): {
  io: AutoMergeIO
  sleepCalls: number[]
  mergeCalls: number
} {
  const sleepCalls: number[] = []
  let mergeCalls = 0
  return {
    sleepCalls,
    get mergeCalls() {
      return mergeCalls
    },
    io: {
      sleep: async (ms: number) => {
        sleepCalls.push(ms)
      },
      merge: vi.fn(async () => {
        mergeCalls++
        if (opts.mergeOk === false) {
          return { ok: false, reason: opts.mergeReason ?? 'PR not mergeable', status: 405 }
        }
        return { ok: true, sha: opts.mergeSha ?? 'abc123' }
      }) as unknown as AutoMergeIO['merge'],
      now: () => new Date('2026-06-01T12:00:00Z'),
    },
  }
}

// ── runAutoMergeFor: skip case (policy says NO) ──────────────────────────────

describe('runAutoMergeFor — skip case', () => {
  it("writes an automerge.verdict log + skipped outcome when policy says NO (default-OFF setting)", async () => {
    // No setting row → §5c r1 blocks. The terminal outcome is 'skipped'
    // with the policy's reasons. Critically: NO dwell, NO merge call.
    const { db, writes } = makePrisma({ setting: null })
    const harness = makeIO()
    const result = await runAutoMergeFor(makeContext(), db, 'fake-pat', harness.io)
    expect(result.verdict.shouldMerge).toBe(false)
    expect(result.outcome.verdict).toBe('skipped')

    // Anti-gaming: even the skipped case logs to AgentLog.
    const verdictLog = writes.find((w) => w.table === 'agentLog' && (w.data.kind as string) === 'automerge.verdict')
    expect(verdictLog).toBeTruthy()

    // No dwell row, no merge call.
    expect(writes.find((w) => (w.data.kind as string) === 'automerge.dwell')).toBeFalsy()
    expect(harness.mergeCalls).toBe(0)
    expect(harness.sleepCalls).toEqual([])

    // Issue.autoMerge blob persisted.
    const issueWrite = writes.find((w) => w.table === 'issue.update')
    expect(issueWrite).toBeTruthy()
    const outcome = JSON.parse((issueWrite!.data as { autoMerge: string }).autoMerge) as AutoMergeOutcome
    expect(outcome.verdict).toBe('skipped')
    expect(outcome.reasons.some((r) => r.includes('§5c r1'))).toBe(true)
  })

  it("returns ALL §5c reasons when multiple rules fail (no first-match short-circuit at the IO layer)", async () => {
    // Two violations at once: setting OFF + smoke=null (F20 not run).
    // The policy returns both; the glue must preserve both.
    const { db, writes } = makePrisma({ setting: null })
    const harness = makeIO()
    const result = await runAutoMergeFor(makeContext({ smokePassed: null }), db, 'fake-pat', harness.io)
    expect(result.outcome.reasons.some((r) => r.includes('§5c r1'))).toBe(true)
    expect(result.outcome.reasons.some((r) => r.includes('§5c r4'))).toBe(true)
    expect(writes.find((w) => (w.data.kind as string) === 'automerge.verdict')).toBeTruthy()
  })
})

// ── runAutoMergeFor: merge case (policy says YES) ────────────────────────────

describe('runAutoMergeFor — merge case', () => {
  it("runs dwell window then calls merge + writes merged outcome on success", async () => {
    const { db, writes } = makePrisma({
      setting: { autoMergeEnabled: true, autoMergeConfidenceFloor: 90, autoMergeDwellSeconds: 30 },
    })
    const harness = makeIO({ mergeOk: true, mergeSha: 'sha-merged-42' })
    const result = await runAutoMergeFor(makeContext(), db, 'fake-pat', harness.io)

    expect(result.verdict.shouldMerge).toBe(true)
    expect(result.outcome.verdict).toBe('merged')
    expect((result.outcome as { mergedCommitSha: string }).mergedCommitSha).toBe('sha-merged-42')

    // Dwell respected the configured 30s.
    expect(harness.sleepCalls).toEqual([30_000])
    // Merge called exactly once.
    expect(harness.mergeCalls).toBe(1)

    // Logs in order: verdict → dwell started → dwell completed → merge.
    const kinds = writes
      .filter((w) => w.table === 'agentLog')
      .map((w) => w.data.kind as string)
    expect(kinds).toEqual([
      'automerge.verdict',
      'automerge.dwell',
      'automerge.dwell',
      'automerge.merge',
    ])

    // Issue.autoMerge persisted with merged outcome.
    const issueWrite = writes.find((w) => w.table === 'issue.update')!
    const outcome = JSON.parse((issueWrite.data as { autoMerge: string }).autoMerge) as AutoMergeOutcome
    expect(outcome.verdict).toBe('merged')
    expect(outcome.mergedCommitSha).toBe('sha-merged-42')
  })

  it("writes 'failed' outcome when the GitHub merge call returns ok=false", async () => {
    const { db, writes } = makePrisma({
      setting: { autoMergeEnabled: true, autoMergeConfidenceFloor: 90, autoMergeDwellSeconds: 5 },
    })
    const harness = makeIO({ mergeOk: false, mergeReason: 'Pull request is not mergeable' })
    const result = await runAutoMergeFor(makeContext(), db, 'fake-pat', harness.io)
    expect(result.outcome.verdict).toBe('failed')
    expect(result.outcome.reasons[0]).toMatch(/not mergeable/)
    expect(result.outcome.reasons[0]).toMatch(/HTTP 405/)

    // automerge.merge log carries ok=false + reason.
    const mergeLog = writes.find((w) => (w.data.kind as string) === 'automerge.merge')!
    const payload = JSON.parse(mergeLog.data.payload as string) as { ok: boolean; reason: string }
    expect(payload.ok).toBe(false)
    expect(payload.reason).toMatch(/not mergeable/)
  })

  it("clamps a 99,999s dwell down to 24h (defensive)", async () => {
    const { db } = makePrisma({
      setting: { autoMergeEnabled: true, autoMergeConfidenceFloor: 90, autoMergeDwellSeconds: 99_999 },
    })
    const harness = makeIO({ mergeOk: true })
    await runAutoMergeFor(makeContext(), db, 'fake-pat', harness.io)
    expect(harness.sleepCalls).toEqual([86_400_000])
  })
})

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe('computeSignalsAgree', () => {
  it('returns true when both signals are empty (nothing to disagree on)', () => {
    expect(computeSignalsAgree([], makeSemanticDiff())).toBe(true)
  })

  it('returns false when changelog flags symbols but semantic-diff is silent', () => {
    const cl: BreakingChange[] = [{ symbol: 'foo', changeType: 'removed', description: '', sourceUrl: '' }]
    expect(computeSignalsAgree(cl, makeSemanticDiff())).toBe(false)
  })

  it('returns false when semantic-diff flags symbols but changelog is silent', () => {
    expect(computeSignalsAgree([], makeSemanticDiff({ removedExports: ['foo'] }))).toBe(false)
  })

  it('returns true when both flag the SAME symbol set', () => {
    const cl: BreakingChange[] = [{ symbol: 'foo', changeType: 'removed', description: '', sourceUrl: '' }]
    expect(computeSignalsAgree(cl, makeSemanticDiff({ removedExports: ['foo'] }))).toBe(true)
  })

  it('returns false when both non-empty but symbol sets differ', () => {
    const cl: BreakingChange[] = [{ symbol: 'foo', changeType: 'removed', description: '', sourceUrl: '' }]
    expect(computeSignalsAgree(cl, makeSemanticDiff({ removedExports: ['bar'] }))).toBe(false)
  })

  it('returns false when semantic-diff is null (signal did not run)', () => {
    expect(computeSignalsAgree([], null)).toBe(false)
  })
})

describe('countSemanticDiffBreakingChanges', () => {
  it('counts removed exports + signature changes (deprecations excluded)', () => {
    const sd = makeSemanticDiff({
      removedExports: ['a', 'b'],
      signatureChanges: [{ symbol: 'c', before: '', after: '' }],
      newDeprecations: ['d', 'e'],
    })
    expect(countSemanticDiffBreakingChanges(sd)).toBe(3)
  })
})

describe('parseRepoFullName', () => {
  it('parses "owner/name"', () => {
    expect(parseRepoFullName('megadave19/mendel-test')).toEqual({ owner: 'megadave19', repo: 'mendel-test' })
  })

  it('throws on malformed input', () => {
    expect(() => parseRepoFullName('no-slash')).toThrow(/owner\/name/)
    expect(() => parseRepoFullName('')).toThrow(/owner\/name/)
  })
})

describe('clampDwell', () => {
  it('clamps negatives to 0', () => {
    expect(clampDwell(-1)).toBe(0)
  })

  it('clamps above 24h to 24h', () => {
    expect(clampDwell(100_000)).toBe(86_400)
  })

  it('passes through sensible values', () => {
    expect(clampDwell(60)).toBe(60)
  })

  it('handles NaN/Infinity defensively', () => {
    expect(clampDwell(NaN)).toBe(0)
    expect(clampDwell(Infinity)).toBe(86_400)
  })
})

describe('classifyVersionBump (re-exported)', () => {
  // The full classifier is covered exhaustively in automerge-policy.test.ts;
  // this just confirms the runner-glue's re-export reaches the same function.
  it('returns "patch" for a 1.6.0 → 1.6.1 bump', () => {
    expect(classifyVersionBump('1.6.0', '1.6.1')).toBe('patch')
  })
})
