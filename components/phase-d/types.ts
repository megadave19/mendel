/**
 * Shared types for Phase D running-mode components (S4 Live Console).
 * DESIGN.md §10, §11 S4, §12.
 */

import type { MascotPose } from '@/components/BonesMascot'

/**
 * The work stages shown in the StageLane (DESIGN.md §11 S4).
 * v2.0 / F20: 5th lane `SMOKE` added — after VERIFY, before DONE. The lane
 * only renders when the scan actually attempts a smoke (opt-in); on a scan
 * that didn't smoke, the lane is hidden so v1.5 visuals are unchanged.
 */
export type Stage = 'SCAN' | 'DIAGNOSE' | 'PATCH' | 'VERIFY' | 'SMOKE'

export const STAGES: Stage[] = ['SCAN', 'DIAGNOSE', 'PATCH', 'VERIFY', 'SMOKE']
/** Sub-set without SMOKE — for scans that didn't opt in. */
export const STAGES_NO_SMOKE: Stage[] = ['SCAN', 'DIAGNOSE', 'PATCH', 'VERIFY']

/** Lifecycle phase the console can be in. `done` and `error` are terminal. */
export type Phase = Stage | 'DONE' | 'ERROR'

/** Map a phase to the mascot pose it should drive (DESIGN.md §8 ↔ §11 S4). */
export const PHASE_TO_POSE: Record<Phase, MascotPose> = {
  SCAN: 'scanning',
  DIAGNOSE: 'thinking',
  PATCH: 'patching',
  VERIFY: 'verifying',
  // v2.0 / F20 — DESIGN.md §11b reuses the 'verifying' pose during smoke;
  // no new mascot pose needed (still "checking the patch").
  SMOKE: 'verifying',
  DONE: 'success',
  ERROR: 'error',
}

/** A single streaming log line in the TerminalLog. */
export interface LogLine {
  id: string
  stage: Phase
  text: string
  /** ms since scan start, for the timestamp column. */
  t: number
}

/**
 * v1.5 confidence buckets per TRD §9.5 (≥80 high, 60–79 medium, <60 low).
 * v1.0 scans still surface as `'medium'` via the stub fallback path in
 * `dbIssueToVM` — see CLAUDE.md §5b "never inflate".
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

/**
 * v1.5 — Calibrated confidence detail for an Issue. Optional on IssueVM so
 * v1.0 stub data renders without it (just the bucket label). When present,
 * the UI surfaces the numeric score + per-symbol tags + verification cap.
 */
export interface ConfidenceData {
  bucket: ConfidenceLevel
  /** 0–100. */
  score: number
  /** True if verification failure capped the score at 50 (forces "low"). */
  capped: boolean
  /** Which signal tier produced the analysis (UI shows in tooltip). */
  tier: 'dts' | 'api-extractor' | 'ast-only' | 'none'
  /** 0–100 — proportion of OLD version's symbols we could analyze. */
  coveragePercent: number
  /** Per-symbol scores with optional human-readable tag. Sorted alphabetically. */
  perBreakingChange: Array<{ symbol: string; score: number; tag?: string }>
}

/** A single diff hunk line for the DiffViewer. */
export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'meta'
  text: string
}

/**
 * Issue view model — the shape S5/S6/S7 render. Produced by BOTH the mock driver
 * (D2/D3 demo) and the real scan (mapped from DB Issue + SSE events in D3 wiring),
 * so IssueCard/permalink routes don't care about the source.
 */
export interface IssueVM {
  id: string
  dep: string
  currentVersion: string
  latestVersion: string
  confidence: ConfidenceLevel
  /** Diagnosis: what / why / evidence. */
  what: string
  why: string
  evidence: { label: string; url: string }[]
  /** File patch preview. */
  filePath: string
  diff: DiffLine[]
  /** Explicit "Not Analyzed" disclosures (DESIGN.md §11 S6 trust mechanism). */
  notAnalyzed: string[]
  verificationPassed: boolean
  /** Set once a Draft PR is opened (S7). */
  prUrl?: string
  /**
   * v1.5 — when the persisted confidence column held a calibrated score
   * (not the v1.0 stub), this surfaces the full detail. Null/undefined for
   * v1.0 scans. UI components must accept absence gracefully.
   */
  confidenceData?: ConfidenceData
}
