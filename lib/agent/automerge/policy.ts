/**
 * v2.3 / F24 — Auto-merge policy (the §5c "Honesty-of-Action floor").
 *
 * **THE BAR TO ACT IS STRICTLY HIGHER THAN THE BAR TO SUGGEST.** CLAUDE.md
 * §5b governs how the agent FRAMES what it knows; §5c governs whether the
 * agent may ACT on what it knows. Auto-merge is the canonical act —
 * irreversible (the PR closes, the commit lands on the user's repo, the
 * deploy pipeline triggers downstream). The envelope below MUST hold
 * for every successful auto-merge. Every NO reason is logged. No silent
 * action, no silent skip.
 *
 * **This file is a PURE function** — no IO, no clock, no DB. The runner
 * gathers inputs from the scan, the GitHub PAT, the RepoSetting row,
 * and the rejection store; calls `evaluateAutoMerge`; then logs the
 * verdict + every reason to AgentLog before either calling
 * `octokit.pulls.merge` or moving on. Keeping this layer pure means:
 *   1. Boundary tests can pin every §5c rule exhaustively
 *   2. The runner can't accidentally relax the envelope (anti-gaming,
 *      §5c rule 7) — the policy reads only what it's handed
 *   3. v3 (cloud / multi-tenant) reuses this layer unchanged
 */

import type { ConfidenceBucket } from '@/lib/agent/confidence/score'

// ── Inputs the policy needs to enforce the full §5c envelope ─────────────────

export type VersionBumpKind = 'patch' | 'minor' | 'major' | 'prerelease' | 'unknown'

/**
 * One-line semver-like classifier — narrow enough that the auto-merge
 * gate can route on it. Returns:
 *   - 'major'      — leading non-zero number changed (1.x → 2.x), OR
 *                    the leading zero changed for 0.x → 1.x bumps
 *                    (the semver convention that 0.x carries no
 *                    stability guarantees and any 0.x → other-version
 *                    bump is potentially-major)
 *   - 'minor'      — second component changed (1.2.x → 1.3.x)
 *   - 'patch'      — third component changed (1.2.3 → 1.2.4)
 *   - 'prerelease' — either side carries a `-suffix` (1.2.3 vs 1.2.3-rc.1)
 *   - 'unknown'    — unparseable on either side (non-numeric, missing
 *                    components, etc.). Auto-merge rejects 'unknown'
 *                    on the safe side: §5c rule 2 narrow allowlist.
 *
 * **Honest treatment of 0.x:** Cargo, npm, Go modules, and pip all
 * follow semver in spirit; semver §4 says "Major version zero (0.y.z)
 * is for initial development. Anything MAY change at any time."
 * Mendel therefore treats EVERY 0.x bump as 'major' for the auto-merge
 * gate, even when the numeric movement is in the second slot. This is
 * a deliberate conservative choice that aligns with §5c rule 7
 * (never relax the envelope).
 */
