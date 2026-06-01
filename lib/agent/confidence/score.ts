/**
 * Calibrated Confidence Scoring (v1.5 Workstream #2) — TRD §9.5
 *
 * Asymmetric per-breaking-change scoring combining the changelog signal
 * (Workstream #0 / v1.0) and the semantic-diff signal (Workstream #1 / v1.5).
 *
 * Per TRD §9.5 table (CTO Round-2 calibration):
 *   - Both signals agree                                              → 85–95
 *   - Semantic catches it, changelog silent                           → 65–75 ("undocumented")
 *   - Changelog claims, semantic silent, coverage ≥ 80%               → 40–55 ("needs manual verification")
 *   - Changelog claims, semantic silent, coverage < 80% (or JS-only)  → 55–65 ("incomplete analysis")
 *   - Only changelog available (semantic-diff failed/skipped)         → 55–65 ("single-signal")
 *   - Heuristic match only (no signal flagged it)                     → 30–45
 *
 * Verification failure caps overall at 50 (forces "low" bucket).
 * Buckets: ≥ 80 high · 60–79 medium · < 60 low.
 *
 * NOTE: Threshold-gated PR submission is **Workstream #3**, not here. This
 * file PRODUCES the score; the runner consumes the bucket to decide PR
 * mode. Keeps the responsibilities single-purpose.
 *
 * CLAUDE.md §5b honesty: scoring never inflates. If signals disagree, the
 * score reflects that disagreement rather than papering it over.
 */

import { z } from 'zod'
import type { BreakingChange } from '@/lib/agent/signals/changelog'
import type { SemanticDiff } from '@/lib/agent/signals/semantic-diff'

/* ─── Schemas ─────────────────────────────────────────────────────────────── */

export const ConfidenceBucketSchema = z.enum(['high', 'medium', 'low'])
export type ConfidenceBucket = z.infer<typeof ConfidenceBucketSchema>

export const SignalNameSchema = z.enum(['changelog', 'semantic_diff'])
export type SignalName = z.infer<typeof SignalNameSchema>

export const PerBreakingChangeScoreSchema = z.object({
  symbol: z.string(),
  score: z.number().min(0).max(100),
  signalsAgreeing: z.array(SignalNameSchema),
  tag: z.string().optional(),
})
export type PerBreakingChangeScore = z.infer<typeof PerBreakingChangeScoreSchema>

export const PerPatchedFileScoreSchema = z.object({
  path: z.string(),
  score: z.number().min(0).max(100),
  reductions: z.array(z.object({ reason: z.string(), delta: z.number() })),
})
export type PerPatchedFileScore = z.infer<typeof PerPatchedFileScoreSchema>

export const AnalysisCoverageSchema = z.object({
  symbolsAnalyzed: z.number().int().min(0),
  symbolsTotal: z.number().int().min(0),
  percentCovered: z.number().min(0).max(100),
  // v2.2 / F23a — `'griffe'` is honest tier for Python (peer of 'dts').
  // Kept here in lockstep with AnalysisTierSchema in signals/semantic-diff.ts.
  // `'none'` is this enum's own extra — fires when no diff ran at all.
  analysisTier: z.enum(['dts', 'griffe', 'api-extractor', 'ast-only', 'none']),
  notAnalyzed: z.array(z.object({ symbol: z.string(), reason: z.string() })),
})
export type AnalysisCoverage = z.infer<typeof AnalysisCoverageSchema>

export const ConfidenceScoreSchema = z.object({
  overall: z.number().min(0).max(100),
  bucket: ConfidenceBucketSchema,
  perBreakingChange: z.array(PerBreakingChangeScoreSchema),
  perPatchedFile: z.array(PerPatchedFileScoreSchema),
  analysisCoverage: AnalysisCoverageSchema,
  /** True if verification failure capped the overall to 50. */
  verificationCapped: z.boolean(),
  /**
   * v2.0 / F20 — True iff smoke (Phase C) was ATTEMPTED and DIDN'T boot,
   * capping the overall to 50. Defaults false (omitted in old data → false
   * via Zod default — no calibration shift on legacy scans).
   */
  smokeCapped: z.boolean().default(false),
})
export type ConfidenceScore = z.infer<typeof ConfidenceScoreSchema>

/* ─── Scoring constants (TRD §9.5 ranges → deterministic mid-points) ──────── */

