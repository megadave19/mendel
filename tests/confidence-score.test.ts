/**
 * Unit tests for the v1.5 Workstream #2 confidence scorer.
 *
 * Each scenario from TRD §9.5 has at least one assertion. Verification cap,
 * bucket thresholds, and the no-signals fallback are all covered.
 */

import { describe, it, expect } from 'vitest'
import {
  calculateConfidence,
  ConfidenceScoreSchema,
  __testing,
  type ConfidenceScore,
} from '@/lib/agent/confidence/score'
import type { BreakingChange } from '@/lib/agent/signals/changelog'
import type { SemanticDiff } from '@/lib/agent/signals/semantic-diff'

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function changelog(symbol: string): BreakingChange {
  return {
    symbol,
    changeType: 'removed',
    description: `${symbol} was removed`,
    sourceUrl: 'https://github.com/example/pkg/releases',
  }
}

function semanticDiff(
  removed: string[] = [],
  coverage = 90,
  tier: SemanticDiff['analysisTier'] = 'dts',
): SemanticDiff {
  return {
    removedExports: removed,
    signatureChanges: [],
    newDeprecations: [],
    affectedSitesInRepo: [],
    coveragePercent: coverage,
    unanalyzableSymbols: [],
    analysisTier: tier,
  }
}

/* ─── Per-symbol scoring scenarios (TRD §9.5 table) ───────────────────────── */

describe('confidence: per-breaking-change scoring (TRD §9.5 table)', () => {
  it('both signals agree → 85–95 (no tag)', () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('removedFn')],
      semanticDiff: semanticDiff(['removedFn'], 92),
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: true,
    })
    const item = result.perBreakingChange[0]
    expect(item.symbol).toBe('removedFn')
    expect(item.score).toBeGreaterThanOrEqual(85)
    expect(item.score).toBeLessThanOrEqual(95)
    expect(item.signalsAgreeing.sort()).toEqual(['changelog', 'semantic_diff'])
    expect(item.tag).toBeUndefined()
  })

  it('semantic-diff catches, changelog silent → 65–75 ("undocumented")', () => {
    const result = calculateConfidence({
      breakingChanges: [],
      semanticDiff: semanticDiff(['silentlyRemoved'], 90),
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: true,
    })
    const item = result.perBreakingChange[0]
    expect(item.score).toBeGreaterThanOrEqual(65)
    expect(item.score).toBeLessThanOrEqual(75)
    expect(item.signalsAgreeing).toEqual(['semantic_diff'])
    expect(item.tag).toBe('undocumented breaking change')
  })

  it('changelog claims, semantic silent w/ high coverage → 40–55 ("needs manual verification")', () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('claimedRemoval')],
      semanticDiff: semanticDiff([], 90), // high coverage, no removals seen
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: true,
    })
    const item = result.perBreakingChange[0]
    expect(item.score).toBeGreaterThanOrEqual(40)
    expect(item.score).toBeLessThanOrEqual(55)
    expect(item.signalsAgreeing).toEqual(['changelog'])
    expect(item.tag).toBe('needs manual verification')
  })

  it('changelog claims, semantic silent w/ LOW coverage → 55–65 ("incomplete analysis")', () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('claimedRemoval')],
      semanticDiff: semanticDiff([], 40), // low coverage
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: true,
    })
    const item = result.perBreakingChange[0]
    expect(item.score).toBeGreaterThanOrEqual(55)
    expect(item.score).toBeLessThanOrEqual(65)
    expect(item.tag).toBe('incomplete analysis')
  })

  it('changelog only, semantic-diff failed to run → 55–65 ("single-signal")', () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('claimedRemoval')],
      semanticDiff: null, // signal didn't run
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: true,
    })
    const item = result.perBreakingChange[0]
    expect(item.score).toBeGreaterThanOrEqual(55)
    expect(item.score).toBeLessThanOrEqual(65)
    expect(item.tag).toBe('single-signal')
  })
})

/* ─── Overall + bucket + verification cap ─────────────────────────────────── */

