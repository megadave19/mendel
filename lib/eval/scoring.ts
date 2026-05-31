/**
 * Eval scoring (v2.0 / F19) — turns one observed ConfidenceScore + one
 * fixture's expectation into a `FixtureRunResult`, and aggregates a list of
 * those into a `CalibrationReport`.
 *
 * Pure functions, no IO, no clock — so the scorer itself is trivially
 * testable AND deterministic across releases. The clock + git SHA are
 * injected by the harness when it builds the final report.
 *
 * CLAUDE.md §5b v2 rule 2: the committed baseline report is the honesty
 * anchor. A calibration regression release-over-release is stop-the-line —
 * which means the scoring math MUST be stable. Any change to this file
 * requires a re-baselining ceremony, not a silent edit.
 */

import type {
  CalibrationReport,
  FixtureCase,
  FixtureRunResult,
  PerSymbolResult,
  BucketConfusion,
} from './types'
import type { ConfidenceScore, ConfidenceBucket } from '@/lib/agent/confidence/score'

// ── Per-fixture scoring ───────────────────────────────────────────────────────

export interface ScoreOneInput {
  fixture: FixtureCase
  observed: ConfidenceScore
  durationMs: number
}

export function scoreOne(input: ScoreOneInput): FixtureRunResult {
  const { fixture, observed, durationMs } = input
  const { expected } = fixture

  const bucketMatch = observed.bucket === expected.bucket
  const overallInRange =
    observed.overall >= expected.overall.min && observed.overall <= expected.overall.max

  // Per-symbol hits, when the fixture pinned them.
  const perSymbol: PerSymbolResult[] = []
  if (expected.perSymbolHits && expected.perSymbolHits.length > 0) {
    const observedSymbols = new Set(observed.perBreakingChange.map((p) => p.symbol))
    for (const exp of expected.perSymbolHits) {
      const observedFlag = observedSymbols.has(exp.symbol)
      perSymbol.push({
        symbol: exp.symbol,
        expected: exp.shouldDetect,
        observed: observedFlag,
        hit: observedFlag === exp.shouldDetect,
      })
    }
  }

  const allSymbolHits = perSymbol.every((p) => p.hit)
  const passed = bucketMatch && overallInRange && allSymbolHits

  const failures: string[] = []
  if (!bucketMatch) {
    failures.push(`expected bucket=${expected.bucket}, observed=${observed.bucket}`)
  }
  if (!overallInRange) {
    failures.push(
      `expected overall in [${expected.overall.min}, ${expected.overall.max}], observed=${observed.overall}`,
    )
  }
  for (const p of perSymbol) {
    if (!p.hit) {
      failures.push(
        `symbol "${p.symbol}": expected detect=${p.expected}, observed=${p.observed}`,
      )
    }
  }

  return {
    id: fixture.id,
    packageName: fixture.packageName,
    fromVersion: fixture.fromVersion,
    toVersion: fixture.toVersion,
    observedBucket: observed.bucket,
    observedOverall: observed.overall,
    expectedBucket: expected.bucket,
    expectedOverallMin: expected.overall.min,
    expectedOverallMax: expected.overall.max,
    bucketMatch,
    overallInRange,
    perSymbol,
    passed,
    durationMs,
    failures,
  }
}

// ── Aggregation ──────────────────────────────────────────────────────────────

const BUCKETS: ConfidenceBucket[] = ['high', 'medium', 'low']

function emptyConfusion(): BucketConfusion {
  // Zod's BucketConfusionSchema demands a literal {high, medium, low} per row;
  // build it explicitly so the type widens correctly under strict TS.
  return {
    high: { high: 0, medium: 0, low: 0 },
    medium: { high: 0, medium: 0, low: 0 },
    low: { high: 0, medium: 0, low: 0 },
  }
}

function pct(n: number, d: number): number {
  if (d === 0) return 0
  return Math.round((n / d) * 1000) / 10 // 1 decimal point
}

export interface AggregateInput {
  fixtures: FixtureRunResult[]
  generatedAt: string
  releaseLabel: string
  gitCommit: string | null
}