/**
 * Mid-point of each range. Deterministic so the same inputs always produce
 * the same score (no random noise per CLAUDE.md §5b honesty).
 */
const SCORE = {
  bothAgree:                   90, // 85–95
  semanticOnly:                70, // 65–75
  changelogOnlyHighCoverage:   48, // 40–55
  changelogOnlyLowCoverage:    60, // 55–65
  singleSignalOnly:            60, // 55–65
  heuristicMatch:              38, // 30–45
} as const

const COVERAGE_HIGH_THRESHOLD = 80

const BUCKET_HIGH = 80
const BUCKET_MEDIUM = 60

const VERIFY_FAIL_CAP = 50

const DEFAULT_FILE_BASELINE = 80

/* ─── Per-breaking-change scoring ─────────────────────────────────────────── */

/**
 * Gather the set of symbols that EITHER signal flagged. Returns a map from
 * symbol → { inChangelog, inSemantic } so we can iterate scenarios cleanly.
 */
function symbolMatrix(
  breakingChanges: BreakingChange[],
  semanticDiff: SemanticDiff | null,
): Map<string, { inChangelog: boolean; inSemantic: boolean }> {
  const matrix = new Map<string, { inChangelog: boolean; inSemantic: boolean }>()

  for (const bc of breakingChanges) {
    matrix.set(bc.symbol, { inChangelog: true, inSemantic: false })
  }

  if (semanticDiff) {
    const semanticSymbols = new Set<string>([
      ...semanticDiff.removedExports,
      ...semanticDiff.signatureChanges.map((s) => s.symbol),
      ...semanticDiff.newDeprecations,
    ])
    for (const sym of semanticSymbols) {
      const existing = matrix.get(sym)
      if (existing) existing.inSemantic = true
      else matrix.set(sym, { inChangelog: false, inSemantic: true })
    }
  }

  return matrix
}

/**
 * Score a single symbol per TRD §9.5 asymmetric table.
 */
function scoreSymbol(
  symbol: string,
  inChangelog: boolean,
  inSemantic: boolean,
  semanticAvailable: boolean,
  coverage: number,
): PerBreakingChangeScore {
  const signalsAgreeing: SignalName[] = []
  if (inChangelog) signalsAgreeing.push('changelog')
  if (inSemantic) signalsAgreeing.push('semantic_diff')

  // Case 1: both signals flag it → high agreement
  if (inChangelog && inSemantic) {
    return { symbol, score: SCORE.bothAgree, signalsAgreeing }
  }

  // Case 2: semantic-diff caught it, changelog silent → undocumented
  if (!inChangelog && inSemantic) {
    return {
      symbol,
      score: SCORE.semanticOnly,
      signalsAgreeing,
      tag: 'undocumented breaking change',
    }
  }

  // Case 3+4+5: changelog flagged, semantic-diff silent OR unavailable
  if (inChangelog && !inSemantic) {
    if (!semanticAvailable) {
      // Signal B not runnable at all (network fail, no .d.ts AND no .js, etc.)
      return {
        symbol,
        score: SCORE.singleSignalOnly,
        signalsAgreeing,
        tag: 'single-signal',
      }
    }
    if (coverage >= COVERAGE_HIGH_THRESHOLD) {
      // Semantic-diff RAN with good coverage and didn't confirm — that's a
      // real disagreement. Lowest of the lot.
      return {
        symbol,
        score: SCORE.changelogOnlyHighCoverage,
        signalsAgreeing,
        tag: 'needs manual verification',
      }
    }
    // Semantic-diff ran but coverage was low (JS-only or partial)
    return {
      symbol,
      score: SCORE.changelogOnlyLowCoverage,
      signalsAgreeing,
      tag: 'incomplete analysis',
    }
  }

  // Case 6: neither signal flagged it (heuristic — shouldn't normally hit
  // here unless caller injects a symbol from somewhere else, e.g. failing
  // verification flagged an export name).
  return {
    symbol,
    score: SCORE.heuristicMatch,
    signalsAgreeing,
  }
}

/* ─── Per-patched-file scoring ────────────────────────────────────────────── */

/**
 * Per-file baseline + reductions per TRD §9.5. We only apply reductions
 * we can ACTUALLY detect from current data (no test-coverage data + no
 * line-diff metadata for v1.0-style full-file patches, so most files
 * land at baseline 80). Future iterations will add:
 *   - "patch touches uncovered lines" (needs ts-coverage input)
 *   - "behavioral changes" (needs runtime testing)
 *   - "< 5 lines changed" (needs real line diffs from search-replace patches)
 */
