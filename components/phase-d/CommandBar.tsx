'use client'

/**
 * CommandBar — F-key hint bar at the bottom of S4 (DESIGN.md §11 S4, §12).
 * "Decorative + functional": hints are real keyboard shortcuts when handlers
 * are passed; otherwise they render as inert chrome (The-Ratio terminal feel).
 * Running-only.
 */

import { useEffect } from 'react'

export interface CommandKey {
  key: string // e.g. "F2"
  label: string // e.g. "CANCEL"
  onPress?: () => void
  disabled?: boolean
}

interface CommandBarProps {
  keys: CommandKey[]
  /** Right-aligned status text (e.g. elapsed time, token count). */
  status?: string
}

export function CommandBar({ keys, status }: CommandBarProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const match = keys.find((k) => k.key.toLowerCase() === e.key.toLowerCase())
      if (match && match.onPress && !match.disabled) {
        e.preventDefault()
        match.onPress()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [keys])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1.25rem',
        padding: '0.5rem 1rem',
        borderTop: '1px solid var(--border-strong)',
        background: 'var(--bg-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.625rem',
        letterSpacing: '0.1em',
      }}
    >
      {keys.map((k) => {
        const inert = k.disabled || !k.onPress
        return (
        <button
          key={k.key}
          onClick={k.onPress}
          disabled={inert}
          title={inert ? 'Demo control — not wired in v1.0' : undefined}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: inert ? 'not-allowed' : 'pointer',
            // Fix #5: inert F-keys are visibly faded so they don't read as live controls.
            opacity: inert ? 0.35 : 1,
            fontFamily: 'inherit',
            fontSize: 'inherit',
            letterSpacing: 'inherit',
          }}
        >
          <span
            style={{
              color: 'var(--accent-secondary)',
              border: '1px solid var(--accent-secondary)',
              padding: '0.05rem 0.3rem',
              fontWeight: 700,
            }}
          >
            {k.key}
          </span>
          <span style={{ color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{k.label}</span>
        </button>
        )
      })}
      {status && (
        <span
          style={{
            marginLeft: 'auto',
            color: 'var(--text-muted)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.12em',
          }}
        >
          {status}
        </span>
      )}
    </div>
  )
}
