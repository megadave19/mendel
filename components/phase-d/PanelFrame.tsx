'use client'

/**
 * PanelFrame — the Teenage-Engineering chrome that wraps every major UI block
 * (DESIGN.md §4, §12, §13 anti-ref: "every input wrapped in PanelFrame chrome").
 *
 * Bordered, slightly inset, optional title bar with corner ticks. Mode-agnostic.
 */

import type { CSSProperties, ReactNode } from 'react'

interface PanelFrameProps {
  title?: string
  /** Right-aligned status text in the title bar (e.g. a count or state). */
  meta?: ReactNode
  /** Accent color for the title bar ticks + label. Default muted. */
  accent?: string
  children: ReactNode
  style?: CSSProperties
  className?: string
  /** Remove inner padding (for panes that manage their own scroll/padding). */
  flush?: boolean
}

export function PanelFrame({
  title,
  meta,
  accent = 'var(--text-muted)',
  children,
  style,
  className,
  flush = false,
}: PanelFrameProps) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        border: '1px solid var(--border-strong)',
        background: 'var(--bg-1)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.5rem 0.75rem',
            borderBottom: '1px solid var(--border-strong)',
            background: 'var(--bg-2)',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.5625rem',
              fontWeight: 600,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: accent,
            }}
          >
            {/* corner tick */}
            <span style={{ width: 6, height: 6, borderLeft: `1px solid ${accent}`, borderTop: `1px solid ${accent}` }} />
            {title}
          </span>
          {meta != null && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.5625rem',
                letterSpacing: '0.12em',
                color: 'var(--text-secondary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {meta}
            </span>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, padding: flush ? 0 : '1rem' }}>{children}</div>
    </div>
  )
}
