'use client'

/**
 * IssueCard — absorbs S5/S6/S7 (DESIGN.md §10, §11). One component, three states:
 *   collapsed (S5)  → one-line summary + confidence badge
 *   expanded  (S6)  → diagnosis (what/why/evidence) + diff + Not Analyzed + actions
 *   pr-opened (S7)  → success morph: diff collapses, PR link surfaces
 *
 * Dual-mode (DESIGN.md §12.1):
 *   running → glow on badge, type-on entry, LED pulse on left border, particles
 *   rest    → flat, no glow/particles, hover-lift only
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { IssueVM } from './types'
import { ConfidenceBadge } from './ConfidenceBadge'
import { DiffViewer } from './DiffViewer'
import { NotAnalyzedCallout } from './NotAnalyzedCallout'

interface IssueCardProps {
  issue: IssueVM
  context?: 'running' | 'rest'
  defaultExpanded?: boolean
  /** Called when "Open Draft PR" is clicked. Parent performs submit + sets prUrl. */
  onOpenPR?: (issue: IssueVM) => void
  onReject?: (issue: IssueVM) => void
}

export function IssueCard({ issue, context = 'rest', defaultExpanded = false, onOpenPR, onReject }: IssueCardProps) {
  const running = context === 'running'
  const [expanded, setExpanded] = useState(defaultExpanded)
  const opened = !!issue.prUrl

  return (
    <motion.div
      initial={running ? { opacity: 0, x: -8 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={running ? { duration: 0.3 } : undefined}
      whileHover={!running ? { y: -1 } : undefined}
      style={{
        border: '1px solid var(--border-strong)',
        borderLeft: `2px solid ${opened ? 'var(--accent-primary)' : 'var(--accent-warning)'}`,
        background: 'var(--bg-1)',
        position: 'relative',
      }}
    >
      {/* Left-border LED pulse (running only) */}
      {running && !opened && (
        <motion.div
          aria-hidden
          style={{ position: 'absolute', left: -2, top: 0, bottom: 0, width: 2, background: 'var(--accent-warning)' }}
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* ── Summary row (S5) ── */}
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '0.875rem',
          padding: '0.875rem 1rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 200ms' }}>
          ▶
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 700 }}>
          {issue.dep}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
          {issue.currentVersion} <span style={{ color: 'var(--text-muted)' }}>→</span> {issue.latestVersion}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {opened ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', padding: '0.15rem 0.45rem' }}>
              PR Opened
            </span>
          ) : (
            <ConfidenceBadge level={issue.confidence} size="sm" />
          )}
        </span>
      </button>

      {/* ── Expanded detail (S6) + PR-opened (S7) ── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
              {opened ? (
                /* S7 — PR confirmation */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--accent-primary)' }}>
                    ✓ Draft PR opened — review required before merge.
                  </p>
                  <a href={issue.prUrl} target="_blank" rel="noopener noreferrer" className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.625rem' }}>
                    View on GitHub →
                  </a>
                </div>
              ) : (
                <>
                  {/* What / Why / Evidence */}
                  <Section label="What">{issue.what}</Section>
                  <Section label="Why">{issue.why}</Section>
                  <div>
                    <Label>Evidence</Label>
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.375rem' }}>
                      {issue.evidence.map((e) => (
                        <li key={e.url}>
                          <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--accent-secondary)', textDecoration: 'none' }}>
                            ↗ {e.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <DiffViewer filePath={issue.filePath} diff={issue.diff} context={context} />
                  <NotAnalyzedCallout items={issue.notAnalyzed} context={context} />

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <button onClick={() => onOpenPR?.(issue)} className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.625rem' }}>
                      Open Draft PR →
                    </button>
                    <button
                      onClick={() => onReject?.(issue)}
                      style={{
                        padding: '0.5rem 1rem',
                        border: '1px solid var(--border-strong)',
                        background: 'transparent',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.625rem',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
      {children}
    </span>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: '0.375rem' }}>{children}</p>
    </div>
  )
}
