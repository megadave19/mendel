/**
 * v2.3 / F24 sub-phase 1 — auto-merge policy boundary tests.
 *
 * The whole VALUE of sub-phase 1 is these tests: every §5c envelope
 * rule pinned at the boundary so a future refactor can't silently
 * relax the policy. Each rule has:
 *   - A "passing" case (everything aligns; the gate opens)
 *   - One or more "failing" cases that flip just that rule and
 *     verify the corresponding reason text lands in `reasons`
 *
 * The tests are ALSO an anti-gaming check on the implementation:
 *   - All applicable reasons are returned, not just the first
 *   - The effective floor is MAX(configured, hard-floor, threshold)
 *   - smokePassed === null is treated as NO (not as "we couldn't check")
 *   - 0.x bumps are 'major' even when the second slot moves
 *
 * Per CLAUDE.md §5c: the bar to ACT is strictly higher than the bar
 * to SUGGEST. A policy bug here is the bug class that could ship a
 * silently-incorrect merge into a real OSS repo.
 */

import { describe, it, expect } from 'vitest'
import {
  evaluateAutoMerge,
  classifyVersionBump,
  AUTO_MERGE_HARD_FLOOR,
  type AutoMergeInput,
} from '@/lib/agent/automerge/policy'

// ── Helper: minimal "everything aligns" input ────────────────────────────────
//
// Tests opt-in to failure cases by spreading `passingInput()` and
// flipping ONE field. The chain stays readable: every test names the
// rule it's testing in plain English.

function passingInput(): AutoMergeInput {
  return {
    setting: { autoMergeEnabled: true, autoMergeConfidenceFloor: 90 },
    patHasMergeRights: true,
    versionBumpKind: 'patch',
    changelogBreakingChanges: 0,
    semanticDiffBreakingChanges: 0,
    signalsAgree: true,
    confidence: { overall: 92, bucket: 'high' },
    threshold: 70,
    verificationPassed: true,
    smokePassed: true,
    hasRejectionHistory: false,
  }
}

// ── Sanity: the passing case actually passes ─────────────────────────────────

describe('evaluateAutoMerge — passing baseline', () => {
  it('allows merge when every §5c rule is satisfied', () => {
    const v = evaluateAutoMerge(passingInput())
    expect(v.shouldMerge).toBe(true)
    expect(v.reasons).toEqual([])
  })
})

// ── §5c rule 1 — opt-in, default OFF; PAT must have merge rights ─────────────

describe('evaluateAutoMerge — §5c rule 1 (opt-in)', () => {
  it("blocks when setting is null (row doesn't exist = implicitly OFF)", () => {
    const v = evaluateAutoMerge({ ...passingInput(), setting: null })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r1') && r.includes('not enabled'))).toBe(true)
  })

  it("blocks when autoMergeEnabled is false (explicit OFF)", () => {
    const v = evaluateAutoMerge({
      ...passingInput(),
      setting: { autoMergeEnabled: false, autoMergeConfidenceFloor: 90 },
    })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r1') && r.includes('not enabled'))).toBe(true)
  })

  it("blocks when PAT lacks merge permission", () => {
    const v = evaluateAutoMerge({ ...passingInput(), patHasMergeRights: false })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r1') && r.includes('PAT lacks merge'))).toBe(true)
  })
})

// ── §5c rule 2 — narrow allowlist + no break + signals agree ─────────────────

