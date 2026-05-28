import { describe, it, expect } from 'vitest'
import { MASCOT_POSES } from '@/components/BonesMascot'

/**
 * Locks the pose taxonomy. The 11 owner-supplied PNGs in /public/mascot/ are
 * keyed by these names — if the taxonomy drifts, the BonesMascot crossfade
 * will 404 silently. This test guards the canonical pose set.
 */
describe('BonesMascot pose taxonomy', () => {
  it('exposes exactly 9 poses (DESIGN.md §8 minus v1.5 uncertain)', () => {
    expect(MASCOT_POSES).toHaveLength(9)
  })

  it('does not include the v1.5-gated uncertain pose', () => {
    expect(MASCOT_POSES).not.toContain('uncertain')
  })

  it('keeps idle first (default pose)', () => {
    expect(MASCOT_POSES[0]).toBe('idle')
  })

  it('contains the expected core states', () => {
    for (const p of ['scanning', 'thinking', 'detecting', 'patching', 'verifying', 'success', 'failure', 'error']) {
      expect(MASCOT_POSES).toContain(p)
    }
  })

  it('has no duplicate poses', () => {
    expect(new Set(MASCOT_POSES).size).toBe(MASCOT_POSES.length)
  })
})
