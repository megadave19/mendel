'use client'

/**
 * DiffViewer — syntax-light file diff (DESIGN.md §11 S6, §12). Monospace, line
 * numbers, +/- gutter, copy button.
 *
 * Dual-mode (DESIGN.md §12.1):
 *   running → lines stagger-fade in 20ms each on first reveal
 *   rest    → all lines visible immediately, no animation
 */

import { useState } from 'react'
import { motion } from 'framer-motion'
import type { DiffLine } from './types'

const KIND_STYLE: Record<DiffLine['kind'], { bg: string; gutter: string; color: string }> = {
  add: { bg: 'rgba(198,255,61,0.08)', gutter: '+', color: 'var(--accent-primary)' },
  del: { bg: 'rgba(255,77,94,0.08)', gutter: '-', color: 'var(--accent-danger)' },
  ctx: { bg: 'transparent', gutter: ' ', color: 'var(--text-secondary)' },
  meta: { bg: 'rgba(61,255,238,0.06)', gutter: '@', color: 'var(--accent-secondary)' },
}

interface DiffViewerProps {
  filePath: string
  diff: DiffLine[]
  context?: 'running' | 'rest'
}

export function DiffViewer({ filePath, diff, context = 'rest' }: DiffViewerProps) {
  const running = context === 'running'
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(diff.map((d) => d.text).join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-2)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.45rem 0.75rem',
          borderBottom: '1px solid var(--border-strong)',
          background: 'var(--bg-1)',
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>{filePath}</span>
        <button
          onClick={copy}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.5625rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: copied ? 'var(--accent-primary)' : 'var(--text-muted)',
            background: 'transparent',
            border: '1px solid var(--border-strong)',
            padding: '0.15rem 0.5rem',
            cursor: 'pointer',
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        {diff.map((line, i) => {
          const s = KIND_STYLE[line.kind]
          return (
            <motion.div
              key={i}
              initial={running ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={running ? { delay: i * 0.02, duration: 0.15 } : undefined}
              style={{ display: 'flex', background: s.bg, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', lineHeight: 1.6 }}
            >
              <span style={{ width: '2.5rem', flexShrink: 0, textAlign: 'right', padding: '0 0.5rem', color: 'var(--text-muted)', userSelect: 'none', fontVariantNumeric: 'tabular-nums' }}>
                {line.kind === 'meta' ? '' : i + 1}
              </span>
              <span style={{ width: '1.25rem', flexShrink: 0, textAlign: 'center', color: s.color, userSelect: 'none' }}>{s.gutter}</span>
              <span style={{ color: s.color, whiteSpace: 'pre', paddingRight: '1rem' }}>{line.text}</span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
