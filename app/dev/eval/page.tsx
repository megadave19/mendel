/**
 * /dev/eval — Calibration Bench dashboard (v2.0 / F19, optional).
 *
 * Read-only visualization of `eval/reports/baseline.json` (the committed
 * honesty anchor) — same data `pnpm eval` prints to a terminal, rendered
 * as Nixtio-dense stat cards + a calibration scatter + bucket-confusion
 * grid + per-fixture table.
 *
 * Dev surface — deliberately:
 *   - lives at /dev/* (not in the authed app nav)
 *   - server component, reads FS directly, NO API route (per V2_PLAN §F19:
 *     "Eval must not be reachable from the web app — it's a dev/CI
 *     instrument, not a user surface")
 *   - no mascot, no scan lifecycle, no auth, no inputs
 *
 * Honest rendering rules (CLAUDE.md §5b):
 *   - When baseline.json is missing → empty-state with the exact command
 *     to seed it. We don't synthesize fake "100%" placeholders.
 *   - The "pass" tag on a fixture row reflects the stored boolean — never
 *     a re-computation that could disagree with the committed baseline.
 */

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import { CalibrationReportSchema, type CalibrationReport } from '@/lib/eval/types'
import { PanelFrame } from '@/components/phase-d/PanelFrame'
import { StatCard } from '@/components/phase-d/StatCard'

export const dynamic = 'force-dynamic' // always re-read the file on request

// ── Loading the baseline (server-only) ────────────────────────────────────────

function loadBaseline(): { report: CalibrationReport | null; error: string | null } {
  const file = path.resolve(process.cwd(), 'eval/reports/baseline.json')
  if (!existsSync(file)) {
    return { report: null, error: `No baseline at ${path.relative(process.cwd(), file)}` }
  }
  try {
    const raw = readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw)
    const validated = CalibrationReportSchema.parse(parsed)
    return { report: validated, error: null }
  } catch (err) {
    return { report: null, error: `Baseline is malformed: ${(err as Error).message}` }
  }
}

// ── Components ────────────────────────────────────────────────────────────────

function EmptyState({ reason }: { reason: string }) {
  return (
    <main style={{ padding: '2.5rem 2rem', minHeight: '100vh' }}>
      <Header label="Calibration Bench" sub="No baseline" />
      <div style={{ marginTop: '1.5rem', maxWidth: '60ch' }}>
        <PanelFrame title="No baseline report" accent="var(--accent-warning)">
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1rem' }}>
            {reason}.
          </p>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Seed the honesty anchor by running:
          </p>
          <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', background: 'var(--bg-2)', border: '1px solid var(--border-subtle)', padding: '0.75rem', marginTop: '0.5rem', color: 'var(--accent-primary)' }}>
            pnpm eval --update-baseline
          </pre>
        </PanelFrame>
      </div>
    </main>
  )
}

function Header({ label, sub }: { label: string; sub: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
        Mendel // {label}
      </span>
      <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {sub}
      </span>
    </div>
  )
}

// ── Calibration scatter (SVG, server-renderable) ─────────────────────────────
//
// X = expected overall (midpoint of the fixture's [min,max]).
// Y = observed overall (what the scorer produced).
// Diagonal y=x marks perfect calibration. Bucket boundaries at 60 (medium)
// and 80 (high) are drawn as faint grid lines. A dot per fixture: lime
// when it passed (bucket+range), red when it didn't.
//
// All-passing fixtures will cluster on the diagonal — that's the visual
// "100% bucket / 100% in-range" signal at a glance.

const PLOT_SIZE = 320
const PLOT_PAD = 28