export function classifyVersionBump(from: string, to: string): VersionBumpKind {
  if (from === to) return 'patch' // edge case: identity bump (shouldn't happen but harmless)

  // Strip a leading `v` (Go module convention) so semver parts align.
  const stripV = (v: string) => (v.startsWith('v') ? v.slice(1) : v)
  const a = stripV(from)
  const b = stripV(to)

  // Pre-release detection. Either side has a `-suffix` ATTACHED to a
  // valid semver base → 'prerelease'. Per semver §11 a pre-release is
  // a separate channel and any bump involving one is too unstable for
  // the auto-merge gate.
  //
  // Naïve `.includes('-')` would mis-classify garbage strings like
  // `not-a-version` as 'prerelease' (the dash is incidental). Caught
  // by the unknown-input test before merge; fix is to require the
  // base before `-` to parse as a real semver triple.
  const semverRe = /^(\d+)\.(\d+)\.(\d+)$/
  const baseOf = (v: string) => v.split('-')[0]
  if ((a.includes('-') && semverRe.test(baseOf(a))) || (b.includes('-') && semverRe.test(baseOf(b)))) {
    return 'prerelease'
  }

  // Parse `major.minor.patch`. Anything that doesn't match → 'unknown'.
  const ma = semverRe.exec(a)
  const mb = semverRe.exec(b)
  if (!ma || !mb) return 'unknown'
  const [, aMaj, aMin, aPat] = ma
  const [, bMaj, bMin, bPat] = mb

  // 0.x conservative rule. semver §4: "Anything MAY change at any time."
  // We treat ANY change while the leading zero is in play as 'major'.
  // This protects auto-merge from acting on a 0.2.0 → 0.3.0 "minor"
  // that's really a public-API redesign in disguise (the standard
  // 0.x convention).
  if (aMaj === '0' || bMaj === '0') {
    if (aMaj !== bMaj || aMin !== bMin || aPat !== bPat) return 'major'
    return 'patch'
  }

  if (aMaj !== bMaj) return 'major'
  if (aMin !== bMin) return 'minor'
  if (aPat !== bPat) return 'patch'
  return 'patch'
}

/**
 * All the §5c envelope inputs in one struct. The runner gathers each
 * field from a specific source (named in the comment); the policy
 * NEVER reaches outside this struct.
 */
export interface AutoMergeInput {
  // ─── §5c rule 1 — opt-in, default OFF; PAT must have merge rights ──
  /** RepoSetting row for this repo. Null = no row exists = implicitly disabled. */
  setting: {
    autoMergeEnabled: boolean
    autoMergeConfidenceFloor: number
  } | null
  /** True iff the encrypted PAT carries the `repo` scope's merge permission
   *  on this specific repo (already-shipped capability check in submit.ts). */
  patHasMergeRights: boolean

  // ─── §5c rule 2 — narrow category allowlist ────────────────────────
  /** Semver classification of the bump being merged. */
  versionBumpKind: VersionBumpKind
  /** Breaking-change count from the changelog signal. */
  changelogBreakingChanges: number
  /** Breaking-change count from the semantic-diff signal.
   *  null = signal did not run (honestly excluded from auto-merge per §5c). */
  semanticDiffBreakingChanges: number | null
  /** True iff the two signals AGREE on the breaking-change set (per
   *  §5c rule 2 "signals agree" — disagreement disqualifies auto-merge). */
  signalsAgree: boolean

  // ─── §5c rule 3 — high confidence floor ────────────────────────────
  /** Calibrated overall + bucket. */
  confidence: { overall: number; bucket: ConfidenceBucket }
  /** The standard threshold (the §5b PR-promotion threshold). The
   *  effective floor for auto-merge is hard-clamped ≥ this. */
  threshold: number

  // ─── §5c rule 4 — tests AND smoke pass ─────────────────────────────
  /** Phase B (verification) result. */
  verificationPassed: boolean
  /** Phase C (smoke / F20) result. null = smoke not attempted.
   *  §5c rule 4 + F20-as-hard-dependency: null is treated as NO. */
  smokePassed: boolean | null

  // ─── §5c rule 5 — no rejection history ─────────────────────────────
  /** True iff the rejection store has at least one prior pattern for
   *  this (depName, changeType) combo. */
  hasRejectionHistory: boolean
}

/**
 * The auto-merge verdict.
 *
 * **`reasons` is ALL applicable NO reasons, not the first one.** The
 * runner logs every reason to AgentLog so a future investigation can
 * see exactly which §5c rules the case violated. Anti-gaming pattern:
 * an op who "fixes" one reason still sees the others stacked, so
 * they can't iteratively flip the envelope open one bit at a time.
 */
export interface AutoMergeVerdict {
  shouldMerge: boolean
  reasons: string[]
}

