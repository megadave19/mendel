'use client'

/**
 * NotAnalyzedCallout — the trust mechanism (DESIGN.md §11 S6: "must be visually
 * loud … never collapsed, never below the fold"). Lists what the agent did NOT
 * check (CLAUDE.md §5b mandatory disclosure).
 *
 * Dual-mode (DESIGN.md §12.1):
 *   running → amber border pulses (2s), bullets stagger-fade in 40ms apart
 *   rest    → static border, all bullets visible immediately
 */

import { motion } from 'framer-motion'

interface NotAnalyzedCalloutProps {
  items: string[]
  context?: 'running' | 'rest'
}

export function NotAnalyzedCallout({ items, context = 'rest' }: NotAnalyzedCalloutProps) {
  const running = context === 'running'

  return (
    <motion.div
      animate={running ? { boxShadow: ['0 0 0 rgba(255,184,77,0)', '0 0 14px rgba(255,184,77,0.35)', '0 0 0 rgba(255,184,77,0)'] } : undefined}
      transition={running ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
      style={{
        border: '1px solid var(--accent-warning)',
        background: 'rgba(255,184,77,0.05)',
        padding: '0.875rem 1rem',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.5625rem',
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--accent-warning)',
          marginBottom: '0.625rem',
        }}
      >
        ⚠ Not Analyzed
      </p>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        {items.map((item, i) => (
          <motion.li
            key={item}
            initial={running ? { opacity: 0, x: -4 } : false}
            animate={{ opacity: 1, x: 0 }}
            transition={running ? { delay: i * 0.04, duration: 0.25 } : undefined}
            style={{ display: 'flex', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}
          >
            <span style={{ color: 'var(--accent-warning)', flexShrink: 0 }}>·</span>
            {item}
          </motion.li>
        ))}
      </ul>
    </motion.div>
  )
}