function CalibrationScatter({ report }: { report: CalibrationReport }) {
  const points = report.fixtures.map((f) => {
    const expectedMid = Math.round((f.expectedOverallMin + f.expectedOverallMax) / 2)
    return {
      id: f.id,
      passed: f.passed,
      x: expectedMid,
      y: f.observedOverall,
    }
  })

  function px(v: number): number {
    return PLOT_PAD + (v / 100) * (PLOT_SIZE - 2 * PLOT_PAD)
  }
  function py(v: number): number {
    // SVG Y grows downward — flip so high scores plot high.
    return PLOT_SIZE - PLOT_PAD - (v / 100) * (PLOT_SIZE - 2 * PLOT_PAD)
  }

  return (
    <svg
      role="img"
      aria-label="Calibration scatter: expected (x) vs. observed (y) confidence"
      width={PLOT_SIZE}
      height={PLOT_SIZE}
      style={{ display: 'block', background: 'var(--bg-2)', border: '1px solid var(--border-subtle)' }}
    >
      {/* bucket grid lines: 60 medium / 80 high */}
      {[60, 80].map((b) => (
        <g key={b}>
          <line x1={px(b)} y1={PLOT_PAD} x2={px(b)} y2={PLOT_SIZE - PLOT_PAD} stroke="var(--border-subtle)" strokeDasharray="2,3" />
          <line x1={PLOT_PAD} y1={py(b)} x2={PLOT_SIZE - PLOT_PAD} y2={py(b)} stroke="var(--border-subtle)" strokeDasharray="2,3" />
        </g>
      ))}
      {/* axes */}
      <line x1={PLOT_PAD} y1={PLOT_SIZE - PLOT_PAD} x2={PLOT_SIZE - PLOT_PAD} y2={PLOT_SIZE - PLOT_PAD} stroke="var(--border-strong)" />
      <line x1={PLOT_PAD} y1={PLOT_PAD} x2={PLOT_PAD} y2={PLOT_SIZE - PLOT_PAD} stroke="var(--border-strong)" />
      {/* perfect-calibration diagonal */}
      <line x1={px(0)} y1={py(0)} x2={px(100)} y2={py(100)} stroke="var(--accent-secondary)" strokeOpacity="0.4" strokeDasharray="4,4" />
      {/* axis labels */}
      {[0, 50, 60, 80, 100].map((t) => (
        <g key={`tx-${t}`}>
          <text x={px(t)} y={PLOT_SIZE - PLOT_PAD + 14} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9" fill="var(--text-muted)">{t}</text>
          <text x={PLOT_PAD - 8} y={py(t) + 3} textAnchor="end" fontFamily="var(--font-mono)" fontSize="9" fill="var(--text-muted)">{t}</text>
        </g>
      ))}
      <text x={PLOT_SIZE / 2} y={PLOT_SIZE - 4} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9" fill="var(--text-secondary)">expected →</text>
      <text x={10} y={PLOT_SIZE / 2} textAnchor="middle" transform={`rotate(-90 10 ${PLOT_SIZE / 2})`} fontFamily="var(--font-mono)" fontSize="9" fill="var(--text-secondary)">observed →</text>
      {/* points */}
      {points.map((p) => (
        <g key={p.id}>
          <title>{`${p.id}: expected≈${p.x}, observed=${p.y} (${p.passed ? 'pass' : 'fail'})`}</title>
          <circle
            cx={px(p.x)}
            cy={py(p.y)}
            r={5}
            fill={p.passed ? 'var(--accent-primary)' : 'var(--accent-danger)'}
            fillOpacity="0.85"
            stroke={p.passed ? 'var(--accent-primary)' : 'var(--accent-danger)'}
          />
        </g>
      ))}
    </svg>
  )
}

// ── Confusion matrix grid ────────────────────────────────────────────────────