describe('confidence: overall + bucket + verification cap', () => {
  it('verification failure caps overall at 50 (forces low bucket)', () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('a'), changelog('b')],
      semanticDiff: semanticDiff(['a', 'b'], 90), // both agree, would be 90
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: false,
    })
    expect(result.verificationCapped).toBe(true)
    expect(result.smokeCapped).toBe(false)
    expect(result.overall).toBe(50)
    expect(result.bucket).toBe('low')
  })

  // ─── v2.0 / F20 — smoke (Phase C) cap ─────────────────────────────────────

  it("smoke=false caps overall at 50 even when verification passed (boot failed → can't ship)", () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('a'), changelog('b')],
      semanticDiff: semanticDiff(['a', 'b'], 90),
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: true,
      smokePassed: false,
    })
    expect(result.smokeCapped).toBe(true)
    expect(result.verificationCapped).toBe(false)
    expect(result.overall).toBe(50)
    expect(result.bucket).toBe('low')
  })

  it('smoke=true does NOT cap (passing smoke is just no-cap — it doesn\'t boost)', () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('a')],
      semanticDiff: semanticDiff(['a'], 90),
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: true,
      smokePassed: true,
    })
    expect(result.smokeCapped).toBe(false)
    expect(result.verificationCapped).toBe(false)
    expect(result.bucket).toBe('high')
  })

  it("smoke=null/omitted = not attempted = no cap (back-compat with v1.5 scans)", () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('a')],
      semanticDiff: semanticDiff(['a'], 90),
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: true,
      // smokePassed omitted → undefined
    })
    expect(result.smokeCapped).toBe(false)
    expect(result.bucket).toBe('high')
  })

  it("both verification AND smoke failed: BOTH caps fire (the runner can render both reasons)", () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('a')],
      semanticDiff: semanticDiff(['a'], 90),
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: false,
      smokePassed: false,
    })
    expect(result.verificationCapped).toBe(true)
    expect(result.smokeCapped).toBe(true)
    expect(result.overall).toBe(50)
  })

  it('high bucket (≥ 80): both-agree case lands at high', () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('a')],
      semanticDiff: semanticDiff(['a'], 92),
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: true,
    })
    expect(result.overall).toBeGreaterThanOrEqual(80)
    expect(result.bucket).toBe('high')
  })

  it('medium bucket (60–79): single-signal lands at medium', () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('a')],
      semanticDiff: null,
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: true,
    })
    expect(result.overall).toBeGreaterThanOrEqual(60)
    expect(result.overall).toBeLessThan(80)
    expect(result.bucket).toBe('medium')
  })

  it('low bucket (< 60): changelog-only high-coverage disagreement lands at low', () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('a')],
      semanticDiff: semanticDiff([], 92), // high coverage, didn't confirm
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: true,
    })
    expect(result.overall).toBeLessThan(60)
    expect(result.bucket).toBe('low')
  })

  it('no flagged symbols → default 75 baseline (medium, "version-bump-only")', () => {
    const result = calculateConfidence({
      breakingChanges: [],
      semanticDiff: semanticDiff([], 95), // clean — nothing flagged
      patchedFilePaths: ['package.json'],
      verificationPassed: true,
    })
    expect(result.overall).toBe(75)
    expect(result.bucket).toBe('medium')
    expect(result.perBreakingChange).toEqual([])
  })
})

/* ─── Output shape + determinism ──────────────────────────────────────────── */

describe('confidence: output shape + determinism', () => {
  it('output passes Zod schema', () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('a')],
      semanticDiff: semanticDiff(['a'], 90),
      patchedFilePaths: ['src/a.ts', 'src/b.ts'],
      verificationPassed: true,
    })
    expect(() => ConfidenceScoreSchema.parse(result)).not.toThrow()
  })

  it('deterministic: same inputs → same bytes', () => {
    const args = {
      breakingChanges: [changelog('b'), changelog('a'), changelog('c')],
      semanticDiff: semanticDiff(['a', 'c'], 90),
      patchedFilePaths: ['src/b.ts', 'src/a.ts'],
      verificationPassed: true,
    }
    const r1 = calculateConfidence(args)
    const r2 = calculateConfidence(args)
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
    // perBreakingChange sorted alphabetically
    expect(r1.perBreakingChange.map((p) => p.symbol)).toEqual(['a', 'b', 'c'])
    // perPatchedFile sorted alphabetically
    expect(r1.perPatchedFile.map((p) => p.path)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('analysisCoverage reflects "none" tier when semantic-diff is null', () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('a')],
      semanticDiff: null,
      patchedFilePaths: [],
      verificationPassed: true,
    })
    expect(result.analysisCoverage.analysisTier).toBe('none')
    expect(result.analysisCoverage.percentCovered).toBe(0)
    expect(result.analysisCoverage.notAnalyzed.length).toBeGreaterThan(0)
  })

  it('mixed scenario: 3 symbols, each in a different scoring bucket', () => {
    const result = calculateConfidence({
      breakingChanges: [changelog('agreeSym'), changelog('changelogOnlySym')],
      semanticDiff: semanticDiff(['agreeSym', 'semanticOnlySym'], 90),
      patchedFilePaths: ['src/a.ts'],
      verificationPassed: true,
    })
    const byName = Object.fromEntries(result.perBreakingChange.map((p) => [p.symbol, p]))
    expect(byName.agreeSym?.signalsAgreeing.sort()).toEqual(['changelog', 'semantic_diff'])
    expect(byName.changelogOnlySym?.tag).toBe('needs manual verification')
    expect(byName.semanticOnlySym?.tag).toBe('undocumented breaking change')

    // Overall is weighted average — should land in the middle of these three.
    expect(result.overall).toBeGreaterThan(40)
    expect(result.overall).toBeLessThan(90)
  })
})

/* ─── Bucket boundary tests ────────────────────────────────────────────────── */

describe('confidence: bucket boundaries', () => {
  it('bucketFromScore boundaries', () => {
    const { bucketFromScore } = __testing
    expect(bucketFromScore(100)).toBe('high')
    expect(bucketFromScore(80)).toBe('high')
    expect(bucketFromScore(79)).toBe('medium')
    expect(bucketFromScore(60)).toBe('medium')
    expect(bucketFromScore(59)).toBe('low')
    expect(bucketFromScore(0)).toBe('low')
  })
})
