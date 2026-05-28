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
import { useToast } from '@/components/shared/toast'
import { motion, AnimatePresence } from 'framer-motion'
import type { IssueVM } from './types'
import { ConfidenceBadge } from './ConfidenceBadge'
import { DiffViewer } from './DiffViewer'
import { NotAnalyzedCallout } from './NotAnalyzedCallout'

interface IssueCardProps {
  issue: IssueVM
  context?: 'running' | 'rest'
  defaultExpanded?: boolean
  /**
   * Optional controlled expansion (Fix L3 audit 2026-05-26: lets the DepGraph
   * open a card by id when its matching node is clicked). When supplied, the
   * card is fully controlled — defaultExpanded is ignored.
   */
  expanded?: boolean
  onExpandChange?: (expanded: boolean) => void
  /** Called when "Open Draft PR" is clicked. Parent performs submit + sets prUrl. */
  onOpenPR?: (issue: IssueVM) => void
  onReject?: (issue: IssueVM) => void
  /** Fix #15: when provided, render a "share" link to the issue's permalink. */
  scanId?: string
}

export function IssueCard({
  issue, context = 'rest', defaultExpanded = false,
  expanded: controlledExpanded, onExpandChange,
  onOpenPR, onReject, scanId,
}: IssueCardProps) {
  const running = context === 'running'
  const [innerExpanded, setInnerExpanded] = useState(defaultExpanded)
  const isControlled = controlledExpanded !== undefined
  const expanded = isControlled ? controlledExpanded : innerExpanded
  const setExpanded = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(expanded) : next
    if (isControlled) onExpandChange?.(resolved)
    else setInnerExpanded(resolved)
  }
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
        /* Fix U3 (audit 2026-05-26): delivered cards get a subtle lime glow +
           top inset highlight so they visually rise above still-draft cards.
           Combined with the sort order in scan/[id]/page.tsx, this gives
           "delivered" the visual elevation it earns. */
        boxShadow: opened
          ? '0 0 24px rgba(198,255,61,0.12), inset 0 1px 0 rgba(198,255,61,0.18)'
          : undefined,
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
      {/* Container is a div (not button) so the share <a> inside is valid HTML.
          Keyboard support: Enter / Space toggles. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((v) => !v)
          }
        }}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '0.875rem',
          padding: '0.875rem 1rem',
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
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.625rem', flexShrink: 0 }}>
          {/* Fix #15 (audit-2 fix-2): share link lives INSIDE the header row, before
              the badge, so it never overlaps PR-Opened / Confidence-Medium. */}
          {scanId && (
            <a
              href={opened ? `/scan/${scanId}/pr/${issue.id}` : `/scan/${scanId}/issue/${issue.id}`}
              onClick={(e) => e.stopPropagation()}
              aria-label="Open this issue in a standalone permalink view"
              style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.12em',
                textTransform: 'uppercase', color: 'var(--text-muted)', textDecoration: 'none',
              }}
            >
              ↗ share
            </a>
          )}
          {opened ? (
            /* Fix B6 (audit 2026-05-26): filled (not outlined) so "delivered"
               reads unambiguously as success — previously the lime outline on
               dark bg looked amber/warning next to the medium-confidence
               badges on sibling cards. */
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
              letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'var(--bg-0)', background: 'var(--accent-primary)',
              padding: '0.2rem 0.55rem', fontWeight: 700,
              boxShadow: '0 0 12px rgba(198,255,61,0.35)',
            }}>
              ✓ PR Opened
            </span>
          ) : (
            /* v1.5 Workstream #4: surface calibrated bucket + score when
               persisted. Falls back to bucket-only label for v1.0 stub data. */
            <ConfidenceBadge
              level={issue.confidence}
              score={issue.confidenceData?.score}
              capped={issue.confidenceData?.capped}
              size="sm"
            />
          )}
        </span>
      </div>

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
              {/* Fix U4 + L2 (audit 2026-05-26): when a PR has been opened, the
                  expanded state previously only showed a "Draft PR opened" line
                  + a GitHub button — hiding all the diff/diagnosis/Not-Analyzed
                  detail. That made the user click out just to see what changed.
                  Now: PR-opened state PREPENDS a success banner, then shows the
                  same full detail (diagnosis, diff, Not Analyzed) as a draft. */}

              {opened && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.625rem 0.75rem',
                  border: '1px solid var(--accent-primary)',
                  background: 'rgba(198,255,61,0.06)',
                  boxShadow: '0 0 16px rgba(198,255,61,0.15)',
                  flexWrap: 'wrap',
                }}>
                  <span style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 700 }}>✓</span>
                  <span style={{ flex: 1, minWidth: '15rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                    Draft PR opened — review required before merge.
                  </span>
                  <a
                    href={issue.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary"
                    style={{ padding: '0.4rem 0.875rem', fontSize: '0.5625rem' }}
                  >
                    View on GitHub →
                  </a>
                  {/* v1.5 W#10 — "Mark as rejected" feeds RejectionPattern so
                      future diagnoses on this dep get the prior failure as
                      negative-example context. */}
                  <RejectionButton issue={issue} />
                </div>
              )}

              {/* v1.5 Workstream #4: Calibration block — surfaces the
                  calibrated bucket + score + per-symbol tags when the issue
                  was scored with the v1.5 engine. Hidden on v1.0 stub data
                  to avoid surfacing missing numbers. */}
              {issue.confidenceData && <CalibrationBlock data={issue.confidenceData} />}

              {/* What / Why / Evidence — always shown when expanded */}
              <Section label="What">{issue.what}</Section>
              <Section label="Why">{issue.why}</Section>
              {issue.evidence.length > 0 && (
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
              )}

              {issue.diff.length > 0 && <DiffViewer filePath={issue.filePath} diff={issue.diff} context={context} />}
              <NotAnalyzedCallout items={issue.notAnalyzed} context={context} />

              {/* Actions — hidden once a PR has been opened (the work is done).
                  Only render in interactive/demo mode anyway: the real autonomous
                  flow opens the PR itself via the 'pr' event → S7 state. */}
              {!opened && onOpenPR && (
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <button onClick={() => onOpenPR(issue)} className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.625rem' }}>
                    Open Draft PR →
                  </button>
                  {onReject && (
                    <button
                      onClick={() => onReject(issue)}
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
                  )}
                </div>
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

/**
 * v1.5 W#10 — Mark-as-rejected button. Wired to POST /api/rejections.
 * Records the user's reason for closing the PR, which feeds future
 * diagnoses on this dep as negative-example context. Honest:
 *   - prompts for a real reason (cancel if empty)
 *   - toasts success/failure
 *   - on success, button collapses to a "Recorded ✓" pill so the user
 *     can't accidentally re-submit
 */
function RejectionButton({ issue }: { issue: IssueVM }) {
  const toast = useToast()
  const [recorded, setRecorded] = useState(false)
  const [busy, setBusy] = useState(false)

  if (recorded) {
    return (
      <span title="This rejection is now in the learning loop" style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--text-muted)', border: '1px solid var(--border-strong)',
        padding: '0.4rem 0.625rem',
      }}>
        ✓ Recorded for learning
      </span>
    )
  }

  const onClick = async () => {
    if (busy) return
    const reason = window.prompt(
      `Mark this PR as rejected for ${issue.dep}?\n\nBriefly describe why (will be fed to future diagnoses on this dep as negative-example context):`,
    )
    if (!reason || reason.trim().length < 3) return
    setBusy(true)
    try {
      const res = await fetch('/api/rejections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depName: issue.dep,
          rejectionReason: reason.trim(),
          prUrl: issue.prUrl ?? '',
          // changeType is hard to infer at UI layer; leave undefined and
          // recall falls back to depName-only match.
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(`Failed to record rejection: ${(data as { error?: unknown }).error ?? res.status}`)
        return
      }
      setRecorded(true)
      toast.success(`Rejection recorded for ${issue.dep} — future scans will see this pattern.`)
    } catch (err) {
      toast.error(`Network error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy || !issue.prUrl}
      title="Tell Mendel this PR didn't work — feeds future diagnoses on this dep"
      style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--accent-danger)',
        border: '1px solid var(--accent-danger)',
        background: 'transparent',
        padding: '0.4rem 0.625rem',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.5 : 1,
      }}
    >
      {busy ? 'Recording…' : '✕ Mark as rejected'}
    </button>
  )
}

/**
 * v1.5 Workstream #4 — calibration detail rendered inside the expanded
 * IssueCard. Shows: overall score + bucket, signal coverage tier, per-symbol
 * tags (e.g., "undocumented breaking change"). Mirrors the PR body block
 * built in `lib/agent/phases/submit.ts` so the in-app view and the GitHub PR
 * view tell the same story.
 */
function CalibrationBlock({ data }: { data: NonNullable<IssueVM['confidenceData']> }) {
  const bucketColor =
    data.bucket === 'high' ? 'var(--accent-primary)' :
    data.bucket === 'low'  ? 'var(--accent-danger)'  :
                              'var(--accent-warning)'
  const bucketGlow =
    data.bucket === 'high' ? 'rgba(198,255,61,0.18)' :
    data.bucket === 'low'  ? 'rgba(255,77,94,0.18)'  :
                              'rgba(255,184,77,0.18)'
  const tagged = data.perBreakingChange.filter((p) => !!p.tag).slice(0, 6)

  return (
    <div style={{
      border: `1px solid ${bucketColor}`,
      background: bucketGlow,
      padding: '0.75rem 0.875rem',
      display: 'flex', flexDirection: 'column', gap: '0.5rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.625rem', flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.625rem', fontWeight: 700,
          letterSpacing: '0.18em', textTransform: 'uppercase', color: bucketColor,
        }}>
          ▸ Calibrated Confidence
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.9375rem', fontWeight: 700,
          color: bucketColor, fontVariantNumeric: 'tabular-nums',
        }}>
          {data.score}/100
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
          letterSpacing: '0.14em', textTransform: 'uppercase',
          color: bucketColor, opacity: 0.85,
        }}>
          {data.bucket}
        </span>
        {data.capped && (
          <span title="Verification failed — score capped at 50" style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.5rem',
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: 'var(--accent-danger)',
            border: '1px solid var(--accent-danger)', padding: '0.1rem 0.4rem',
          }}>
            ⚠ capped
          </span>
        )}
        <span style={{
          marginLeft: 'auto',
          fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
          color: 'var(--text-muted)', letterSpacing: '0.08em',
        }}>
          {data.tier} · {data.coveragePercent}% coverage
        </span>
      </div>
      {tagged.length > 0 && (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.125rem' }}>
          {tagged.map((p) => (
            <li key={p.symbol} style={{
              display: 'flex', alignItems: 'baseline', gap: '0.5rem',
              fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
              color: 'var(--text-secondary)',
            }}>
              <code style={{ color: 'var(--accent-secondary)' }}>{p.symbol}</code>
              <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{p.score}/100</span>
              <span style={{ color: 'var(--text-muted)' }}>·</span>
              <span style={{ color: 'var(--text-primary)' }}>{p.tag}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