describe('evaluateAutoMerge — §5c rule 2 (allowlist + no breakage + agreement)', () => {
  it("allows a 'minor' bump (same allowlist as 'patch')", () => {
    const v = evaluateAutoMerge({ ...passingInput(), versionBumpKind: 'minor' })
    expect(v.shouldMerge).toBe(true)
  })

  it("blocks a 'major' bump (always outside the allowlist)", () => {
    const v = evaluateAutoMerge({ ...passingInput(), versionBumpKind: 'major' })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r2') && r.includes("'major'"))).toBe(true)
  })

  it("blocks a 'prerelease' bump (uniformly unstable)", () => {
    const v = evaluateAutoMerge({ ...passingInput(), versionBumpKind: 'prerelease' })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r2') && r.includes("'prerelease'"))).toBe(true)
  })

  it("blocks an 'unknown' bump (safe-side rejection)", () => {
    const v = evaluateAutoMerge({ ...passingInput(), versionBumpKind: 'unknown' })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r2') && r.includes("'unknown'"))).toBe(true)
  })

  it("blocks when changelog flags any breaking change", () => {
    const v = evaluateAutoMerge({ ...passingInput(), changelogBreakingChanges: 1 })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r2') && r.includes('changelog'))).toBe(true)
  })

  it("blocks when semantic-diff flags any breaking change", () => {
    const v = evaluateAutoMerge({ ...passingInput(), semanticDiffBreakingChanges: 1 })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r2') && r.includes('semantic-diff'))).toBe(true)
  })

  it("blocks when semantic-diff did not run (null) — cannot confirm agreement", () => {
    // Honest §5c framing: a missing signal isn't "no break"; it's "we
    // can't tell." Treating null as zero would silently relax the gate.
    const v = evaluateAutoMerge({
      ...passingInput(),
      semanticDiffBreakingChanges: null,
    })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r2') && r.includes('did not run'))).toBe(true)
  })

  it("blocks when signals disagree (even if both report zero)", () => {
    const v = evaluateAutoMerge({ ...passingInput(), signalsAgree: false })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r2') && r.includes('disagree'))).toBe(true)
  })
})

// ── §5c rule 3 — high confidence floor with anti-gaming clamp ────────────────

describe('evaluateAutoMerge — §5c rule 3 (floor + anti-gaming clamp)', () => {
  it("blocks when overall is below the hard floor (90), even on bucket='high'", () => {
    const v = evaluateAutoMerge({
      ...passingInput(),
      confidence: { overall: AUTO_MERGE_HARD_FLOOR - 1, bucket: 'high' },
    })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r3') && r.includes('below effective floor'))).toBe(true)
  })

  it("blocks when bucket is 'medium' even at numeric 99 (Rust-style ceiling clamp)", () => {
    // F23a closeout's language-aware clamp can land a Rust 99/100 in
    // 'medium'. Auto-merge requires bucket='high' explicitly so the
    // public-API-only-tool ceiling honestly binds at the action layer.
    const v = evaluateAutoMerge({
      ...passingInput(),
      confidence: { overall: 99, bucket: 'medium' },
    })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r3') && r.includes("'medium'"))).toBe(true)
  })

  it("blocks when bucket is 'low' (verify-cap path)", () => {
    const v = evaluateAutoMerge({
      ...passingInput(),
      confidence: { overall: 99, bucket: 'low' },
    })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r3') && r.includes("'low'"))).toBe(true)
  })

  it("hard-clamps the effective floor ≥ the standard threshold (anti-gaming)", () => {
    // An op who set autoMergeConfidenceFloor=50 in RepoSetting AND
    // set threshold=95 (a strict project) must still see auto-merge
    // gated at 95 (the threshold). Without the clamp, a misconfigured
    // low floor would unlock auto-merge below the user's own
    // PR-promotion bar — exactly the §5c rule 7 anti-gaming class.
    const v = evaluateAutoMerge({
      ...passingInput(),
      threshold: 95,
      setting: { autoMergeEnabled: true, autoMergeConfidenceFloor: 50 },
      confidence: { overall: 91, bucket: 'high' },
    })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r3') && r.includes('threshold=95'))).toBe(true)
  })

  it("hard-clamps the effective floor ≥ AUTO_MERGE_HARD_FLOOR (anti-gaming)", () => {
    // A configured floor of 70 (medium-ish) still gets clamped up to
    // the hard floor (90). The reasons include the math so the user
    // can see what happened.
    const v = evaluateAutoMerge({
      ...passingInput(),
      setting: { autoMergeEnabled: true, autoMergeConfidenceFloor: 70 },
      confidence: { overall: 80, bucket: 'high' },
    })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r3') && r.includes(`hard-floor=${AUTO_MERGE_HARD_FLOOR}`))).toBe(true)
  })
})

// ── §5c rule 4 — tests AND smoke pass (F20 hard-dep) ─────────────────────────

describe('evaluateAutoMerge — §5c rule 4 (verification + smoke)', () => {
  it("blocks when verification failed", () => {
    const v = evaluateAutoMerge({ ...passingInput(), verificationPassed: false })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r4') && r.includes('verification'))).toBe(true)
  })

  it("blocks when smoke was NOT ATTEMPTED (null) — F20 is a hard dependency", () => {
    // Without F20 (smoke) there's no "the app boots after this patch"
    // evidence; auto-merge would be guessing. Treating null as YES
    // (silently allowing merges on F20-disabled scans) would be the
    // class of bug F20 was designed to prevent.
    const v = evaluateAutoMerge({ ...passingInput(), smokePassed: null })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r4') && r.includes('not attempted'))).toBe(true)
  })

  it("blocks when smoke RAN but failed (app did not boot post-patch)", () => {
    const v = evaluateAutoMerge({ ...passingInput(), smokePassed: false })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r4') && r.includes('did not pass'))).toBe(true)
  })
})