function scorePatchedFile(filePath: string): PerPatchedFileScore {
  return {
    path: filePath,
    score: DEFAULT_FILE_BASELINE,
    reductions: [],
  }
}

/* ─── Overall + bucket ────────────────────────────────────────────────────── */

function bucketFromScore(score: number): ConfidenceBucket {
  if (score >= BUCKET_HIGH) return 'high'
  if (score >= BUCKET_MEDIUM) return 'medium'
  return 'low'
}

function weightedAverage(items: number[]): number {
  if (items.length === 0) return 0
  const sum = items.reduce((a, b) => a + b, 0)
  return Math.round(sum / items.length)
}

/* ─── Public entry ────────────────────────────────────────────────────────── */

export interface CalculateConfidenceInput {
  breakingChanges: BreakingChange[]
  semanticDiff: SemanticDiff | null
  patchedFilePaths: string[]
  verificationPassed: boolean
  /**
   * v2.0 / F20 — Phase C (smoke) outcome:
   *   - `null` or omitted → smoke was NOT attempted (legacy scans, smoke
   *     disabled, no boot command detected). No cap applied — calibration
   *     is unchanged from v1.5 for scans that don't smoke.
   *   - `true` → smoke RAN and the app booted. No cap, score per signals.
   *   - `false` → smoke RAN and the app did NOT boot. Caps overall at 50
   *     (same VERIFY_FAIL_CAP) — boot failure is honest evidence the patch
   *     broke the app. CLAUDE.md §5b rule 7 extended.
   */
  smokePassed?: boolean | null
  /**
   * v2.2 / F23a — language-aware ceiling per CLAUDE.md §5b v2 rule 1
   * ("confidence ceilings are language-aware and disclosed"). The adapter
   * declares its analyzer's maximum reachable bucket; this clamp ensures a
   * weaker analyzer cannot produce a stronger bucket than its fidelity
   * justifies. Omitted = no clamp (legacy TS pre-F23 + bench tests).
   *
   * Honest examples:
   *   - rust adapter → 'medium' (cargo-semver-checks is public-API-only)
   *   - python/typescript/go → 'high' (declaration-walking analyzers)
   *
   * Clamp is applied AFTER all other rules including the verify/smoke caps.
   */
  maxBucket?: ConfidenceBucket
}

/**
 * Produce a calibrated ConfidenceScore from collected signals + verification.
 *
 * Deterministic: same inputs → same output bytes (sorted internal ordering).
 */
export function calculateConfidence(input: CalculateConfidenceInput): ConfidenceScore {
  const { breakingChanges, semanticDiff, patchedFilePaths, verificationPassed, smokePassed, maxBucket } = input
  const semanticAvailable = semanticDiff !== null

  // Coverage info: from semantic-diff if present, else zero/none.
  const coverage: AnalysisCoverage = semanticDiff
    ? {
        symbolsAnalyzed: Math.max(0, Math.round((semanticDiff.coveragePercent / 100) * estimateSymbolTotal(semanticDiff))),
        symbolsTotal: estimateSymbolTotal(semanticDiff),
        percentCovered: semanticDiff.coveragePercent,
        analysisTier: semanticDiff.analysisTier,
        notAnalyzed: semanticDiff.unanalyzableSymbols,
      }
    : {
        symbolsAnalyzed: 0,
        symbolsTotal: 0,
        percentCovered: 0,
        analysisTier: 'none' as const,
        notAnalyzed: [{ symbol: '*', reason: 'semantic-diff signal did not run' }],
      }

  // Per-symbol scoring across the union of (changelog ∪ semantic) symbols.
  const matrix = symbolMatrix(breakingChanges, semanticDiff)
  const perBreakingChange: PerBreakingChangeScore[] = []
  for (const [symbol, flags] of matrix) {
    perBreakingChange.push(
      scoreSymbol(symbol, flags.inChangelog, flags.inSemantic, semanticAvailable, coverage.percentCovered),
    )
  }
  perBreakingChange.sort((a, b) => a.symbol.localeCompare(b.symbol))

  const perPatchedFile = patchedFilePaths.map(scorePatchedFile)
  perPatchedFile.sort((a, b) => a.path.localeCompare(b.path))

  // Overall: weighted average of per-breaking-change scores. If there are
  // no flagged symbols at all (no breaking changes detected), default to
  // a "version-bump-only" baseline of 75 — still requires review but no
  // concrete breakage was found by either signal.
  const baseScore =
    perBreakingChange.length > 0
      ? weightedAverage(perBreakingChange.map((p) => p.score))
      : 75

  // v2.0 / F20 — smoke (Phase C) cap. `smokePassed=false` means smoke RAN
  // and the app did NOT boot — same honesty class as "tests failed," so we
  // apply the same cap. `null`/omitted = not attempted = no cap (legacy).
  const smokeFailed = smokePassed === false
  const verificationCapped = !verificationPassed && baseScore > VERIFY_FAIL_CAP
  const smokeCapped = smokeFailed && baseScore > VERIFY_FAIL_CAP
  const scoreAfterCaps = (verificationCapped || smokeCapped) ? VERIFY_FAIL_CAP : baseScore
  const bucketAfterCaps = bucketFromScore(scoreAfterCaps)

  // v2.2 / F23a — language-aware ceiling. The adapter's `maxBucket`
  // clamps the FINAL bucket; the score is also clamped to the ceiling's
  // top of band so the UI doesn't show e.g. "85/100 medium" (which would
  // misrepresent the underlying analyzer fidelity). CLAUDE.md §5b v2 r1.
  const { bucket, overall } = clampToMaxBucket(bucketAfterCaps, scoreAfterCaps, maxBucket)

  return ConfidenceScoreSchema.parse({
    overall,
    bucket,
    perBreakingChange,
    perPatchedFile,
    analysisCoverage: coverage,
    verificationCapped,
    smokeCapped,
  })
}

