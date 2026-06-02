/**
 * v2.3 / F25 sub-phase 1 — monitor scheduler tests.
 *
 * Pure boundary tests for the §5b honesty gate on monitor fires:
 *   - cron expression validation (5-field, allowed shapes only)
 *   - decideFire enforces enabled / concurrency cap / min-gap honestly
 *     with a SPECIFIC reason for each skip
 *
 * No clock, no DB, no cron lib — just the pure rules.
 */

import { describe, it, expect } from 'vitest'
import {
  validateCronExpression,
  decideFire,
  MIN_GAP_SECONDS,
  MAX_CONCURRENT_SCANS,
} from '@/lib/agent/monitor/scheduler'

// ── validateCronExpression ──────────────────────────────────────────────────

describe('validateCronExpression', () => {
  it('accepts a simple every-6h expression', () => {
    expect(validateCronExpression('0 */6 * * *')).toEqual({ ok: true })
  })

  it('accepts a daily-at-midnight expression', () => {
    expect(validateCronExpression('0 0 * * *')).toEqual({ ok: true })
  })

  it('accepts ranges, lists, and step expressions in each field', () => {
    expect(validateCronExpression('0,30 9-17 * * 1-5')).toEqual({ ok: true })
    expect(validateCronExpression('*/15 * * * *')).toEqual({ ok: true })
    expect(validateCronExpression('0 0-23/2 * * *')).toEqual({ ok: true })
  })

  it('refuses fewer or more than 5 fields', () => {
    expect(validateCronExpression('0 * * *')).toMatchObject({ ok: false })
    expect(validateCronExpression('0 0 * * * *')).toMatchObject({ ok: false })
  })

  it('refuses unknown shapes like @daily / @hourly (node-cron 4 is strict)', () => {
    expect(validateCronExpression('@daily')).toMatchObject({ ok: false })
    expect(validateCronExpression('@hourly')).toMatchObject({ ok: false })
  })

  it('refuses empty / non-string input', () => {
    expect(validateCronExpression('')).toMatchObject({ ok: false, reason: /empty/ })
    expect(validateCronExpression('   ')).toMatchObject({ ok: false })
    // @ts-expect-error — intentionally test runtime guard against non-string
    expect(validateCronExpression(null)).toMatchObject({ ok: false })
  })

  it('refuses absurdly long expressions (defensive cap)', () => {
    const long = `0 ${'1'.repeat(200)} * * *`
    expect(validateCronExpression(long)).toMatchObject({ ok: false, reason: /100 chars/ })
  })

  it('refuses fields with letters or operators we do not support', () => {
    expect(validateCronExpression('0 ?MON * * *')).toMatchObject({ ok: false })
    expect(validateCronExpression('0 0 * * MON')).toMatchObject({ ok: false })
    expect(validateCronExpression('JAN * * * *')).toMatchObject({ ok: false })
  })

  it('identifies WHICH field is bad in the reason text', () => {
    const r = validateCronExpression('0 BAD * * *')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/field 2/i)
  })
})

// ── decideFire ──────────────────────────────────────────────────────────────

describe('decideFire', () => {
  const now = new Date('2026-06-01T12:00:00Z')

  it('fires when enabled, no prior fire, no in-flight scans', () => {
    expect(
      decideFire({ enabled: true, lastFiredAt: null, inFlightCount: 0, now }),
    ).toEqual({ shouldFire: true })
  })

  it("blocks honestly when monitor is disabled (the §5c-class opt-in default)", () => {
    const v = decideFire({ enabled: false, lastFiredAt: null, inFlightCount: 0, now })
    expect(v.shouldFire).toBe(false)
    if (!v.shouldFire) expect(v.reason).toMatch(/disabled/i)
  })

  it("blocks honestly at the concurrency cap (in-flight count surfaced in reason)", () => {
    const v = decideFire({
      enabled: true,
      lastFiredAt: null,
      inFlightCount: MAX_CONCURRENT_SCANS,
      now,
    })
    expect(v.shouldFire).toBe(false)
    if (!v.shouldFire) {
      expect(v.reason).toMatch(/in flight/i)
      expect(v.reason).toMatch(new RegExp(`max ${MAX_CONCURRENT_SCANS}`))
    }
  })

  it("blocks honestly when last fire was within MIN_GAP_SECONDS (anti-spam clamp)", () => {
    // 2 min ago — well under the 5-min floor.
    const recent = new Date(now.getTime() - 2 * 60 * 1000)
    const v = decideFire({ enabled: true, lastFiredAt: recent, inFlightCount: 0, now })
    expect(v.shouldFire).toBe(false)
    if (!v.shouldFire) {
      expect(v.reason).toMatch(/last fire 120s ago/)
      expect(v.reason).toMatch(new RegExp(`minimum gap ${MIN_GAP_SECONDS}s`))
    }
  })

  it("fires when last fire was longer than MIN_GAP_SECONDS ago", () => {
    const old = new Date(now.getTime() - (MIN_GAP_SECONDS + 30) * 1000)
    expect(decideFire({ enabled: true, lastFiredAt: old, inFlightCount: 0, now })).toEqual({ shouldFire: true })
  })

  it("rule order: disabled wins over in-flight cap (most-specific reason)", () => {
    const v = decideFire({
      enabled: false,
      lastFiredAt: null,
      inFlightCount: MAX_CONCURRENT_SCANS + 10,
      now,
    })
    expect(v.shouldFire).toBe(false)
    if (!v.shouldFire) expect(v.reason).toMatch(/disabled/i)
  })

  it("rule order: concurrency cap wins over gap (resource exhaustion is more urgent)", () => {
    const recent = new Date(now.getTime() - 30 * 1000)
    const v = decideFire({
      enabled: true,
      lastFiredAt: recent,
      inFlightCount: MAX_CONCURRENT_SCANS,
      now,
    })
    expect(v.shouldFire).toBe(false)
    if (!v.shouldFire) expect(v.reason).toMatch(/in flight/i)
  })
})
