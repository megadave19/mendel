'use client'

/**
 * ConfidenceBadge — DESIGN.md §12 (mode-agnostic). v1.0 is always amber
 * "medium — review required" (CLAUDE.md §5b: no green/high-confidence badges in
 * v1.0). v1.5 adds lime/amber/danger buckets — not built (paused).
 */

import type { ConfidenceLevel } from './types'

interface ConfidenceBadgeProps {
  level?: ConfidenceLevel
  size?: 'sm' | 'md'
}

export function ConfidenceBadge({ level = 'medium', size = 'md' }: ConfidenceBadgeProps) {
  // v1.0: single signal → always amber/medium.
  const color = 'var(--accent-warning)'
  const label = level === 'medium' ? 'CONF: MEDIUM' : 'CONF'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: size === 'sm' ? '0.15rem 0.45rem' : '0.25rem 0.6rem',
        border: `1px solid ${color}`,
        background: 'rgba(255,184,77,0.06)',
        color,
        fontFamily: 'var(--font-mono)',
        fontSize: size === 'sm' ? '0.5rem' : '0.5625rem',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
      {label}
    </span>
  )
}
