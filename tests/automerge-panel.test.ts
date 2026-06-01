/**
 * v2.3 / F24 sub-phase 3 — tests for the pure helpers in
 * components/automerge/AutoMergePanel.tsx.
 *
 * UI rendering is exempt from unit testing per CLAUDE.md §7.1 (covered
 * by E2E smoke + manual click-through). The PURE helpers
 * (`clampDwellInUI`, `summarisePayload`) are unit-tested here so a
 * future refactor can't silently drift the safety clamp or the
 * AgentLog summary copy.
 */

import { describe, it, expect } from 'vitest'
import { clampDwellInUI, summarisePayload } from '@/components/automerge/AutoMergePanel'

// ── clampDwellInUI ───────────────────────────────────────────────────────────

describe('clampDwellInUI', () => {
  it('clamps negatives to 0', () => {
    expect(clampDwellInUI(-1)).toBe(0)
  })

  it('clamps NaN to 0 (aberrant; legitimate UI input never produces it)', () => {
    expect(clampDwellInUI(NaN)).toBe(0)
  })

  it('clamps above the UI ceiling (3600s) to 3600', () => {
    expect(clampDwellInUI(5000)).toBe(3600)
  })

  it('rounds fractional input (e.g., from a sloppy onChange)', () => {
    expect(clampDwellInUI(60.7)).toBe(61)
  })

  it('passes sensible values through unchanged', () => {
    expect(clampDwellInUI(120)).toBe(120)
    expect(clampDwellInUI(0)).toBe(0)
    expect(clampDwellInUI(3600)).toBe(3600)
  })
})

// ── summarisePayload (the AgentLog one-liner) ────────────────────────────────

describe('summarisePayload', () => {
  it("renders 'envelope passed' for an automerge.verdict with shouldMerge=true", () => {
    expect(
      summarisePayload({
        kind: 'automerge.verdict',
        payload: { shouldMerge: true, reasons: [] },
      }),
    ).toMatch(/envelope passed/i)
  })

  it("renders 'envelope blocked (N reasons)' for an automerge.verdict with shouldMerge=false", () => {
    const s = summarisePayload({
      kind: 'automerge.verdict',
      payload: { shouldMerge: false, reasons: ['§5c r1: …', '§5c r3: …'] },
    })
    expect(s).toMatch(/envelope blocked/i)
    expect(s).toMatch(/2 reasons/)
  })

  it("uses singular 'reason' when exactly one reason is present", () => {
    expect(
      summarisePayload({
        kind: 'automerge.verdict',
        payload: { shouldMerge: false, reasons: ['§5c r1: …'] },
      }),
    ).toMatch(/1 reason\b/)
  })

  it("renders 'dwell started (Ns)' for an automerge.dwell phase=started", () => {
    expect(
      summarisePayload({
        kind: 'automerge.dwell',
        payload: { phase: 'started', dwellSeconds: 60 },
      }),
    ).toMatch(/dwell started \(60s\)/)
  })

  it("renders 'dwell completed' for an automerge.dwell phase=completed", () => {
    expect(
      summarisePayload({
        kind: 'automerge.dwell',
        payload: { phase: 'completed', dwellSeconds: 60 },
      }),
    ).toMatch(/dwell completed/)
  })

  it("renders 'merged · sha <prefix>' for a successful automerge.merge", () => {
    expect(
      summarisePayload({
        kind: 'automerge.merge',
        payload: { ok: true, sha: 'abcdef0123456789' },
      }),
    ).toMatch(/merged · sha abcdef0/)
  })

  it("renders 'merge failed: …' for a failed automerge.merge", () => {
    expect(
      summarisePayload({
        kind: 'automerge.merge',
        payload: { ok: false, reason: 'Pull request is not mergeable' },
      }),
    ).toMatch(/merge failed: Pull request is not mergeable/)
  })

  it('falls back to a JSON snippet for unknown kinds (no silent drop)', () => {
    const s = summarisePayload({
      kind: 'automerge.future',
      payload: { surprise: 'newField' },
    })
    expect(s).toContain('newField')
  })

  it("renders '(no payload)' when payload is null", () => {
    expect(summarisePayload({ kind: 'automerge.verdict', payload: null })).toBe('(no payload)')
  })
})
