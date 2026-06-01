/**
 * "Point at any API" — inspect mode (v2.1 / F22).
 *
 * Pure orchestration of the existing signal pipeline (changelog +
 * semantic-diff) + the existing scoring lib, but with NO clone, NO repo
 * context, NO sandbox, NO patch, NO PR. The output is a shareable
 * breaking-change report — analogous to "paste an npm package, see what
 * breaks." V2_PLAN.md §F22.
 *
 * **Why this exists, briefly.** A scan answers "should I upgrade THIS
 * dep in THIS repo?" — needs a repo, sandbox, verification. An
 * inspection answers "does the upgrade between X.Y.Z and A.B.C of
 * package P introduce breaking changes at all?" — pure library analysis.
 * Cheap, offline-ish (only hits npm registry + GitHub for release notes),
 * fast (~1–2 s), perfect for a permalinkable case-study artifact.
 *
 * Honesty rules (CLAUDE.md §5b, V2_PLAN §F22 "structural cap"):
 *   - Inspect mode CANNOT show high confidence. Without verification AND
 *     without a repo's affected-sites context, "high" would be a lie.
 *     We post-clamp the overall to ≤ 79 → bucket ≤ medium. v1.0's
 *     amber-only rule, recast.
 *   - The `structuralCap` field documents WHY the score is capped so
 *     consumers (the report UI, the permalink page) can render an
 *     explicit "report-only" badge instead of leaving users guessing.
 *   - Any signal that fails (e.g. changelog without a PAT, semantic-diff
 *     when the package has no published tarball) lands in `errors[]`
 *     verbatim. §5b: never silently swallow a missing signal.
 *
 * No DB writes here. Persistence is the API route's job — keeps this
 * function easy to unit-test, easy to call from a future MCP tool
 * (v2.4 / F26), and free of side effects.
 */

import { parseBreakingChanges, type BreakingChange } from './signals/changelog'
import {
  parseSemanticDiff,
  type SemanticDiff,
} from './signals/semantic-diff'
import {
  calculateConfidence,
  type ConfidenceScore,
} from './confidence/score'

// ── Public types ──────────────────────────────────────────────────────────────

/** Structural cap reasons — surfaced so the UI can label honestly. */
export type StructuralCap = null | 'medium-ceiling-no-verify'

/** What inspect mode emits — same shape regardless of permalink vs. live. */
export interface ApiReport {
  packageName: string
  fromVersion: string
  toVersion: string
  /** ISO 8601 wall-clock when the analysis completed. */
  generatedAt: string
  /** Changelog signal — empty when no GitHub release notes were reachable. */
  breakingChanges: BreakingChange[]
  /**
   * Semantic-diff signal — null when both versions' tarballs couldn't be
   * fetched/extracted. Distinct from "signal ran and found nothing" (which
   * shows up as a valid SemanticDiff with empty removed/changed lists).
   */
  semanticDiff: SemanticDiff | null
  /**
   * Calibrated score from the existing scorer, then structurally capped at
   * medium per V2_PLAN §F22. `confidence.verificationCapped` will be true
   * iff the cap fired (overall would have been > 79 without it).
   */
  confidence: ConfidenceScore
  /** When set, the consumer renders an explicit "report-only" badge. */
  structuralCap: StructuralCap
  /**
   * Per-signal errors. Empty on the clean path. Honest about which signal
   * fell over (e.g. "changelog: no GitHub repo in npm registry metadata").
   */
  errors: string[]
}

export interface InspectInput {
  packageName: string
  fromVersion: string
  toVersion: string
  /**
   * Optional GitHub PAT. The changelog signal walks releases via the
   * GitHub API; without a PAT we can still try the unauthenticated path
   * but rate limits hit hard. Caller is responsible for PAT lifecycle
   * (decryption, never logging it — same rules as scans).
   */
  pat?: string
}

// ── Internal: structural cap ──────────────────────────────────────────────────

/**
 * Pure clamp: take a ConfidenceScore and force the overall ≤ 79 + bucket
 * ≤ medium, recording WHY in the returned `structuralCap`. Exported for
 * unit-testing without going through the whole pipeline.
 */
export function applyInspectStructuralCap(
  score: ConfidenceScore,
): { capped: ConfidenceScore; structuralCap: StructuralCap } {
  // 79 is the top of the "medium" bucket (BUCKET_HIGH is 80). Clamping at
  // 79 keeps the visual bucket honest without over-penalizing borderline
  // signals.
  const MEDIUM_CEILING = 79
  if (score.overall <= MEDIUM_CEILING && score.bucket !== 'high') {
    return { capped: score, structuralCap: null }
  }
  return {
    capped: {
      ...score,
      overall: Math.min(score.overall, MEDIUM_CEILING),
      bucket: 'medium',
      verificationCapped: true, // flag REUSED — the UI label is driven by structuralCap
    },
    structuralCap: 'medium-ceiling-no-verify',
  }
}

// ── Public entry — inspectApi ────────────────────────────────────────────────

/**
 * Run the two-signal pipeline against a package + version pair and emit a
 * structurally-capped ApiReport. Both signals run in parallel; either can
 * fail without taking the other down. Output is deterministic given the
 * same npm/GitHub responses (the scorer is already deterministic; we sort
 * the error list).
 */
export async function inspectApi(input: InspectInput): Promise<ApiReport> {
  const { packageName, fromVersion, toVersion } = input
  const errors: string[] = []

  // The two signals are independent network ops — run them in parallel
  // and catch per-signal failures so one doesn't drag down the other.
  const [breakingChanges, semanticDiff] = await Promise.all([
    (async () => {
      // parseBreakingChanges needs a PAT for the GitHub API. Without one
      // we honest-skip — anonymous GitHub is rate-limited to 60/hr and
      // would silently fail mid-walk.
      if (!input.pat) {
        errors.push('changelog: signal skipped (no GitHub PAT supplied — anonymous rate limit too tight)')
        return [] as BreakingChange[]
      }
      try {
        return await parseBreakingChanges(packageName, fromVersion, toVersion, input.pat)
      } catch (err) {
        errors.push(`changelog: ${trimError(err)}`)
        return [] as BreakingChange[]
      }
    })(),
    (async () => {
      try {
        // No refIndex — inspect mode has NO repo, so affectedSitesInRepo
        // is structurally [] (the report carries this in "Not Analyzed").
        return await parseSemanticDiff(packageName, fromVersion, toVersion)
      } catch (err) {
        errors.push(`semantic-diff: ${trimError(err)}`)
        return null as SemanticDiff | null
      }
    })(),
  ])

  // Score using the existing calibrated pipeline. Inspect mode "verifies
  // nothing" — we cannot claim verification passed, but we also can't
  // claim a fail (no Phase B ran). Pass verificationPassed=true to avoid
  // the VERIFY_FAIL_CAP=50 penalty + then APPLY the structural cap below.
  // The structuralCap is the honest message — verificationCapped is the
  // flag the existing UI components already understand.
  const baseScore = calculateConfidence({
    breakingChanges,
    semanticDiff,
    patchedFilePaths: [], // no patches — pure report
    verificationPassed: true,
  })
  const { capped, structuralCap } = applyInspectStructuralCap(baseScore)

  // Sort errors so two runs with the same inputs + same failures produce
  // byte-identical reports (eval-bench parity + permalink determinism).
  errors.sort()

  return {
    packageName,
    fromVersion,
    toVersion,
    generatedAt: new Date().toISOString(),
    breakingChanges,
    semanticDiff,
    confidence: capped,
    structuralCap,
    errors,
  }
}

function trimError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.slice(0, 200)
}