function ConfusionMatrix({ report }: { report: CalibrationReport }) {
  const c = report.bucketConfusion
  const rows = ['high', 'medium', 'low'] as const
  return (
    <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
      <thead>
        <tr>
          <th style={{ padding: '0.4rem 0.65rem', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.6rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>expected ↓ / observed →</th>
          {rows.map((r) => (
            <th key={r} style={{ padding: '0.4rem 0.85rem', textAlign: 'center', color: 'var(--accent-secondary)', fontWeight: 400 }}>{r}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row} style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <td style={{ padding: '0.4rem 0.65rem', color: 'var(--accent-secondary)' }}>{row}</td>
            {rows.map((col) => {
              const v = c[row][col]
              const isDiagonal = row === col
              const color = v === 0 ? 'var(--text-muted)' : isDiagonal ? 'var(--accent-primary)' : 'var(--accent-danger)'
              return (
                <td key={col} style={{ padding: '0.4rem 0.85rem', textAlign: 'center', color }}>{v}</td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Per-fixture table ────────────────────────────────────────────────────────

function FixturesTable({ report }: { report: CalibrationReport }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
      <thead>
        <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.625rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          <th style={{ padding: '0.5rem 0.5rem' }}>status</th>
          <th style={{ padding: '0.5rem 0.5rem' }}>id</th>
          <th style={{ padding: '0.5rem 0.5rem' }}>package</th>
          <th style={{ padding: '0.5rem 0.5rem' }}>expected</th>
          <th style={{ padding: '0.5rem 0.5rem' }}>observed</th>
          <th style={{ padding: '0.5rem 0.5rem' }}>ms</th>
        </tr>
      </thead>
      <tbody>
        {report.fixtures.map((f) => (
          <tr key={f.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <td style={{ padding: '0.5rem 0.5rem', color: f.passed ? 'var(--accent-primary)' : 'var(--accent-danger)' }}>
              {f.passed ? '✓' : '✕'}
            </td>
            <td style={{ padding: '0.5rem 0.5rem', color: 'var(--text-primary)' }}>{f.id}</td>
            <td style={{ padding: '0.5rem 0.5rem', color: 'var(--text-secondary)' }}>
              {f.packageName} {f.fromVersion}→{f.toVersion}
            </td>
            <td style={{ padding: '0.5rem 0.5rem', color: 'var(--text-secondary)' }}>
              {f.expectedBucket} · [{f.expectedOverallMin}, {f.expectedOverallMax}]
            </td>
            <td style={{ padding: '0.5rem 0.5rem', color: f.bucketMatch ? 'var(--text-primary)' : 'var(--accent-danger)' }}>
              {f.observedBucket} · {f.observedOverall}
            </td>
            <td style={{ padding: '0.5rem 0.5rem', color: 'var(--text-muted)' }}>{f.durationMs}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DevEvalPage() {
  const { report, error } = loadBaseline()
  if (!report) return <EmptyState reason={error ?? 'Unknown error'} />

  const t = report.totals
  const dt = new Date(report.generatedAt)
  const ts = `${dt.toISOString().replace('T', ' ').slice(0, 19)} UTC`

  return (
    <main style={{ padding: '2.25rem 2rem', minHeight: '100vh' }}>
      <Header label="Calibration Bench" sub="read-only · honesty anchor" />

      {/* Title + meta */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.5rem', marginBottom: '1.75rem' }}>
        <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.625rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {report.release.label}
        </h1>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
          generated {ts}
          {report.release.gitCommit ? ` · commit ${report.release.gitCommit.slice(0, 12)}` : ''}
        </p>
      </div>

      {/* Headline stat cards (Nixtio density) */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.875rem', marginBottom: '1.5rem' }}>
        <StatCard label="Fixtures" value={t.fixtures} accent="var(--accent-secondary)" />
        <StatCard label="Passed" value={t.passed} unit={`/${t.fixtures}`} accent="var(--accent-primary)" />
        <StatCard label="Bucket accuracy" value={Math.round(t.bucketAccuracyPercent)} unit="%" accent="var(--accent-primary)" />
        <StatCard label="In-range" value={Math.round(t.overallInRangePercent)} unit="%" accent="var(--accent-primary)" />
      </section>

      {/* Scatter + confusion side-by-side */}
      <section style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
        <PanelFrame title="Calibration scatter" accent="var(--accent-secondary)">
          <CalibrationScatter report={report} />
          <p style={{ marginTop: '0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)' }}>
            cyan dashed = perfect calibration (y=x) · grid lines at bucket boundaries (60, 80)
          </p>
        </PanelFrame>
        <PanelFrame title="Bucket confusion" accent="var(--accent-secondary)">
          <ConfusionMatrix report={report} />
          <p style={{ marginTop: '0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)' }}>
            diagonal = correct · off-diagonal = misclassified
          </p>
        </PanelFrame>
      </section>

      {/* Per-fixture table */}
      <PanelFrame title={`Per-fixture (${report.fixtures.length})`} accent="var(--accent-primary)">
        <FixturesTable report={report} />
      </PanelFrame>

      <p style={{ marginTop: '1.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)' }}>
        source: <code>eval/reports/baseline.json</code> · re-baseline with{' '}
        <code style={{ color: 'var(--accent-primary)' }}>pnpm eval --update-baseline</code> · regenerate with{' '}
        <code style={{ color: 'var(--accent-primary)' }}>pnpm eval</code>{' '}
        <Link href="/dev/mascot" style={{ marginLeft: '0.75rem', color: 'var(--accent-secondary)' }}>/dev/mascot →</Link>
      </p>
    </main>
  )
}
