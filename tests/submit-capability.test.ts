/**
 * Unit tests for the pre-flight PR-delivery capability decision (2026-05-28).
 *
 * The bug this prevents: Mendel analyzed a repo for ~7 minutes, then 403'd at
 * submit because the token couldn't fork. `decideSubmitCapability` is the pure
 * core that lets the runner fail FAST (~2s) with one clear instruction instead.
 *
 * NOTE: this file does NOT mock @/lib/github (unlike submit-fork.test.ts) so it
 * exercises the real exported pure function.
 */

import { describe, it, expect } from 'vitest'
import { decideSubmitCapability } from '@/lib/github'

describe('decideSubmitCapability', () => {
  it('write access to upstream → direct push (no fork)', () => {
    expect(
      decideSubmitCapability({ canPushUpstream: true, existingForkPushable: false, tokenCanFork: false }),
    ).toEqual({ mode: 'direct' })
  })

  it('no upstream write but a pushable fork already exists → fork', () => {
    expect(
      decideSubmitCapability({ canPushUpstream: false, existingForkPushable: true, tokenCanFork: false }),
    ).toEqual({ mode: 'fork' })
  })

  it('no upstream write, no existing fork, but token CAN fork → fork', () => {
    expect(
      decideSubmitCapability({ canPushUpstream: false, existingForkPushable: false, tokenCanFork: true }),
    ).toEqual({ mode: 'fork' })
  })

  it('cannot push and cannot fork → blocked with an actionable, non-empty reason', () => {
    const r = decideSubmitCapability({ canPushUpstream: false, existingForkPushable: false, tokenCanFork: false })
    expect(r.mode).toBe('blocked')
    if (r.mode === 'blocked') {
      expect(r.reason.length).toBeGreaterThan(40)
      // Must name the concrete one-time fix so the user isn't left guessing.
      expect(r.reason.toLowerCase()).toContain('classic')
      expect(r.reason).toContain('repo')
    }
  })

  it('direct takes precedence even if other flags are set', () => {
    expect(
      decideSubmitCapability({ canPushUpstream: true, existingForkPushable: true, tokenCanFork: true }),
    ).toEqual({ mode: 'direct' })
  })
})
