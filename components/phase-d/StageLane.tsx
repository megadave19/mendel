'use client'

/**
 * StageLane — SCAN → DIAGNOSE → PATCH → VERIFY progress rail (DESIGN.md §11 S4).
 * Running-only (DESIGN.md §12.1: no rest variant). A marker slides between
 * stages: 280ms cubic-bezier(0.65,0,0.35,1) per DESIGN.md §7 stage-transition.
 */

import { motion } from 'framer-motion'
import { STAGES, STAGES_NO_SMOKE, type Phase } from './types'
import { StatusPill } from './StatusPill'

interface StageLaneProps {
  /** Current phase. Stages at-or-before it read "done"; current reads "active". */
  phase: Phase
  /**
   * v2.0 / F20 — true when the scan opted in to Phase C. When false (or
   * omitted), the SMOKE lane is hidden so v1.5 scans render unchanged.
   */
  smokeEnabled?: boolean
}

const ORDER: Record<Phase, number> = {
  SCAN: 0,
  DIAGNOSE: 1,
  PATCH: 2,
  VERIFY: 3,
  SMOKE: 4,
  DONE: 5,
  ERROR: 5,
}

const ORDER_NO_SMOKE: Record<Phase, number> = {
  SCAN: 0,
  DIAGNOSE: 1,
  PATCH: 2,
  VERIFY: 3,
  SMOKE: 4, // unreachable in this map's mode; here for type completeness
  DONE: 4,
  ERROR: 4,
}

export function StageLane({ phase, smokeEnabled = false }: StageLaneProps) {
  const stages = smokeEnabled ? STAGES : STAGES_NO_SMOKE
  const order = smokeEnabled ? ORDER : ORDER_NO_SMOKE
  const current = order[phase]

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${stages.length}, 1fr)`,
        gap: '0.5rem',
        position: 'relative',
      }}
    >
      {/* connecting rail */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          right: 0,
          height: 1,
          background: 'var(--border-strong)',
          zIndex: 0,
        }}
      />
      {stages.map((stage, i) => {
        const isActive = i === current
        const isDone = i < current
        return (
          <div
            key={stage}
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <motion.div
              initial={false}
              animate={{ opacity: isActive || isDone ? 1 : 0.35, scale: isActive ? 1 : 0.94 }}
              transition={{ duration: 0.28, ease: [0.65, 0, 0.35, 1] }}
            >
              {/* Fix U2: completed stages render uniformly as SUCCESS (lime + ✓)
                  instead of keeping their phase-specific color. Eliminates the
                  cyan / cyan / lime / amber visual confusion on DONE state. */}
              <StatusPill phase={stage} active={isActive} done={isDone} size="sm" />
            </motion.div>
          </div>
        )
      })}
    </div>
  )
}
