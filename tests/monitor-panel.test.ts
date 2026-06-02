/**
 * v2.3 / F25 sub-phase 2 — tests for pure helpers in MonitorPanel.
 *
 * UI rendering is exempt from unit testing per CLAUDE.md §7.1. The pure
 * `summariseMonitorPayload` helper is tested here so the recent-events
 * feed copy can't silently drift on a refactor.
 */

import { describe, it, expect } from 'vitest'
import { summariseMonitorPayload } from '@/components/monitor/MonitorPanel'

describe('summariseMonitorPayload', () => {
  it("renders 'fired → scan <id>' on a fired monitor.fire", () => {
    expect(
      summariseMonitorPayload({
        kind: 'monitor.fire',
        payload: { fired: true, scanId: 'monitor_42_abc', repoFullName: 'alice/r' },
      }),
    ).toBe('fired → scan monitor_42_abc')
  })

  it("falls back to just 'fired' when scanId is missing (defensive)", () => {
    expect(
      summariseMonitorPayload({
        kind: 'monitor.fire',
        payload: { fired: true, repoFullName: 'alice/r' },
      }),
    ).toBe('fired')
  })

  it("renders 'skipped: <reason>' on a skipped monitor.fire", () => {
    expect(
      summariseMonitorPayload({
        kind: 'monitor.fire',
        payload: {
          fired: false,
          reason: 'last fire 60s ago; minimum gap 300s — skipping to protect rate limits',
        },
      }),
    ).toMatch(/^skipped: last fire 60s ago/)
  })

  it("renders '(no reason)' when reason missing (honest fallback, never silent)", () => {
    expect(
      summariseMonitorPayload({
        kind: 'monitor.fire',
        payload: { fired: false },
      }),
    ).toBe('skipped: (no reason)')
  })

  it("renders 'error: <message>' on a monitor.error", () => {
    expect(
      summariseMonitorPayload({
        kind: 'monitor.error',
        payload: { error: 'GitHub rate limit hit', repoFullName: 'alice/r' },
      }),
    ).toBe('error: GitHub rate limit hit')
  })

  it("falls back to a JSON snippet for unknown kinds (surfaced, not dropped)", () => {
    const out = summariseMonitorPayload({
      kind: 'monitor.future',
      payload: { surprise: 'newField' },
    })
    expect(out).toContain('newField')
  })

  it("renders '(no payload)' on null payload", () => {
    expect(summariseMonitorPayload({ kind: 'monitor.fire', payload: null })).toBe('(no payload)')
  })

  it("renders '(no payload)' on non-object payload (defensive)", () => {
    expect(summariseMonitorPayload({ kind: 'monitor.fire', payload: 'just a string' })).toBe('(no payload)')
  })
})