// ── §5c rule 5 — no rejection history ────────────────────────────────────────

describe('evaluateAutoMerge — §5c rule 5 (no rejection history)', () => {
  it("blocks when the rejection store has a prior pattern for this dep + change kind", () => {
    const v = evaluateAutoMerge({ ...passingInput(), hasRejectionHistory: true })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.some((r) => r.includes('§5c r5') && r.includes('rejection history'))).toBe(true)
  })
})

// ── Anti-gaming: ALL applicable reasons are returned ─────────────────────────

describe('evaluateAutoMerge — anti-gaming (multi-rule reasons)', () => {
  it("returns ALL applicable NO reasons, not just the first (so an op can't iteratively unlock)", () => {
    // Three rules violated at once: setting OFF + bucket low + smoke null.
    // The reasons array must list every one so a future investigation
    // can see exactly which §5c rules were violated.
    const v = evaluateAutoMerge({
      ...passingInput(),
      setting: null,
      confidence: { overall: 50, bucket: 'low' },
      smokePassed: null,
    })
    expect(v.shouldMerge).toBe(false)
    expect(v.reasons.length).toBeGreaterThanOrEqual(3)
    expect(v.reasons.some((r) => r.includes('§5c r1'))).toBe(true)
    expect(v.reasons.some((r) => r.includes('§5c r3'))).toBe(true)
    expect(v.reasons.some((r) => r.includes('§5c r4'))).toBe(true)
  })

  it("when shouldMerge is true the reasons array is empty (positive contract)", () => {
    const v = evaluateAutoMerge(passingInput())
    expect(v.shouldMerge).toBe(true)
    expect(v.reasons).toHaveLength(0)
  })
})

// ── classifyVersionBump ──────────────────────────────────────────────────────

describe('classifyVersionBump', () => {
  it('classifies a clean patch bump', () => {
    expect(classifyVersionBump('1.2.3', '1.2.4')).toBe('patch')
  })

  it('classifies a clean minor bump', () => {
    expect(classifyVersionBump('1.2.3', '1.3.0')).toBe('minor')
  })

  it('classifies a clean major bump (1.x → 2.x)', () => {
    expect(classifyVersionBump('1.2.3', '2.0.0')).toBe('major')
  })

  it("treats EVERY 0.x bump as 'major' (semver §4 — 0.x carries no stability guarantees)", () => {
    // A 0.2.0 → 0.3.0 looks like "minor" but is conventionally a
    // public-API redesign. Auto-merge must reject it to honor §5c
    // rule 7 (never relax the envelope).
    expect(classifyVersionBump('0.2.0', '0.3.0')).toBe('major')
    expect(classifyVersionBump('0.2.0', '0.2.1')).toBe('major')
    expect(classifyVersionBump('0.2.0', '1.0.0')).toBe('major')
  })

  it("flags prerelease bumps as 'prerelease' on either side", () => {
    expect(classifyVersionBump('1.2.3', '1.2.4-rc.1')).toBe('prerelease')
    expect(classifyVersionBump('1.2.3-alpha', '1.2.3')).toBe('prerelease')
    expect(classifyVersionBump('1.2.3-rc.1', '1.2.3-rc.2')).toBe('prerelease')
  })

  it("strips a leading 'v' (Go module convention)", () => {
    expect(classifyVersionBump('v1.2.3', 'v1.2.4')).toBe('patch')
    expect(classifyVersionBump('v1.2.3', 'v2.0.0')).toBe('major')
  })

  it("returns 'unknown' on non-semver input (auto-merge will reject)", () => {
    expect(classifyVersionBump('latest', '1.2.3')).toBe('unknown')
    expect(classifyVersionBump('1.2', '1.3')).toBe('unknown')
    expect(classifyVersionBump('not-a-version', 'also-not')).toBe('unknown')
  })

  it("handles the identity bump edge case (rare but should not crash)", () => {
    expect(classifyVersionBump('1.2.3', '1.2.3')).toBe('patch')
  })
})
