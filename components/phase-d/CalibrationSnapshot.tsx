'use client'

/**
 * v1.5 Workstream #6 — Dashboard confidence-trends + regression-rate panel.
 *
 * Reads `scan.confidenceSummary` (persisted by the runner per W#6) and
 * renders three slices of the calibration story:
 *
 *   1. Trend sparkline: avg score per scan over the last N (chronological)
 *   2. Bucket distribution: stacked bar of high/medium/low across all scans
 *      that have calibrated data
 *   3. Regression rate: % of calibrated issues whose verification failed
 *
 * §5b honest framing:
 *   - When NO scans in the visible set have calibrated data (v1.0 only), the
 *     panel renders an empty state. We never fabricate zeros.
 *   - Sparkline + bars only plot scans whose summary.hasCalibratedData is
 *     true. Scans without calibration are excluded from aggregation, not
 *     counted as "0".
 *   - Each band's count is displayed; the user sees "based on N issues" so
 *     they can judge sample size.
 */

import type { ScanConfidenceSummary } from '@/lib/agent/confidence/summary'
import { motion } from 'framer-motion'

interface ScanWithSummary {
  id: string
  startedAt: string
  confidenceSummary?: string | null
}

interface CalibrationSnapshotProps {
  /** Scans newest-first (matches /api/scans GET order). */
  scans: ScanWithSummary[]
}

const SPARK_W = 240
const SPARK_H = 50

function parseSummary(raw: string | null | undefined): ScanConfidenceSummary | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ScanConfidenceSummary
  } catch {
    return null
  }
}

export function CalibrationSnapshot({ scans }: CalibrationSnapshotProps) {
  // Reverse for chronological (oldest → newest) so the trend line reads
  // left-to-right naturally.
  const chrono = [...scans].reverse()

  // Per-scan calibrated summaries (only those with data).
  const calibrated = chrono
    .map((s) => ({ s, summary: parseSummary(s.confidenceSummary) }))
    .filter((x): x is { s: ScanWithSummary; summary: ScanConfidenceSummary } =>
      x.summary !== null && x.summary.hasCalibratedData,
    )

  if (calibrated.length === 0) {
    return (
      <aside
        aria-label="Calibration snapshot"
        style={{
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-1)',
          padding: '1.25rem',
          display: 'flex', flexDirection: 'column', gap: '0.625rem',
        }}
      >
        <SectionLabel>Calibration Snapshot</SectionLabel>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
          color: 'var(--text-muted)', lineHeight: 1.5,
        }}>
          No calibrated scans yet. Once a v1.5 scan completes, this panel will
          show your confidence trend, bucket distribution, and verification
          regression rate.
        </p>
      </aside>
    )
  }

  // Aggregate buckets + regression across all calibrated scans.
  const totals = calibrated.reduce(
    (acc, { summary }) => {
      acc.high   += summary.bucketCounts.high
      acc.medium += summary.bucketCounts.medium
      acc.low    += summary.bucketCounts.low
      acc.calibrated += summary.issuesCalibrated
      acc.verifFails += Math.round(summary.verificationFailureRate * summary.issuesCalibrated)
      return acc
    },
    { high: 0, medium: 0, low: 0, calibrated: 0, verifFails: 0 },
  )
  const bucketTotal = totals.high + totals.medium + totals.low
  const regressionRate = totals.calibrated > 0 ? totals.verifFails / totals.calibrated : 0

  // "Latest avg" = avg score of the most recent calibrated scan. The trend
  // sparkline plots all scan averages over time; this rightmost label shows
  // the latest point so the user sees the headline + the trajectory at once.
  // (chrono[] is oldest→newest, so the last entry is the most recent.)
  const latestAvg = calibrated[calibrated.length - 1].summary.avgScore

  return (
    <aside
      aria-label="Calibration snapshot"
      style={{
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-1)',
        padding: '1.25rem',
        display: 'flex', flexDirection: 'column', gap: '1rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
        <SectionLabel>Calibration Snapshot</SectionLabel>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.5rem',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>
          across {calibrated.length} scan{calibrated.length === 1 ? '' : 's'} · {totals.calibrated} issue{totals.calibrated === 1 ? '' : 's'}
        </span>
      </div>

      {/* ── Trend sparkline ── */}
      <div>
        <RowLabel left="Avg confidence trend" right={`${latestAvg}/100 latest avg`} rightAccent={bucketColor(latestAvg)} />
        <TrendSparkline points={calibrated.map((c) => c.summary.avgScore)} />
      </div>

      {/* ── Bucket distribution stacked bar ── */}
      <div>
        <RowLabel left="Bucket distribution" right={`${bucketTotal} issue${bucketTotal === 1 ? '' : 's'}`} />
        <BucketBar high={totals.high} medium={totals.medium} low={totals.low} />
        <div style={{ display: 'flex', gap: '0.875rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
          <BucketLegend label="High" count={totals.high} color="var(--accent-primary)" />
          <BucketLegend label="Medium" count={totals.medium} color="var(--accent-warning)" />
          <BucketLegend label="Low" count={totals.low} color="var(--accent-danger)" />
        </div>
      </div>

      {/* ── Regression rate ── */}
      <div>
        <RowLabel left="Verification regression rate" right={`${Math.round(regressionRate * 100)}%`} rightAccent={regressionColor(regressionRate)} />
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
          color: 'var(--text-muted)', lineHeight: 1.5, marginTop: '0.375rem',
        }}>
          {totals.verifFails} of {totals.calibrated} calibrated issue{totals.calibrated === 1 ? '' : 's'} failed Phase-B verification. Lower is better.
        </p>
      </div>
    </aside>
  )
}

