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
  // v2.0 / F20 — SMOKE shares the warning/verification color family until a
  // boot result is in; the IssueCard renders a separate phosphor/amber/danger
  // sub-panel for the actual smoke outcome (DESIGN.md §11b v2 brief).
  SMOKE: 'var(--accent-warning)',
  DONE: 'var(--accent-primary)',
  ERROR: 'var(--accent-danger)',
}

interface StatusPillProps {
  phase: Phase
  label?: string
  /** active = filled + glow + LED pulse; idle = outline only. */
  active?: boolean
  /**
   * Fix U2 (audit 2026-05-26): completed stages should read uniformly as
   * SUCCESS, not in their phase-specific color (SCAN-cyan, VERIFY-amber).
   * `done` overrides the phase color with --accent-primary and renders a
   * checkmark dot instead of the live pulse.
   */
  done?: boolean
  size?: 'sm' | 'md'
}

export function StatusPill({ phase, label, active = false, done = false, size = 'md' }: StatusPillProps) {
  // `done` wins over `active` (you can't be both — done means past tense).
  const color = done ? 'var(--accent-primary)' : PHASE_COLOR[phase]
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
      {done ? (
        // Checkmark glyph replaces the live pulse on completed stages.
        <span aria-hidden style={{ fontSize: '0.625rem', lineHeight: 1, color }}>✓</span>
      ) : (
        <motion.span
          aria-hidden
          style={{ width: 5, height: 5, borderRadius: '50%', background: active ? 'var(--bg-0)' : color }}
          animate={active ? { opacity: [0.4, 0.9, 0.4] } : { opacity: 1 }}
          transition={active ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
        />
      )}
      {text}
    </span>
  )
}