/**
 * Apply the adapter's per-language ceiling. Returns the clamped pair
 * (overall, bucket). When `maxBucket` is undefined (legacy / bench tests
 * without an adapter), returns the inputs unchanged.
 *
 * Rules:
 *   - maxBucket='high'   → no-op (high is the absolute ceiling already)
 *   - maxBucket='medium' → 'high' downgrades to 'medium' + score capped
 *                          at BUCKET_HIGH - 1 (top of medium band)
 *   - maxBucket='low'    → 'high'/'medium' downgrade to 'low' + score
 *                          capped at BUCKET_MEDIUM - 1 (top of low band)
 *
 * Score clamp is at the top of the destination band (not floor), so a
 * strong-signal scan whose adapter caps at medium still sees a high
 * NUMERIC score (e.g. 79) — the bucket is the binding ceiling, the
 * numeric score reflects within-band strength.
 */
function clampToMaxBucket(
  bucket: ConfidenceBucket,
  overall: number,
  maxBucket: ConfidenceBucket | undefined,
): { bucket: ConfidenceBucket; overall: number } {
  if (!maxBucket || maxBucket === 'high') return { bucket, overall }
  if (maxBucket === 'medium' && bucket === 'high') {
    return { bucket: 'medium', overall: Math.min(overall, BUCKET_HIGH - 1) }
  }
  if (maxBucket === 'low' && bucket !== 'low') {
    return { bucket: 'low', overall: Math.min(overall, BUCKET_MEDIUM - 1) }
  }
  return { bucket, overall }
}

/**
 * Rough estimate of the OLD version's total exported symbol count. The
 * semantic-diff signal currently surfaces percentCovered + the unanalyzable
 * list but not the total count directly. We back-derive it.
 */
function estimateSymbolTotal(sd: SemanticDiff): number {
  if (sd.coveragePercent <= 0) return sd.unanalyzableSymbols.length
  // percentCovered = (analyzed / total) * 100  →  total = unanalyzable / (1 - covered)
  const uncov = sd.unanalyzableSymbols.length
  if (sd.coveragePercent >= 100) {
    // 100% covered + N unanalyzable → unanalyzable was outside the analyzed set
    return uncov
  }
  const uncoveredFraction = 1 - sd.coveragePercent / 100
  if (uncoveredFraction <= 0) return uncov
  return Math.max(uncov, Math.round(uncov / uncoveredFraction))
}

/* ─── Test-only exports ───────────────────────────────────────────────────── */

export const __testing = {
  bucketFromScore,
  symbolMatrix,
  scoreSymbol,
  estimateSymbolTotal,
  SCORE,
  COVERAGE_HIGH_THRESHOLD,
  BUCKET_HIGH,
  BUCKET_MEDIUM,
  VERIFY_FAIL_CAP,
}
