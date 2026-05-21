'use client'

/**
 * StatusPill — phase/state pill (DESIGN.md §12). Used in StageLane + CommandBar.
 * Color is semantic (DESIGN.md §5): cyan=scan/diagnose, phosphor=patch/done,
 * amber=verify, danger=error.
 */

import { motion } from 'framer-motion'
import type { Phase } from './types'

const PHASE_COLOR: Record<Phase, string> = {
  SCAN: 'var(--accent-secondary)',
  DIAGNOSE: 'var(--accent-secondary)',
  PATCH: 'var(--accent-primary)',
  VERIFY: 'var(--accent-warning)',
  DONE: 'var(--accent-primary)',
  ERROR: 'var(--accent-danger)',
}

interface StatusPillProps {
  phase: Phase
  label?: string
  /** active = filled + glow + LED pulse; idle = outline only. */
  active?: boolean
  size?: 'sm' | 'md'
}

export function StatusPill({ phase, label, active = false, size = 'md' }: StatusPillProps) {
  const color = PHASE_COLOR[phase]
  const text = label ?? phase

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: size === 'sm' ? '0.2rem 0.5rem' : '0.3rem 0.7rem',
        border: `1px solid ${color}`,
        background: active ? color : 'transparent',
        color: active ? 'var(--bg-0)' : color,
        fontFamily: 'var(--font-mono)',
        fontSize: size === 'sm' ? '0.5rem' : '0.5625rem',
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        boxShadow: active ? `0 0 16px ${color}66` : 'none',
        transition: 'all 180ms cubic-bezier(0.65,0,0.35,1)',
      }}
    >
      <motion.span
        aria-hidden
        style={{ width: 5, height: 5, borderRadius: '50%', background: active ? 'var(--bg-0)' : color }}
        animate={active ? { opacity: [0.4, 0.9, 0.4] } : { opacity: 1 }}
        transition={active ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
      />
      {text}
    </span>
  )
}
