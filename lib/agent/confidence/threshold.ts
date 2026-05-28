/**
 * Threshold-gated PR submission (v1.5 Workstream #3) — TRD §9.5 + CLAUDE.md §5b.
 *
 * Pure decision logic — does NOT submit PRs. Consumed by the runner's SUBMIT
 * phase. Three outcomes:
 *
 *   - Score ≥ user threshold (default 70)  → 'standard'  → open non-Draft PR
 *   - 40 ≤ score < threshold              → 'draft'     → open Draft PR with warning
 *   - score < 40                          → 'skip'      → no auto-PR, diagnosis only
 *
 * Verification cap is already baked into score.overall by `calculateConfidence`
 * (TRD §9.5: verification fail caps at 50 → forces 'low' bucket → naturally
 * lands in the 40-threshold range with default settings).
 *
 * CLAUDE.md §5b honesty: this gate is MANDATORY. We never bypass it to "ship
 * more PRs." Score below 40 means we genuinely don't trust the result enough
 * to send anything to GitHub — the user still sees the diagnosis in the UI.
 */

import { z } from 'zod'
import type { ConfidenceScore } from './score'

export const SubmissionModeSchema = z.enum(['standard', 'draft', 'skip'])
export type SubmissionMode = z.infer<typeof SubmissionModeSchema>

/** Hard floor — below this, no PR is opened regardless of user threshold. */
export const SUBMISSION_FLOOR = 40
/** Default user threshold for standard (non-Draft) PRs. */
export const DEFAULT_THRESHOLD = 70

export interface ThresholdConfig {
  /** User-configurable threshold for promotion to standard PR. Clamped 40-100. */
  threshold?: number
}

/**
 * Read the active threshold from env, with sane fallback + clamping.
 * Pure: no side effects, can be called many times.
 */
export function resolveThreshold(cfg: ThresholdConfig = {}): number {
  const raw = cfg.threshold ?? Number(process.env.MENDEL_CONFIDENCE_THRESHOLD ?? DEFAULT_THRESHOLD)
  if (!Number.isFinite(raw)) return DEFAULT_THRESHOLD
  // Clamp into [floor, 100]. A threshold below the floor would make the
  // "draft" branch unreachable, which silently breaks the 3-tier rule.
  return Math.max(SUBMISSION_FLOOR, Math.min(100, Math.round(raw)))
}

/**
 * Decide submission mode from score + threshold. Pure function.
 */
export function chooseSubmissionMode(score: ConfidenceScore, cfg: ThresholdConfig = {}): SubmissionMode {
  const threshold = resolveThreshold(cfg)
  if (score.overall >= threshold) return 'standard'
  if (score.overall >= SUBMISSION_FLOOR) return 'draft'
  return 'skip'
}

/**
 * Human-readable reason string — used in runner logs + UI tooltips. Never
 * surface raw enum values to users.
 */
export function explainSubmissionMode(mode: SubmissionMode, score: ConfidenceScore, cfg: ThresholdConfig = {}): string {
  const threshold = resolveThreshold(cfg)
  switch (mode) {
    case 'standard':
      return `Score ${score.overall}/100 ≥ threshold ${threshold} → opening standard PR`
    case 'draft':
      return `Score ${score.overall}/100 is below threshold ${threshold} but ≥ floor ${SUBMISSION_FLOOR} → opening Draft PR with low-confidence warning`
    case 'skip':
      return `Score ${score.overall}/100 is below floor ${SUBMISSION_FLOOR} → no PR will be opened; diagnosis persisted for review`
  }
}
