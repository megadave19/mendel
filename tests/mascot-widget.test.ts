import { describe, it, expect } from 'vitest'
import { MASCOT_POSES } from '@/components/MascotWidget'

/**
 * Locks the pose taxonomy. If poses drift, the eventual 3D model's animation-clip
 * mapping will silently mismatch — this catches it. The mapping itself lands when
 * the model arrives; for now we guard the canonical pose set.
 */
describe('MascotWidget pose taxonomy', () => {
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
