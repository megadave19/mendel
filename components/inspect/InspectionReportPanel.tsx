'use client'

/**
 * v2.1 / F22 — Inspection report panel. Renders an ApiReport in the same
 * visual vocabulary as a scan issue (PanelFrame chrome, mono type,
 * per-symbol breakdown), but with semantics tuned to report-mode:
 *
 *   - No PR, no "Open Draft PR" action.
 *   - No diff (there's no patch — inspect mode is pure analysis).
 *   - Per-symbol findings rendered straight from the calibrated score's
 *     `perBreakingChange` list.
 *   - The header reads `pkg@from → to`, same shape as the IssueCard.
 *
 * §5b honesty: every number on screen comes from the persisted report —
 * we don't synthesize, don't soften, don't inflate. If the report's
 * `breakingChanges` is empty AND semanticDiff found nothing, we say
 * "No breaking changes detected by either signal" — not "the upgrade is
 * safe."
 */

import { PanelFrame } from '@/components/phase-d/PanelFrame'
import type { ApiReport } from '@/lib/agent/inspect'

export interface InspectionVM {
  packageName: string
  fromVersion: string
  toVersion: string
  report: ApiReport
}

export function InspectionReportPanel({ vm }: { vm: InspectionVM }) {
  const { packageName, fromVersion, toVersion, report } = vm
  const total = report.confidence.perBreakingChange.length
  const hasFindings = total > 0 || report.breakingChanges.length > 0 || (report.semanticDiff?.removedExports.length ?? 0) > 0

  return (
    <PanelFrame
      title={`${packageName} ${fromVersion} → ${toVersion}`}
      accent={
        report.confidence.bucket === 'low'
          ? 'var(--accent-danger)'
          : 'var(--accent-warning)' // medium — never high in inspect mode
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {/* Headline */}
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
          Calibrated confidence {report.confidence.overall}/100 ({report.confidence.bucket})
          {report.structuralCap !== null && (
            <>
              {' '}· <span style={{ color: 'var(--accent-warning)' }}>capped (report-only)</span>
            </>
          )}
          {' '}· {report.confidence.analysisCoverage.percentCovered}% analyzed via {' '}
          <code style={{ color: 'var(--accent-secondary)' }}>{report.confidence.analysisCoverage.analysisTier}</code>
          {' '}· generated {new Date(report.generatedAt).toLocaleString()}
        </p>

        {/* No-findings honest state */}
        {!hasFindings && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
            No breaking changes detected by either signal. This is NOT a guarantee — the
            registered version range may have changes that are not surfaced via release notes
            or .d.ts exports. Verify against your repo for a stronger guarantee.
          </p>
        )}

        {/* Per-symbol findings — the highest-information block */}
        {total > 0 && (
          <div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Findings · {total}
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {report.confidence.perBreakingChange.map((p) => (
                <li
                  key={p.symbol}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.875rem',
                    alignItems: 'baseline', borderBottom: '1px dashed var(--border-subtle)',
                    paddingBottom: '0.375rem',
                  }}
                >
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-primary)' }}>
                    {p.symbol}
                  </code>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                    {p.score}/100
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
                      letterSpacing: '0.1em', textTransform: 'lowercase',
                      color: p.tag ? 'var(--accent-warning)' : 'var(--text-muted)',
                    }}
                  >
                    {p.tag ?? `signals: ${p.signalsAgreeing.join(' + ') || 'none'}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Evidence — citations from the changelog signal. Rendered only
            when present so the panel doesn't show an empty "Evidence" header
            when the changelog signal was skipped. */}
        {report.breakingChanges.length > 0 && (
          <div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Evidence (release notes)
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {report.breakingChanges.slice(0, 8).map((bc, i) => (
                <li key={`${bc.symbol}-${i}`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-secondary)' }}>
                  · <a href={bc.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-secondary)' }}>
                    {bc.symbol}
                  </a>{' '}({bc.changeType}) — {bc.description.slice(0, 140)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </PanelFrame>
  )
}
