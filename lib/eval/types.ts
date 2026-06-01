/**
 * Eval bench types (v2.0 / F19) — the contract between fixtures, the harness,
 * the scorer, and the committed baseline report.
 *
 * Honesty anchor (CLAUDE.md §5b v2 rule 2): the committed baseline.json is the
 * artifact that proves we haven't regressed calibration. Schemas are Zod so a
 * malformed fixture or hand-edited report fails loudly instead of silently
 * skewing the bench.
 *
 * Cloud-readiness: every schema is pure data — no env-coupled fields, no local
 * paths in the shapes themselves (paths live in the CLI / loader). v3 can run
 * the same fixtures against a hosted sandbox without schema changes.
 */

import { z } from 'zod'
import {
  BreakingChangeSchema,
  type BreakingChange,
} from '@/lib/agent/signals/changelog'
import {
  SemanticDiffSchema,
  type SemanticDiff,
} from '@/lib/agent/signals/semantic-diff'
import {
  ConfidenceBucketSchema,
  type ConfidenceBucket,
} from '@/lib/agent/confidence/score'

// ── Fixture: a single case the harness runs ────────────────────────────────────
//
// Two modes:
//  - mode: 'offline' (v2.0)  — inputs are PROVIDED (already-parsed signals);
//      the harness calls calculateConfidence directly. Fast (~ms), deterministic,
//      no network. Required for every fixture so the bench runs offline in CI.
//  - mode: 'live'    (v2.x+) — inputs are FETCHED (pinned tarballs / npm).
//      Validates the full pipeline. Optional, skipped by default to keep the
//      bench fast and CI-friendly.

const TolerantOverallSchema = z.object({
  min: z.number().min(0).max(100),
  max: z.number().min(0).max(100),
}).refine((r) => r.min <= r.max, { message: 'min must be ≤ max' })

const PerSymbolExpectationSchema = z.object({
  symbol: z.string().min(1),
  /** True = should appear in the per-symbol score output, False = should NOT. */
  shouldDetect: z.boolean(),
})

export const OfflineFixtureInputSchema = z.object({
  breakingChanges: z.array(BreakingChangeSchema),
  semanticDiff: SemanticDiffSchema.nullable(),
  patchedFilePaths: z.array(z.string().min(1)),
  verificationPassed: z.boolean(),
  /**
   * v2.0 / F20 — Phase C (smoke) outcome. Optional + nullable to keep v1.5-
   * shaped fixtures valid: omitted/null = smoke not attempted (no cap),
   * matching CalculateConfidenceInput's contract.
   */
  smokePassed: z.boolean().nullable().optional(),
  /**
   * v2.2 / F23c — language-aware bucket ceiling (CLAUDE.md §5b v2 r1).
   * Optional + back-compat: omitted = no clamp (TS/Python/Go all reach
   * 'high'); supplied = the clamp binds. Fixtures pin the clamp's
   * behavior at the bench layer so a future scorer refactor can't
   * silently raise the Rust ceiling.
   */
  maxBucket: ConfidenceBucketSchema.optional(),
})
export type OfflineFixtureInput = z.infer<typeof OfflineFixtureInputSchema>

export const FixtureExpectationSchema = z.object({
  bucket: ConfidenceBucketSchema,
  overall: TolerantOverallSchema,
  /**
   * Optional per-symbol assertions. Lets a fixture pin specific symbols (e.g.
   * "axios `AxiosResponse` must be detected as breaking") without locking the
   * full per-symbol list — calibration math is allowed to evolve.
   */
  perSymbolHits: z.array(PerSymbolExpectationSchema).optional(),
})
export type FixtureExpectation = z.infer<typeof FixtureExpectationSchema>

export const FixtureCaseSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9._-]+$/i, 'id must be filename-safe'),
  packageName: z.string().min(1),
  fromVersion: z.string().min(1),
  toVersion: z.string().min(1),
  /** Long-form so the report explains WHY this fixture exists. */
  description: z.string().max(500),
  mode: z.literal('offline'),
  input: OfflineFixtureInputSchema,
  expected: FixtureExpectationSchema,
  /**
   * Optional tag so reports can group / filter (e.g. "self-test", "real-npm",
   * "regression"). Pure label — no behavioral effect.
   */
  tags: z.array(z.string()).optional(),
})
export type FixtureCase = z.infer<typeof FixtureCaseSchema>

// Re-export the underlying types so fixture authors only need to import here.
export type { BreakingChange, SemanticDiff, ConfidenceBucket }

// ── Result: what the harness emits per case + in aggregate ────────────────────

export const PerSymbolResultSchema = z.object({
  symbol: z.string(),
  expected: z.boolean(),
  observed: z.boolean(),
  hit: z.boolean(),
})
export type PerSymbolResult = z.infer<typeof PerSymbolResultSchema>

export const FixtureRunResultSchema = z.object({
  id: z.string(),
  packageName: z.string(),
  fromVersion: z.string(),
  toVersion: z.string(),
  /** Actual bucket the scorer produced (regardless of pass/fail). */
  observedBucket: ConfidenceBucketSchema,
  /** Actual overall the scorer produced (regardless of pass/fail). */
  observedOverall: z.number(),
  expectedBucket: ConfidenceBucketSchema,
  expectedOverallMin: z.number(),
  expectedOverallMax: z.number(),
  bucketMatch: z.boolean(),
  overallInRange: z.boolean(),
  /** Per-symbol hits when the fixture pinned them; empty array otherwise. */
  perSymbol: z.array(PerSymbolResultSchema),
  /** True iff bucketMatch AND overallInRange AND every perSymbol hit. */
  passed: z.boolean(),
  /** Wall-clock ms the offline scorer took for this case (informational). */
  durationMs: z.number().int().nonnegative(),
  /** Failure reasons, human-readable. Empty when passed. */
  failures: z.array(z.string()),
})
export type FixtureRunResult = z.infer<typeof FixtureRunResultSchema>

// ── Calibration report — the bench's headline numbers ─────────────────────────

export const BucketConfusionSchema = z.object({
  /** Expected vs. observed counts, e.g. confusion['high']['medium'] = 2. */
  high: z.object({ high: z.number().int(), medium: z.number().int(), low: z.number().int() }),
  medium: z.object({ high: z.number().int(), medium: z.number().int(), low: z.number().int() }),
  low: z.object({ high: z.number().int(), medium: z.number().int(), low: z.number().int() }),
})
export type BucketConfusion = z.infer<typeof BucketConfusionSchema>

export const CalibrationReportSchema = z.object({
  /** ISO 8601 — every report carries a clock so we can compare across releases. */
  generatedAt: z.string(),
  /** What the harness ran (release tag, branch, commit SHA — all optional). */
  release: z.object({
    label: z.string(),
    gitCommit: z.string().nullable(),
  }),
  /** Totals across all cases. */
  totals: z.object({
    fixtures: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    bucketAccuracyPercent: z.number().min(0).max(100),
    overallInRangePercent: z.number().min(0).max(100),
  }),
  /** Confusion matrix → calibration health at a glance. */
  bucketConfusion: BucketConfusionSchema,
  /** Per-case detail, sorted by id for deterministic diff. */
  fixtures: z.array(FixtureRunResultSchema),
})
export type CalibrationReport = z.infer<typeof CalibrationReportSchema>

// ── Bench input options ───────────────────────────────────────────────────────

export interface BenchOptions {
  /** Optional release label written into the report (default: "local"). */
  releaseLabel?: string
  /** Optional git commit SHA written into the report. */
  gitCommit?: string | null
  /** Filter to only run fixtures with this tag (e.g. "self-test"). */
  onlyTag?: string
}
