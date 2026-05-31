/**
 * Tests for the F19 eval bench (v2.0).
 *
 * Covers:
 *   - scoring.ts pure functions (scoreOne, aggregateReport, compareToBaseline)
 *   - bench-runner.ts loader + runner against the REAL `calculateConfidence`
 *   - end-to-end: load the actual committed fixtures, score them, expect 100% pass
 *
 * The end-to-end test is the bench's own self-test (V2_PLAN §F19 Verification:
 * "validate the bench against a real npm pair…before trusting it"). If the
 * scorer drifts, this test fails loudly BEFORE the baseline does.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  scoreOne,
  aggregateReport,
  compareToBaseline,
  type RegressionVerdict,
} from '@/lib/eval/scoring'
import { loadFixtures, runBench, runFixture } from '@/lib/eval/bench-runner'
import type {
  CalibrationReport,
  FixtureCase,
  FixtureRunResult,
} from '@/lib/eval/types'
import type { ConfidenceScore } from '@/lib/agent/confidence/score'

// ── Fixtures + helpers ────────────────────────────────────────────────────────

function fakeFixture(overrides: Partial<FixtureCase> = {}): FixtureCase {
  return {
    id: 'fx',
    packageName: 'pkg',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    description: 'a',
    mode: 'offline',
    input: {
      breakingChanges: [],
      semanticDiff: null,
      patchedFilePaths: [],
      verificationPassed: true,
    },
    expected: { bucket: 'medium', overall: { min: 70, max: 80 } },
    ...overrides,
  }
}

function fakeObserved(overrides: Partial<ConfidenceScore> = {}): ConfidenceScore {
  return {
    overall: 75,
    bucket: 'medium',
    perBreakingChange: [],
    perPatchedFile: [],
    analysisCoverage: {
      symbolsAnalyzed: 0, symbolsTotal: 0, percentCovered: 0,
      analysisTier: 'none', notAnalyzed: [{ symbol: '*', reason: 'n/a' }],
    },
    verificationCapped: false,
    ...overrides,
  }
}

// ── scoreOne ──────────────────────────────────────────────────────────────────

describe('scoreOne — turn one observed score into a FixtureRunResult', () => {
  it('passes when bucket matches + overall in range + no perSymbolHits required', () => {
    const r = scoreOne({
      fixture: fakeFixture(),
      observed: fakeObserved({ overall: 75, bucket: 'medium' }),
      durationMs: 3,
    })
    expect(r.passed).toBe(true)
    expect(r.bucketMatch).toBe(true)
    expect(r.overallInRange).toBe(true)
    expect(r.failures).toEqual([])
  })

  it('fails the fixture when bucket diverges (carries a readable reason)', () => {
    const r = scoreOne({
      fixture: fakeFixture({ expected: { bucket: 'high', overall: { min: 80, max: 100 } } }),
      observed: fakeObserved({ overall: 75, bucket: 'medium' }),
      durationMs: 2,
    })
    expect(r.passed).toBe(false)
    expect(r.bucketMatch).toBe(false)
    expect(r.failures.join(' ')).toMatch(/expected bucket=high, observed=medium/)
  })

  it('fails when overall is outside the expected range, even if bucket matches', () => {
    const r = scoreOne({
      fixture: fakeFixture({ expected: { bucket: 'medium', overall: { min: 60, max: 65 } } }),
      observed: fakeObserved({ overall: 75, bucket: 'medium' }),
      durationMs: 1,
    })
    expect(r.passed).toBe(false)
    expect(r.overallInRange).toBe(false)
    expect(r.failures.join(' ')).toMatch(/observed=75/)
  })

  it('reports per-symbol hits when the fixture pins them — both met', () => {
    const r = scoreOne({
      fixture: fakeFixture({
        expected: {
          bucket: 'medium', overall: { min: 70, max: 80 },
          perSymbolHits: [
            { symbol: 'foo', shouldDetect: true },
            { symbol: 'bar', shouldDetect: false },
          ],
        },
      }),
      observed: fakeObserved({
        perBreakingChange: [{ symbol: 'foo', score: 90, signalsAgreeing: ['changelog'] }],
      }),
      durationMs: 0,
    })
    expect(r.perSymbol.map((p) => p.hit)).toEqual([true, true])
    expect(r.passed).toBe(true)
  })

  it("flags a per-symbol miss when an expected-detected symbol wasn't observed", () => {
    const r = scoreOne({
      fixture: fakeFixture({
        expected: {
          bucket: 'medium', overall: { min: 70, max: 80 },
          perSymbolHits: [{ symbol: 'foo', shouldDetect: true }],
        },
      }),
      observed: fakeObserved({ perBreakingChange: [] }),
      durationMs: 0,
    })
    expect(r.passed).toBe(false)
    expect(r.perSymbol[0]).toMatchObject({ symbol: 'foo', expected: true, observed: false, hit: false })
    expect(r.failures.join(' ')).toMatch(/symbol "foo"/)
  })
})

// ── aggregateReport ──────────────────────────────────────────────────────────

describe('aggregateReport — totals + confusion matrix', () => {
  it('counts passed/failed + bucket-accuracy correctly', () => {
    const fixtures: FixtureRunResult[] = [
      makeResult({ id: 'a', passed: true, bucketMatch: true, overallInRange: true, expectedBucket: 'high', observedBucket: 'high' }),
      makeResult({ id: 'b', passed: false, bucketMatch: false, overallInRange: true, expectedBucket: 'high', observedBucket: 'medium' }),
      makeResult({ id: 'c', passed: true, bucketMatch: true, overallInRange: true, expectedBucket: 'low', observedBucket: 'low' }),
    ]
    const report = aggregateReport({
      fixtures, generatedAt: '2026-05-31T00:00:00.000Z', releaseLabel: 'test', gitCommit: null,
    })
    expect(report.totals.fixtures).toBe(3)
    expect(report.totals.passed).toBe(2)
    expect(report.totals.failed).toBe(1)
    // 2 of 3 buckets matched → 66.7%
    expect(report.totals.bucketAccuracyPercent).toBeCloseTo(66.7, 1)
  })

  it('fills the confusion matrix [expected][observed]', () => {
    const fixtures: FixtureRunResult[] = [
      makeResult({ id: 'a', expectedBucket: 'high', observedBucket: 'high' }),
      makeResult({ id: 'b', expectedBucket: 'high', observedBucket: 'medium' }),
      makeResult({ id: 'c', expectedBucket: 'medium', observedBucket: 'medium' }),
    ]
    const report = aggregateReport({
      fixtures, generatedAt: '2026-05-31T00:00:00.000Z', releaseLabel: 'test', gitCommit: null,
    })
    expect(report.bucketConfusion.high.high).toBe(1)
    expect(report.bucketConfusion.high.medium).toBe(1)
    expect(report.bucketConfusion.medium.medium).toBe(1)
    expect(report.bucketConfusion.low.low).toBe(0)
  })

  it('sorts fixtures by id (deterministic across releases)', () => {
    const fixtures: FixtureRunResult[] = [
      makeResult({ id: 'zebra' }),
      makeResult({ id: 'alpha' }),
      makeResult({ id: 'mango' }),
    ]
    const report = aggregateReport({
      fixtures, generatedAt: '2026-05-31T00:00:00.000Z', releaseLabel: 'test', gitCommit: null,
    })
    expect(report.fixtures.map((f) => f.id)).toEqual(['alpha', 'mango', 'zebra'])
  })
})

// ── compareToBaseline ─────────────────────────────────────────────────────────

describe('compareToBaseline — regression detection', () => {
  it("flags ok=false when a previously-passing fixture now fails (the §5b stop-the-line case)", () => {
    const base: CalibrationReport = makeReport({
      fixtures: [makeResult({ id: 'a', passed: true })],
      bucketAccuracyPercent: 100, overallInRangePercent: 100,
    })
    const next: CalibrationReport = makeReport({
      fixtures: [makeResult({ id: 'a', passed: false })],
      bucketAccuracyPercent: 0, overallInRangePercent: 100,
    })
    const v: RegressionVerdict = compareToBaseline(base, next)
    expect(v.ok).toBe(false)
    expect(v.newlyFailingIds).toEqual(['a'])
    expect(v.bucketAccuracyDelta).toBe(-100)
  })

  it("flags ok=true when bucket accuracy is unchanged + no new failures", () => {
    const base: CalibrationReport = makeReport({
      fixtures: [makeResult({ id: 'a', passed: true })],
      bucketAccuracyPercent: 100, overallInRangePercent: 100,
    })
    const next: CalibrationReport = makeReport({
      fixtures: [makeResult({ id: 'a', passed: true })],
      bucketAccuracyPercent: 100, overallInRangePercent: 100,
    })
    expect(compareToBaseline(base, next).ok).toBe(true)
  })

  it('reports newlyPassing wins separately from newlyFailing regressions', () => {
    const base: CalibrationReport = makeReport({
      fixtures: [makeResult({ id: 'a', passed: false })],
      bucketAccuracyPercent: 0, overallInRangePercent: 0,
    })
    const next: CalibrationReport = makeReport({
      fixtures: [makeResult({ id: 'a', passed: true })],
      bucketAccuracyPercent: 100, overallInRangePercent: 100,
    })
    const v = compareToBaseline(base, next)
    expect(v.newlyPassingIds).toEqual(['a'])
    expect(v.newlyFailingIds).toEqual([])
    expect(v.ok).toBe(true)
  })

  it('counts a NEW (not-in-baseline) failing fixture as a regression', () => {
    const base: CalibrationReport = makeReport({ fixtures: [], bucketAccuracyPercent: 0, overallInRangePercent: 0 })
    const next: CalibrationReport = makeReport({
      fixtures: [makeResult({ id: 'new-fixture', passed: false })],
      bucketAccuracyPercent: 0, overallInRangePercent: 0,
    })
    const v = compareToBaseline(base, next)
    expect(v.newlyFailingIds).toEqual(['new-fixture'])
    expect(v.ok).toBe(false)
  })
})

// ── loadFixtures + runFixture ────────────────────────────────────────────────

describe('loadFixtures — schema enforcement', () => {
  let dir: string

  beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'mendel-fx-')) })
  afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

  it('parses a valid fixture JSON', async () => {
    writeFileSync(
      path.join(dir, 'ok.json'),
      JSON.stringify(fakeFixture({ id: 'ok' })),
    )
    const cases = await loadFixtures(dir)
    expect(cases).toHaveLength(1)
    expect(cases[0].id).toBe('ok')
  })

  it('rejects a malformed fixture with the path attached (loud-fail, not silent skip)', async () => {
    writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ id: 'bad', mode: 'offline' }))
    await expect(loadFixtures(dir)).rejects.toThrow(/bad\.json.*failed schema validation/)
  })
})

describe('runFixture — invokes the REAL calculateConfidence', () => {
  it('produces an observed bucket = high for the both-signals-agree fixture', () => {
    const fx = fakeFixture({
      id: 'both-agree',
      input: {
        breakingChanges: [
          { symbol: 'foo', changeType: 'removed', description: 'gone', sourceUrl: 'https://x/c#foo' },
        ],
        semanticDiff: {
          removedExports: ['foo'],
          signatureChanges: [],
          newDeprecations: [],
          affectedSitesInRepo: [],
          coveragePercent: 100,
          unanalyzableSymbols: [],
          analysisTier: 'dts',
        },
        patchedFilePaths: ['package.json'],
        verificationPassed: true,
      },
      expected: {
        bucket: 'high', overall: { min: 89, max: 91 },
        perSymbolHits: [{ symbol: 'foo', shouldDetect: true }],
      },
    })
    const r = runFixture(fx)
    expect(r.observedBucket).toBe('high')
    expect(r.observedOverall).toBe(90)
    expect(r.passed).toBe(true)
  })
})

// ── End-to-end: real fixtures, real scorer, expect 100% ──────────────────────

describe('runBench — the committed fixtures all pass against the current scorer', () => {
  it('runs every fixture in eval/fixtures/ to 100% bucket + range accuracy', async () => {
    // This is the bench's own self-test (V2_PLAN §F19 verification). If it
    // ever fails, either the scorer drifted or a fixture's expectation needs
    // updating — both require a re-baselining ceremony, not a silent edit.
    const report = await runBench({
      fixturesDir: path.resolve(process.cwd(), 'eval/fixtures'),
      options: { releaseLabel: 'test', gitCommit: null },
    })
    expect(report.totals.fixtures).toBeGreaterThanOrEqual(5)
    expect(report.totals.passed).toBe(report.totals.fixtures)
    expect(report.totals.bucketAccuracyPercent).toBe(100)
    expect(report.totals.overallInRangePercent).toBe(100)
  })

  it('throws when --only-tag matches no fixtures (no silent "100% on 0")', async () => {
    await expect(
      runBench({
        fixturesDir: path.resolve(process.cwd(), 'eval/fixtures'),
        options: { onlyTag: 'this-tag-does-not-exist' },
      }),
    ).rejects.toThrow(/no fixtures matched tag/)
  })
})

// ── Test-only helpers ─────────────────────────────────────────────────────────

function makeResult(overrides: Partial<FixtureRunResult> = {}): FixtureRunResult {
  return {
    id: 'x',
    packageName: 'pkg',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    observedBucket: 'medium',
    observedOverall: 75,
    expectedBucket: 'medium',
    expectedOverallMin: 70,
    expectedOverallMax: 80,
    bucketMatch: true,
    overallInRange: true,
    perSymbol: [],
    passed: true,
    durationMs: 0,
    failures: [],
    ...overrides,
  }
}

function makeReport(overrides: {
  fixtures: FixtureRunResult[]
  bucketAccuracyPercent: number
  overallInRangePercent: number
}): CalibrationReport {
  return {
    generatedAt: '2026-05-31T00:00:00.000Z',
    release: { label: 'test', gitCommit: null },
    totals: {
      fixtures: overrides.fixtures.length,
      passed: overrides.fixtures.filter((f) => f.passed).length,
      failed: overrides.fixtures.filter((f) => !f.passed).length,
      bucketAccuracyPercent: overrides.bucketAccuracyPercent,
      overallInRangePercent: overrides.overallInRangePercent,
    },
    bucketConfusion: {
      high: { high: 0, medium: 0, low: 0 },
      medium: { high: 0, medium: 0, low: 0 },
      low: { high: 0, medium: 0, low: 0 },
    },
    fixtures: overrides.fixtures,
  }
}
