'use client'

/**
 * ConfidenceBadge — DESIGN.md §12 (mode-agnostic).
 *
 * v1.0 shipped this amber-only ("medium — review required" per CLAUDE.md §5b).
 * v1.5 Workstream #4 lights up all three buckets with calibrated colors:
 *   - high   → phosphor lime  (--accent-primary)
 *   - medium → amber          (--accent-warning)   ← v1.0 fallback also lands here
 *   - low    → danger red     (--accent-danger)
 *
 * When the optional `score` prop is supplied (v1.5 calibrated data), the badge
 * shows `N/100` alongside the bucket. When only the bucket is known (v1.0
 * stub data), it shows just the bucket label — never invents a score.
 */

import type { ConfidenceLevel } from './types'

interface ConfidenceBadgeProps {
  level?: ConfidenceLevel
  /** Optional numeric score (v1.5). Range 0–100. */
  score?: number
  /** Optional flag: verification failure capped the score (TRD §9.5). */
  capped?: boolean
  size?: 'sm' | 'md'
}

const BUCKET_COLOR: Record<ConfidenceLevel, { fg: string; bg: string; dot: string }> = {
  high:   { fg: 'var(--accent-primary)', bg: 'rgba(198,255,61,0.08)',  dot: 'var(--accent-primary)' },
  medium: { fg: 'var(--accent-warning)', bg: 'rgba(255,184,77,0.06)',  dot: 'var(--accent-warning)' },
  low:    { fg: 'var(--accent-danger)',  bg: 'rgba(255,77,94,0.07)',   dot: 'var(--accent-danger)' },
}

export function ConfidenceBadge({ level = 'medium', score, capped, size = 'md' }: ConfidenceBadgeProps) {
  const colors = BUCKET_COLOR[level]
  const label =
    score != null
      ? `CONF ${score}/100 · ${level.toUpperCase()}`
      : `CONF: ${level.toUpperCase()}`

  const title = capped
    ? `Confidence capped at 50 because verification did not pass.`
    : score != null
      ? `Calibrated score: ${score}/100, bucket: ${level}.`
      : `v1.0 confidence stub — not a calibrated score.`

  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: size === 'sm' ? '0.15rem 0.45rem' : '0.25rem 0.6rem',
        border: `1px solid ${colors.fg}`,
        background: colors.bg,
        color: colors.fg,
        fontFamily: 'var(--font-mono)',
        fontSize: size === 'sm' ? '0.5rem' : '0.5625rem',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', background: colors.dot }} />
      {capped && <span aria-hidden title="capped by verification failure">⚠</span>}
      {label}
    </span>
  )
}