export function aggregateReport(input: AggregateInput): CalibrationReport {
  const { fixtures, generatedAt, releaseLabel, gitCommit } = input
  const total = fixtures.length
  const passed = fixtures.filter((f) => f.passed).length
  const bucketCorrect = fixtures.filter((f) => f.bucketMatch).length
  const rangeCorrect = fixtures.filter((f) => f.overallInRange).length

  const confusion = emptyConfusion()
  for (const f of fixtures) {
    // expectedBucket = row, observedBucket = column.
    confusion[f.expectedBucket][f.observedBucket]++
  }
  // Sanity-check that every bucket landed in a defined row/col.
  for (const row of BUCKETS) {
    for (const col of BUCKETS) {
      if (!Number.isInteger(confusion[row][col])) {
        throw new Error(`confusion matrix corrupted at [${row}][${col}]`)
      }
    }
  }

  // Sort fixtures by id for deterministic diff across releases.
  const sortedFixtures = [...fixtures].sort((a, b) => a.id.localeCompare(b.id))

  return {
    generatedAt,
    release: { label: releaseLabel, gitCommit },
    totals: {
      fixtures: total,
      passed,
      failed: total - passed,
      bucketAccuracyPercent: pct(bucketCorrect, total),
      overallInRangePercent: pct(rangeCorrect, total),
    },
    bucketConfusion: confusion,
    fixtures: sortedFixtures,
  }
}

// ── Comparison: did this report regress vs. the committed baseline? ──────────

export interface RegressionVerdict {
  /** True iff the new report passes the bar set by baseline (≥ on accuracy). */
  ok: boolean
  /** Bucket accuracy delta in percentage points (new - baseline). */
  bucketAccuracyDelta: number
  /** Range accuracy delta in percentage points (new - baseline). */
  rangeAccuracyDelta: number
  /** Fixtures that PASSED in baseline but FAIL in the new report — the real regressions. */
  newlyFailingIds: string[]
  /** Fixtures that FAILED in baseline but PASS in the new report — the wins. */
  newlyPassingIds: string[]
  /** Human-readable summary line(s) for the CLI. */
  summary: string[]
}

/**
 * Pure regression comparison: did the new report drop ANY fixture that
 * previously passed? Per CLAUDE.md §5b v2 rule 2 this is stop-the-line.
 *
 * Note: a NEW fixture (not in baseline) failing is reported in `newlyFailingIds`
 * — we treat "the bar moved up" as a deliberate addition that the release must
 * own. The harness CLI exits non-zero on any newly-failing.
 */
export function compareToBaseline(
  baseline: CalibrationReport,
  next: CalibrationReport,
): RegressionVerdict {
  const baseById = new Map(baseline.fixtures.map((f) => [f.id, f]))
  const nextById = new Map(next.fixtures.map((f) => [f.id, f]))

  const newlyFailing: string[] = []
  const newlyPassing: string[] = []

  for (const [id, n] of nextById) {
    const b = baseById.get(id)
    if (b) {
      if (b.passed && !n.passed) newlyFailing.push(id)
      if (!b.passed && n.passed) newlyPassing.push(id)
    } else if (!n.passed) {
      // Fixture is new and failing — counts as a regression to surface.
      newlyFailing.push(id)
    }
  }

  const bucketAccuracyDelta =
    next.totals.bucketAccuracyPercent - baseline.totals.bucketAccuracyPercent
  const rangeAccuracyDelta =
    next.totals.overallInRangePercent - baseline.totals.overallInRangePercent

  const ok = newlyFailing.length === 0 && bucketAccuracyDelta >= 0

  const summary: string[] = []
  summary.push(
    `bucket accuracy: ${baseline.totals.bucketAccuracyPercent}% → ${next.totals.bucketAccuracyPercent}% (${bucketAccuracyDelta >= 0 ? '+' : ''}${bucketAccuracyDelta})`,
  )
  summary.push(
    `range accuracy:  ${baseline.totals.overallInRangePercent}% → ${next.totals.overallInRangePercent}% (${rangeAccuracyDelta >= 0 ? '+' : ''}${rangeAccuracyDelta})`,
  )
  if (newlyFailing.length > 0) {
    summary.push(`⚠ newly failing: ${newlyFailing.join(', ')}`)
  }
  if (newlyPassing.length > 0) {
    summary.push(`✓ newly passing: ${newlyPassing.join(', ')}`)
  }

  return {
    ok,
    bucketAccuracyDelta,
    rangeAccuracyDelta,
    newlyFailingIds: newlyFailing,
    newlyPassingIds: newlyPassing,
    summary,
  }
}