/* ─── Subcomponents ───────────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: 'var(--font-mono)', fontSize: '0.5rem',
      letterSpacing: '0.22em', textTransform: 'uppercase',
      color: 'var(--text-muted)',
    }}>{children}</p>
  )
}

function RowLabel({ left, right, rightAccent }: { left: string; right: string; rightAccent?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.625rem',
        letterSpacing: '0.1em', color: 'var(--text-secondary)',
      }}>{left}</span>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
        fontVariantNumeric: 'tabular-nums', fontWeight: 700,
        color: rightAccent ?? 'var(--text-primary)',
      }}>{right}</span>
    </div>
  )
}

function TrendSparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return (
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.625rem',
        color: 'var(--text-muted)', height: SPARK_H,
        display: 'flex', alignItems: 'center',
      }}>
        Need ≥ 2 calibrated scans for a trend line.
      </div>
    )
  }
  // Map score 0–100 → SVG y inverted. Fixed range so single-scan dips read
  // honestly (don't normalize to local min/max which would mask actual quality).
  const xs = points.map((_, i) => (i / (points.length - 1)) * SPARK_W)
  const ys = points.map((v) => SPARK_H - (Math.max(0, Math.min(100, v)) / 100) * SPARK_H)
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ')
  const latestColor = bucketColor(points[points.length - 1])

  return (
    <svg width={SPARK_W} height={SPARK_H} style={{ display: 'block', maxWidth: '100%' }} aria-hidden>
      {/* threshold lines at 60 + 80 — give the user a reference for buckets */}
      <line x1="0" y1={SPARK_H - (60 / 100) * SPARK_H} x2={SPARK_W} y2={SPARK_H - (60 / 100) * SPARK_H}
        stroke="var(--accent-warning)" strokeOpacity="0.18" strokeDasharray="2 3" />
      <line x1="0" y1={SPARK_H - (80 / 100) * SPARK_H} x2={SPARK_W} y2={SPARK_H - (80 / 100) * SPARK_H}
        stroke="var(--accent-primary)" strokeOpacity="0.18" strokeDasharray="2 3" />
      <motion.path
        d={path}
        fill="none"
        stroke={latestColor}
        strokeWidth="1.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      />
      {/* Last point dot */}
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="2.5" fill={latestColor} />
    </svg>
  )
}

function BucketBar({ high, medium, low }: { high: number; medium: number; low: number }) {
  const total = high + medium + low
  if (total === 0) {
    return <div style={{ height: 8, background: 'var(--bg-2)' }} />
  }
  const pct = (n: number) => `${(n / total) * 100}%`
  return (
    <div style={{ display: 'flex', height: 10, border: '1px solid var(--border-strong)', background: 'var(--bg-2)' }}>
      {high > 0 && (
        <motion.div
          initial={{ width: 0 }} animate={{ width: pct(high) }} transition={{ duration: 0.45, ease: 'easeOut' }}
          style={{ background: 'var(--accent-primary)' }}
          title={`High: ${high}`}
        />
      )}
      {medium > 0 && (
        <motion.div
          initial={{ width: 0 }} animate={{ width: pct(medium) }} transition={{ duration: 0.45, ease: 'easeOut', delay: 0.05 }}
          style={{ background: 'var(--accent-warning)' }}
          title={`Medium: ${medium}`}
        />
      )}
      {low > 0 && (
        <motion.div
          initial={{ width: 0 }} animate={{ width: pct(low) }} transition={{ duration: 0.45, ease: 'easeOut', delay: 0.10 }}
          style={{ background: 'var(--accent-danger)' }}
          title={`Low: ${low}`}
        />
      )}
    </div>
  )
}

function BucketLegend({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
      fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
      letterSpacing: '0.1em', color: 'var(--text-secondary)',
    }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}: <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </span>
  )
}

function bucketColor(score: number): string {
  if (score >= 80) return 'var(--accent-primary)'
  if (score >= 60) return 'var(--accent-warning)'
  return 'var(--accent-danger)'
}

function regressionColor(rate: number): string {
  // Low regression rate = green; high = red. Symmetric with bucket coloring.
  if (rate < 0.1) return 'var(--accent-primary)'
  if (rate < 0.3) return 'var(--accent-warning)'
  return 'var(--accent-danger)'
}
