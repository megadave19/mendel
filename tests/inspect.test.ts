/**
 * Tests for lib/agent/inspect.ts (v2.1 / F22).
 *
 * Network-bound signals are vi.mocked so the test is fast + deterministic.
 * The inspectApi function is a thin orchestrator — most of the value here
 * is asserting:
 *   - the structural cap fires (no "high" leaks through inspect mode)
 *   - per-signal failures are SURFACED in `errors[]`, never swallowed
 *   - a missing PAT honestly skips the changelog signal (we don't
 *     pretend the GitHub anonymous path is fine)
 *
 * §5b assertions baked into individual cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.mock hoists — mocks must live in vi.hoisted() to be reachable from
// the factory at hoist time.
const mocks = vi.hoisted(() => ({
  parseBreakingChanges: vi.fn(),
  parseSemanticDiff: vi.fn(),
}))

vi.mock('@/lib/agent/signals/changelog', async () => {
  // Re-export real types so consumers (the inspect.ts module under test)
  // still see the real BreakingChange shape.
  const actual = await vi.importActual<typeof import('@/lib/agent/signals/changelog')>(
    '@/lib/agent/signals/changelog',
  )
  return { ...actual, parseBreakingChanges: mocks.parseBreakingChanges }
})
vi.mock('@/lib/agent/signals/semantic-diff', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent/signals/semantic-diff')>(
    '@/lib/agent/signals/semantic-diff',
  )
  return { ...actual, parseSemanticDiff: mocks.parseSemanticDiff }
})

import { inspectApi, applyInspectStructuralCap } from '@/lib/agent/inspect'
import type { SemanticDiff } from '@/lib/agent/signals/semantic-diff'

beforeEach(() => {
  mocks.parseBreakingChanges.mockReset()
  mocks.parseSemanticDiff.mockReset()
})

const FAKE_DIFF: SemanticDiff = {
  removedExports: ['foo'],
  signatureChanges: [],
  newDeprecations: [],
  affectedSitesInRepo: [],
  coveragePercent: 100,
  unanalyzableSymbols: [],
  analysisTier: 'dts',
}

const FAKE_BC = [
  {
    symbol: 'foo',
    changeType: 'removed' as const,
    description: 'foo was removed in v2',
    sourceUrl: 'https://example.com/x',
  },
]

// ── applyInspectStructuralCap — pure ──────────────────────────────────────────

describe('applyInspectStructuralCap', () => {
  function makeScore(overall: number, bucket: 'high' | 'medium' | 'low') {
    return {
      overall,
      bucket,
      perBreakingChange: [],
      perPatchedFile: [],
      analysisCoverage: { symbolsAnalyzed: 0, symbolsTotal: 0, percentCovered: 0, analysisTier: 'dts' as const, notAnalyzed: [] },
      verificationCapped: false,
      smokeCapped: false,
    }
  }

  it('passes a low-confidence score through unchanged', () => {
    const { capped, structuralCap } = applyInspectStructuralCap(makeScore(35, 'low'))
    expect(capped.overall).toBe(35)
    expect(capped.bucket).toBe('low')
    expect(structuralCap).toBeNull()
  })

  it('passes a medium-confidence score through unchanged', () => {
    const { capped, structuralCap } = applyInspectStructuralCap(makeScore(70, 'medium'))
    expect(capped.bucket).toBe('medium')
    expect(structuralCap).toBeNull()
  })

  it('CLAMPS a high score down to medium ceiling = 79 (V2_PLAN §F22 honesty)', () => {
    const { capped, structuralCap } = applyInspectStructuralCap(makeScore(90, 'high'))
    expect(capped.bucket).toBe('medium')
    expect(capped.overall).toBe(79)
    expect(structuralCap).toBe('medium-ceiling-no-verify')
    // verificationCapped flag is reused so the existing UI shows the cap
    // badge — structuralCap is the field consumers use to label WHY.
    expect(capped.verificationCapped).toBe(true)
  })

  it('clamps an at-bucket-boundary score (overall=80, bucket=high) to medium', () => {
    const { capped, structuralCap } = applyInspectStructuralCap(makeScore(80, 'high'))
    expect(capped.bucket).toBe('medium')
    expect(capped.overall).toBe(79)
    expect(structuralCap).toBe('medium-ceiling-no-verify')
  })

  it("never lowers a score below its original — clamp is a CEILING, not a floor", () => {
    const { capped } = applyInspectStructuralCap(makeScore(45, 'low'))
    expect(capped.overall).toBe(45) // not bumped up to anything
  })
})

// ── inspectApi — orchestration ────────────────────────────────────────────────

describe('inspectApi — orchestrates signals + caps + honest errors', () => {
  it("runs BOTH signals in parallel + reports calibrated medium when both agree", async () => {
    mocks.parseBreakingChanges.mockResolvedValue(FAKE_BC)
    mocks.parseSemanticDiff.mockResolvedValue(FAKE_DIFF)

    const report = await inspectApi({
      packageName: 'react',
      fromVersion: '18.2.0',
      toVersion: '19.0.0',
      pat: 'ghp_fake_test_xxxxxxxxxxxxxxxxxxxxxxxx',
    })

    // Both-agree on `foo` would normally score 90 (high); structural cap
    // brings it down to 79 (medium). This is the WHOLE F22 honesty claim.
    expect(report.confidence.bucket).toBe('medium')
    expect(report.confidence.overall).toBeLessThanOrEqual(79)
    expect(report.structuralCap).toBe('medium-ceiling-no-verify')
    expect(report.errors).toEqual([])
    expect(report.breakingChanges).toEqual(FAKE_BC)
    expect(report.semanticDiff).toEqual(FAKE_DIFF)
  })

  it("skips changelog signal HONESTLY when no PAT is supplied", async () => {
    mocks.parseSemanticDiff.mockResolvedValue(FAKE_DIFF)
    const report = await inspectApi({
      packageName: 'react',
      fromVersion: '18.2.0',
      toVersion: '19.0.0',
      // no pat
    })
    // parseBreakingChanges must NOT have been called — we don't burn
    // anonymous rate limits.
    expect(mocks.parseBreakingChanges).not.toHaveBeenCalled()
    // Error message is loud + names the cause (§5b).
    expect(report.errors).toContainEqual(expect.stringMatching(/changelog.*no GitHub PAT/i))
    // Semantic-diff still ran — orchestration didn't bail.
    expect(report.semanticDiff).toEqual(FAKE_DIFF)
  })

  it('surfaces a changelog signal error verbatim instead of silently swallowing it', async () => {
    mocks.parseBreakingChanges.mockRejectedValue(new Error('rate limit exceeded'))
    mocks.parseSemanticDiff.mockResolvedValue(FAKE_DIFF)
    const report = await inspectApi({
      packageName: 'react',
      fromVersion: '18.2.0',
      toVersion: '19.0.0',
      pat: 'ghp_fake_test_xxxxxxxxxxxxxxxxxxxxxxxx',
    })
    expect(report.errors).toContainEqual(expect.stringContaining('rate limit exceeded'))
    // Other signal still produced a result.
    expect(report.semanticDiff).toEqual(FAKE_DIFF)
  })

  it('surfaces a semantic-diff signal error AND keeps the other signal alive', async () => {
    mocks.parseBreakingChanges.mockResolvedValue(FAKE_BC)
    mocks.parseSemanticDiff.mockRejectedValue(new Error('tarball fetch failed: 404'))
    const report = await inspectApi({
      packageName: 'unknown-pkg',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      pat: 'ghp_fake_test_xxxxxxxxxxxxxxxxxxxxxxxx',
    })
    expect(report.semanticDiff).toBeNull()
    expect(report.errors).toContainEqual(expect.stringContaining('tarball fetch failed'))
    // Breaking-changes still surfaced.
    expect(report.breakingChanges).toEqual(FAKE_BC)
  })

  it('produces a DETERMINISTIC error order across runs (sorted by full string)', async () => {
    // The sort is on the full prefixed string, so "changelog: …" always
    // comes before "semantic-diff: …" regardless of the inner message.
    // What matters for the permalink is that two runs with the same
    // failures produce the SAME report — that's what this asserts.
    mocks.parseBreakingChanges.mockRejectedValue(new Error('zzz'))
    mocks.parseSemanticDiff.mockRejectedValue(new Error('aaa'))
    const a = await inspectApi({
      packageName: 'p', fromVersion: '1', toVersion: '2',
      pat: 'ghp_x_yyyyyyyyyyyyyyyyyyyyyyyy',
    })
    mocks.parseBreakingChanges.mockReset()
    mocks.parseSemanticDiff.mockReset()
    // Reverse the order of mock setup; sorted output should still match.
    mocks.parseSemanticDiff.mockRejectedValue(new Error('aaa'))
    mocks.parseBreakingChanges.mockRejectedValue(new Error('zzz'))
    const b = await inspectApi({
      packageName: 'p', fromVersion: '1', toVersion: '2',
      pat: 'ghp_x_yyyyyyyyyyyyyyyyyyyyyyyy',
    })
    expect(a.errors).toEqual(b.errors)
    expect(a.errors[0].startsWith('changelog:')).toBe(true)
    expect(a.errors[1].startsWith('semantic-diff:')).toBe(true)
  })

  it('produces an empty-but-valid report when BOTH signals fail (nothing inflated, errors loud)', async () => {
    mocks.parseBreakingChanges.mockRejectedValue(new Error('A'))
    mocks.parseSemanticDiff.mockRejectedValue(new Error('B'))
    const report = await inspectApi({
      packageName: 'p', fromVersion: '1', toVersion: '2',
      pat: 'ghp_x_yyyyyyyyyyyyyyyyyyyyyyyy',
    })
    expect(report.breakingChanges).toEqual([])
    expect(report.semanticDiff).toBeNull()
    expect(report.errors).toHaveLength(2)
    // With no breakingChanges + no semanticDiff, the scorer baselines at 75
    // (version-bump-only). 75 is below the medium ceiling → no structural
    // cap fires (we don't gratuitously over-cap).
    expect(report.confidence.bucket).toBe('medium')
    expect(report.structuralCap).toBeNull()
  })
})
