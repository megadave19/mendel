'use client'

/**
 * StageLane — SCAN → DIAGNOSE → PATCH → VERIFY progress rail (DESIGN.md §11 S4).
 * Running-only (DESIGN.md §12.1: no rest variant). A marker slides between
 * stages: 280ms cubic-bezier(0.65,0,0.35,1) per DESIGN.md §7 stage-transition.
 */

import { motion } from 'framer-motion'
import { STAGES, type Phase } from './types'
import { StatusPill } from './StatusPill'

interface StageLaneProps {
  /** Current phase. Stages at-or-before it read "done"; current reads "active". */
  phase: Phase
}

const ORDER: Record<Phase, number> = {
  SCAN: 0,
  DIAGNOSE: 1,
  PATCH: 2,
  VERIFY: 3,
  DONE: 4,
  ERROR: 4,
}

export function StageLane({ phase }: StageLaneProps) {
  const current = ORDER[phase]

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${STAGES.length}, 1fr)`,
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
      {STAGES.map((stage, i) => {
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