/** The hard floor — anti-gaming per §5c rule 7. The RepoSetting may
 *  store a lower floor (UI surface), but the effective floor is the
 *  MAX of the configured value and this constant. */
export const AUTO_MERGE_HARD_FLOOR = 90

/**
 * Run the §5c envelope. Pure: deterministic; no clock, no IO. The
 * reasons array is ordered by rule number so the AgentLog reads
 * top-down through §5c.
 */
export function evaluateAutoMerge(input: AutoMergeInput): AutoMergeVerdict {
  const reasons: string[] = []

  // ── §5c rule 1: opt-in + PAT merge rights ───────────────────────────
  if (!input.setting || !input.setting.autoMergeEnabled) {
    reasons.push('§5c r1: auto-merge not enabled for this repo (default OFF)')
  }
  if (!input.patHasMergeRights) {
    reasons.push('§5c r1: PAT lacks merge permission on this repo')
  }

  // ── §5c rule 2: narrow category allowlist + no break + signals agree ─
  if (input.versionBumpKind !== 'patch' && input.versionBumpKind !== 'minor') {
    reasons.push(
      `§5c r2: version bump kind '${input.versionBumpKind}' is not in allowlist (only patch/minor)`,
    )
  }
  if (input.changelogBreakingChanges > 0) {
    reasons.push(
      `§5c r2: changelog signal flagged ${input.changelogBreakingChanges} breaking change(s)`,
    )
  }
  if (input.semanticDiffBreakingChanges === null) {
    reasons.push('§5c r2: semantic-diff signal did not run — cannot confirm signals agree')
  } else if (input.semanticDiffBreakingChanges > 0) {
    reasons.push(
      `§5c r2: semantic-diff signal flagged ${input.semanticDiffBreakingChanges} breaking change(s)`,
    )
  }
  if (!input.signalsAgree) {
    reasons.push('§5c r2: signals disagree — auto-merge requires agreement')
  }

  // ── §5c rule 3: high confidence floor (hard-clamped ≥ threshold) ────
  // Anti-gaming (§5c rule 7): the effective floor is MAX(configured, hard-floor,
  // standard threshold). A misconfigured low floor in RepoSetting can't
  // unlock auto-merge.
  const configuredFloor = input.setting?.autoMergeConfidenceFloor ?? AUTO_MERGE_HARD_FLOOR
  const effectiveFloor = Math.max(configuredFloor, AUTO_MERGE_HARD_FLOOR, input.threshold)
  if (input.confidence.overall < effectiveFloor) {
    reasons.push(
      `§5c r3: confidence ${input.confidence.overall}/100 below effective floor ${effectiveFloor} ` +
        `(configured=${configuredFloor}, hard-floor=${AUTO_MERGE_HARD_FLOOR}, threshold=${input.threshold})`,
    )
  }
  if (input.confidence.bucket !== 'high') {
    reasons.push(
      `§5c r3: confidence bucket '${input.confidence.bucket}' is not 'high' ` +
        `(language-aware ceilings can prevent 'high' even with a passing numeric score — that's honest)`,
    )
  }

  // ── §5c rule 4: tests AND smoke pass (F20 hard-dependency) ──────────
  if (!input.verificationPassed) {
    reasons.push('§5c r4: verification (Phase B / tests) did not pass')
  }
  if (input.smokePassed === null) {
    reasons.push('§5c r4: smoke (Phase C / F20) was not attempted — auto-merge requires a passing smoke')
  } else if (input.smokePassed === false) {
    reasons.push('§5c r4: smoke (Phase C / F20) did not pass — the app failed to boot post-patch')
  }

  // ── §5c rule 5: no rejection history for this dep + change kind ─────
  if (input.hasRejectionHistory) {
    reasons.push(
      '§5c r5: rejection history exists for this dep + change kind — a prior PR was closed/rejected',
    )
  }

  return {
    shouldMerge: reasons.length === 0,
    reasons,
  }
}
