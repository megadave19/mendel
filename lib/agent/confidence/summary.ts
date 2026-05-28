/**
 * v1.5 Workstream #6 — Scan-level confidence summary.
 *
 * Aggregates per-issue calibrated scores into a single shape the dashboard
 * can render without re-parsing every issue blob. Persisted on Scan.
 *
 * Honest framing (CLAUDE.md §5b):
 *   - When NO issues have calibrated data (v1.0 stub only), the summary
 *     returns null — the dashboard panel renders an "no calibration data
 *     yet" empty state rather than fabricating zeros.
 *   - `hasCalibratedData` is the boolean the UI uses to decide "show
 *     numbers" vs "show empty state".
 */

import { z } from 'zod'
import type { Issue } from '@prisma/client'
import { parseConfidenceBlob } from '@/lib/agent/issue-vm'

export const BucketCountsSchema = z.object({
  high: z.number().int().min(0),
  medium: z.number().int().min(0),
  low: z.number().int().min(0),
})

export const TierCountsSchema = z.object({
  dts: z.number().int().min(0),
  'api-extractor': z.number().int().min(0),
  'ast-only': z.number().int().min(0),
  none: z.number().int().min(0),
})

export const ScanConfidenceSummarySchema = z.object({
  /** True if at least one issue had a calibrated ConfidenceScore. */
  hasCalibratedData: z.boolean(),
  /** Average overall score across calibrated issues. 0 when none. */
  avgScore: z.number().min(0).max(100),
  /** Count of calibrated issues per bucket. Sums to issuesCalibrated. */
  bucketCounts: BucketCountsSchema,
  /** Count of calibrated issues per analysis tier. */
  tierCounts: TierCountsSchema,
  /** Total issues considered (calibrated only — stub issues are not counted). */
  issuesCalibrated: z.number().int().min(0),
  /** Total issues including stub (used to surface "X of Y issues calibrated"). */
  issuesTotal: z.number().int().min(0),
  /** Proportion of calibrated issues whose verification did not pass. 0–1. */
  verificationFailureRate: z.number().min(0).max(1),
  /** Proportion of calibrated issues whose score was capped by verify failure. 0–1. */
  cappedRate: z.number().min(0).max(1),
})
export type ScanConfidenceSummary = z.infer<typeof ScanConfidenceSummarySchema>

/**
 * Summarize the confidence data on a scan's issues.
 *
 * Returns null when no issues exist at all (vs an empty calibrated-data
 * summary when issues exist but none were scored). This lets the dashboard
 * distinguish "scan with 0 issues" from "scan with v1.0 stub issues".
 */
export function summarizeScanConfidence(issues: Pick<Issue, 'confidence' | 'verification'>[]): ScanConfidenceSummary | null {
  if (issues.length === 0) return null

  let total = 0
  let calibrated = 0
  let sumScore = 0
  const bucketCounts = { high: 0, medium: 0, low: 0 }
  const tierCounts = { dts: 0, 'api-extractor': 0, 'ast-only': 0, none: 0 }
  let verificationFailed = 0
  let cappedCount = 0

  for (const issue of issues) {
    total++
    const parsed = parseConfidenceBlob(issue.confidence)
    if (parsed.kind !== 'score') continue
    calibrated++
    sumScore += parsed.value.overall
    bucketCounts[parsed.value.bucket]++
    tierCounts[parsed.value.analysisCoverage.analysisTier]++
    if (parsed.value.verificationCapped) cappedCount++

    // Verification result is on its own column (JSON-stringified). Parse it
    // here so the summary captures "regression rate" independently of the
    // confidence cap (which only fires when score would have been > 50).
    try {
      const v = JSON.parse(issue.verification ?? '{}') as { passed?: boolean }
      if (v.passed === false) verificationFailed++
    } catch {
      /* malformed verification blob — skip */
    }
  }

  return ScanConfidenceSummarySchema.parse({
    hasCalibratedData: calibrated > 0,
    avgScore: calibrated > 0 ? Math.round(sumScore / calibrated) : 0,
    bucketCounts,
    tierCounts,
    issuesCalibrated: calibrated,
    issuesTotal: total,
    verificationFailureRate: calibrated > 0 ? verificationFailed / calibrated : 0,
    cappedRate: calibrated > 0 ? cappedCount / calibrated : 0,
  })
}

/** Safe JSON parser for the Scan.confidenceSummary column. Used by the API. */
export function parseScanConfidenceSummary(raw: string | null | undefined): ScanConfidenceSummary | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    const parsed = ScanConfidenceSummarySchema.safeParse(obj)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
