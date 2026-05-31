'use client'

/**
 * S8 — Dashboard / Scan History (DESIGN.md §11 S8). Rest mode, Nixtio density.
 *
 * Audit 2026-05-27 rebuild:
 *   - Spec-mandated RIGHT RAIL with most-recent-scan summary (was missing).
 *   - Sparklines on ALL 4 stat cards (was 1).
 *   - Filter chips above table (All / Completed / Running / Failed) with counts.
 *   - Relative dates ("4d ago") alongside absolute on hover.
 *   - Row hover-lift transform (was hover-bg only).
 *   - Sparkline draw-in animation per DESIGN.md §11 S8 (was static).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { StatCard } from '@/components/phase-d/StatCard'
import { CalibrationSnapshot } from '@/components/phase-d/CalibrationSnapshot'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useToast } from '@/components/shared/toast'

interface ScanRecord {
  id: string
  repoUrl: string
  status: string
  startedAt: string
  completedAt?: string | null
  issuesFound?: number
  prsOpened?: number
  /** Fix #5 (audit-2): surfaced from the API for failed scans. */
  errorMessage?: string | null
  /** v1.5 W#6 — JSON-stringified ScanConfidenceSummary, null when not calibrated. */
  confidenceSummary?: string | null
}

type FilterKey = 'all' | 'completed' | 'running' | 'failed'

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return 'var(--accent-primary)'
    case 'running': return 'var(--accent-secondary)'
    case 'cancelled': return 'var(--accent-warning)'
    case 'failed':
    case 'error': return 'var(--accent-danger)'
    default: return 'var(--text-muted)'
  }
}

function repoName(url: string): string {
  return url.replace(/https?:\/\/github\.com\//, '').replace(/\.git$/, '')
}

/** Relative "time ago" string. Falls back to absolute date if > 30 days. */
function relTime(iso?: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function DashboardPage() {
  useDocumentTitle('Dashboard')
  const toast = useToast()
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterKey>('all')
  /* v1.5 W#10 Push 2 — PR-state sync. */
  const [syncing, setSyncing] = useState(false)

  const loadScans = useCallback(async () => {
    try {
      const r = await fetch('/api/scans')
      const data: unknown = await r.json()
      setScans(Array.isArray(data) ? (data as ScanRecord[]) : [])
    } catch {
      setScans([])
    }
  }, [])

  useEffect(() => {
    loadScans().finally(() => setLoading(false))
  }, [loadScans])

  /* v1.5 W#10 Push 2 (a) — poll GitHub for merge/close on Mendel-opened PRs.
     Auto-records rejections for closed-without-merge PRs (learning loop) and
     refreshes the dashboard. Real handler — never a dead control (§7.2a). */
  const handleSyncPrStates = useCallback(async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/poll-prs', { method: 'POST' })
      const data = (await res.json()) as {
        ok?: boolean
        summary?: {
          checked: number
          merged: number
          rejected: number
          stillOpen: number
          errors: Array<{ prUrl: string; reason: string; kind?: string }>
        }
        error?: unknown
      }
      if (!res.ok || !data.ok || !data.summary) {
        toast.error('PR sync failed. Check that a GitHub token is connected.')
        return
      }
      const s = data.summary
      if (s.checked === 0 && s.errors.length === 0) {
        toast.info('No open Mendel PRs to check.')
      } else if (s.checked > 0) {
        toast.success(`Checked ${s.checked} PR${s.checked !== 1 ? 's' : ''} · ${s.merged} merged · ${s.rejected} rejected · ${s.stillOpen} still open`)
      }
      if (s.errors.length > 0) {
        // v2.0 §5b — surface the REAL failure reason instead of one-size-fits-all
        // "network/auth". `not-found` means the repo / PR was deleted on GitHub;
        // `auth` means the PAT was rejected (revoked / scope / blocked account).
        const counts: Record<string, number> = {}
        for (const e of s.errors) counts[e.kind ?? 'unknown'] = (counts[e.kind ?? 'unknown'] ?? 0) + 1
        const labels: Record<string, string> = {
          'not-found':  'deleted / not found',
          'auth':       'auth (PAT rejected / blocked)',
          'rate-limit': 'rate-limited',
          'network':    'network',
          'unknown':    'unknown',
        }
        const parts = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `${n} ${labels[k] ?? k}`)
        toast.error(
          `${s.errors.length} PR${s.errors.length !== 1 ? 's' : ''} unchecked — ${parts.join(' · ')}`,
        )
      }
      await loadScans()
    } catch {
      toast.error('PR sync failed.')
    } finally {
      setSyncing(false)
    }
  }, [toast, loadScans])

  const stats = useMemo(() => {
    const issues = scans.reduce((s, x) => s + (x.issuesFound ?? 0), 0)
    const prs = scans.reduce((s, x) => s + (x.prsOpened ?? 0), 0)
    const failed = scans.filter((x) => x.status === 'failed' || x.status === 'cancelled').length
    const completed = scans.filter((x) => x.status === 'completed').length
    const running = scans.filter((x) => x.status === 'running').length

    // Sparkline series, oldest → newest (scans list is newest-first).
    const chrono = [...scans].reverse()
    const issuesSeries = chrono.map((x) => x.issuesFound ?? 0)
    const prsSeries = chrono.map((x) => x.prsOpened ?? 0)
    // Scans-run sparkline: cumulative count, so it rises monotonically (visualizes activity over time).
    const scansSeries = chrono.map((_, i) => i + 1)
    const failedSeries = chrono.map((x) => (x.status === 'failed' || x.status === 'cancelled') ? 1 : 0)

    return { scans: scans.length, issues, prs, failed, completed, running, issuesSeries, prsSeries, scansSeries, failedSeries }
  }, [scans])

  const filtered = useMemo(() => {
    if (filter === 'all') return scans
    if (filter === 'failed') return scans.filter((s) => s.status === 'failed' || s.status === 'cancelled')
    return scans.filter((s) => s.status === filter)
  }, [scans, filter])

  // Right rail: the most recent scan record (newest first → first element).
  const latest = scans[0]

  return (
    <div className="dashboard-shell" style={{ padding: '2.25rem 2rem', minHeight: '100vh' }}>
      {/* ── Stat row header strip ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
          Mendel // Dashboard
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {loading ? 'syncing…' : `${stats.scans} scan${stats.scans !== 1 ? 's' : ''} on record`}
        </span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="dashboard-stats"
        style={{ gap: '1px', background: 'var(--border-subtle)', border: '1px solid var(--border-subtle)', marginBottom: '2rem' }}
      >
        <StatCard label="Issues Found" value={stats.issues} accent="var(--accent-warning)" series={stats.issuesSeries} />
        <StatCard label="Draft PRs Opened" value={stats.prs} accent="var(--accent-primary)" series={stats.prsSeries} />
        <StatCard label="Scans Run" value={stats.scans} accent="var(--accent-secondary)" series={stats.scansSeries} />
        <StatCard label="Failed / Cancelled" value={stats.failed} accent="var(--accent-danger)" series={stats.failedSeries} />
      </motion.div>

      {/* ── Main grid: scan history (left) + most-recent rail (right) ── */}
      <div className="dashboard-main-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '1.25rem' }}>
        {/* === LEFT: scan history === */}
        <div style={{ minWidth: 0 }}>
          {/* Action bar with filter chips */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Scan History
              </span>
              <span style={{ width: 1, height: 14, background: 'var(--border-subtle)' }} />
              <FilterChip label="All"       count={stats.scans}     active={filter === 'all'}       onClick={() => setFilter('all')} />
              <FilterChip label="Completed" count={stats.completed} active={filter === 'completed'} onClick={() => setFilter('completed')} accent="var(--accent-primary)" />
              <FilterChip label="Running"   count={stats.running}   active={filter === 'running'}   onClick={() => setFilter('running')}   accent="var(--accent-secondary)" />
              <FilterChip label="Failed"    count={stats.failed}    active={filter === 'failed'}    onClick={() => setFilter('failed')}    accent="var(--accent-danger)" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              {/* v1.5 W#10 Push 2 (a) — sync PR states from GitHub. Wired, real. */}
              <button
                type="button"
                onClick={handleSyncPrStates}
                disabled={syncing}
                title="Check GitHub for merged / closed Mendel PRs and update the learning loop"
                style={{
                  padding: '0.5rem 1rem', fontSize: '0.625rem',
                  fontFamily: 'var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase',
                  border: '1px solid var(--accent-secondary)', color: 'var(--accent-secondary)',
                  background: 'transparent', cursor: syncing ? 'wait' : 'pointer',
                  opacity: syncing ? 0.5 : 1,
                }}
              >
                {syncing ? 'Syncing…' : '↻ Sync PR States'}
              </button>
              <Link href="/scan/new" className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.625rem' }}>
                + New Scan
              </Link>
            </div>
          </div>

          {/* Table / states */}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '4rem', border: '1px solid var(--border-subtle)', background: 'var(--bg-1)' }}>
              <motion.span
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--accent-secondary)' }}
              >
                loading scans…
              </motion.span>
            </div>
          ) : scans.length === 0 ? (
            <EmptyState />
          ) : filtered.length === 0 ? (
            <div style={{ padding: '3rem 2rem', textAlign: 'center', border: '1px solid var(--border-subtle)', background: 'var(--bg-1)' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                No scans match this filter.
              </p>
            </div>
          ) : (
            <div style={{ border: '1px solid var(--border-subtle)' }}>
              {/* header */}
              <div className="dashboard-thead" style={{ display: 'grid', gap: '1rem', padding: '0.625rem 1.25rem', background: 'var(--bg-2)', borderBottom: '1px solid var(--border-subtle)' }}>
                {['Repository', 'Date', 'Issues', 'PRs', 'Status'].map((h) => (
                  <span key={h} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{h}</span>
                ))}
              </div>
              {filtered.map((scan, i) => {
                const failed = scan.status === 'failed' || scan.status === 'cancelled'
                const absDate = scan.startedAt ? new Date(scan.startedAt).toLocaleString() : ''
                return (
                  <motion.div
                    key={scan.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.25 }}
                    /* Fix L-D4 audit 2026-05-27: hover-lift transform per DESIGN §11 S8
                       "Row hover lift" (was hover-bg only). */
                    whileHover={{ backgroundColor: 'var(--bg-2)', y: -1, transition: { duration: 0.15 } }}
                    /* Fix #5 (audit-2): show errorMessage on hover for failed/cancelled. */
                    title={failed && scan.errorMessage ? scan.errorMessage : absDate}
                    className="dashboard-row"
                    style={{ display: 'grid', gap: '1rem', padding: '0.8rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-1)', alignItems: 'center' }}
                  >
                    <Link
                      href={`/scan/${scan.id}`}
                      aria-label={`Open scan for ${repoName(scan.repoUrl)}`}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-primary)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                      {repoName(scan.repoUrl)}
                      {failed && scan.errorMessage && (
                        <span aria-hidden style={{ fontSize: '0.5625rem', color: 'var(--accent-danger)' }}>ⓘ</span>
                      )}
                    </Link>
                    <span title={absDate} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {relTime(scan.startedAt)}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--accent-warning)', fontVariantNumeric: 'tabular-nums' }}>
                      {scan.issuesFound ?? 0}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--accent-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {scan.prsOpened ?? 0}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: statusColor(scan.status) }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor(scan.status) }} />
                      {scan.status}
                    </span>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>

        {/* === RIGHT RAIL: most-recent-scan + v1.5 W#6 calibration snapshot === */}
        {!loading && latest && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: 'fit-content', position: 'sticky', top: '1.5rem' }}>
            <RecentScanRail scan={latest} />
            <CalibrationSnapshot scans={scans} />
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function FilterChip({
  label, count, active, onClick, accent = 'var(--text-primary)',
}: { label: string; count: number; active: boolean; onClick: () => void; accent?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
        padding: '0.25rem 0.55rem',
        fontFamily: 'var(--font-mono)', fontSize: '0.5rem',
        letterSpacing: '0.18em', textTransform: 'uppercase',
        background: active ? accent : 'transparent',
        color: active ? 'var(--bg-0)' : 'var(--text-secondary)',
        border: `1px solid ${active ? accent : 'var(--border-subtle)'}`,
        cursor: 'pointer',
        transition: 'all 160ms ease-out',
      }}
    >
      <span style={{ fontWeight: 700 }}>{label}</span>
      <span style={{ opacity: active ? 0.7 : 0.55, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </button>
  )
}

function EmptyState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '5rem 2rem', border: '1px solid var(--border-subtle)', background: 'var(--bg-1)', textAlign: 'center', gap: '1rem' }}>
      <span aria-hidden style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        ─── ◇ ───
      </span>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
        No scans on record yet.
      </p>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '38ch' }}>
        Point Mendel at a TypeScript repo and it will scan, diagnose, patch, verify, and open a Draft PR.
      </p>
      <Link href="/scan/new" className="btn-primary" style={{ marginTop: '0.5rem' }}>Start First Scan →</Link>
    </div>
  )
}

function RecentScanRail({ scan }: { scan: ScanRecord }) {
  const isRunning = scan.status === 'running'
  const isFailed = scan.status === 'failed' || scan.status === 'cancelled'
  const color = statusColor(scan.status)
  return (
    <aside
      aria-label="Most recent scan summary"
      style={{
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-1)',
        padding: '1.25rem',
        display: 'flex', flexDirection: 'column', gap: '1rem',
        height: 'fit-content',
        /* Sticky moved to parent wrapper (now holds RecentScanRail + CalibrationSnapshot). */
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Most Recent
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color }}>
          <motion.span
            style={{ width: 6, height: 6, borderRadius: '50%', background: color }}
            animate={isRunning ? { opacity: [0.3, 1, 0.3] } : { opacity: 1 }}
            transition={isRunning ? { duration: 1.2, repeat: Infinity } : undefined}
          />
          {scan.status}
        </span>
      </div>

      <div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {repoName(scan.repoUrl)}
        </p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          started {relTime(scan.startedAt)}
          {scan.completedAt && ` · completed ${relTime(scan.completedAt)}`}
        </p>
      </div>

      {/* Mini stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <RailStat label="Issues" value={scan.issuesFound ?? 0} accent="var(--accent-warning)" />
        <RailStat label="PRs" value={scan.prsOpened ?? 0} accent="var(--accent-primary)" />
      </div>

      {isFailed && scan.errorMessage && (
        <div style={{
          padding: '0.625rem 0.75rem',
          border: '1px solid var(--accent-danger)',
          background: 'rgba(255,77,94,0.06)',
          fontFamily: 'var(--font-mono)', fontSize: '0.625rem',
          color: 'var(--accent-danger)',
          maxHeight: '6rem', overflow: 'auto',
        }}>
          {scan.errorMessage}
        </div>
      )}

      <Link
        href={`/scan/${scan.id}`}
        className="btn-primary"
        style={{ padding: '0.5rem 1rem', fontSize: '0.5625rem', textAlign: 'center' }}
      >
        {isRunning ? 'Open Live Console →' : 'Open Scan →'}
      </Link>
    </aside>
  )
}

function RailStat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={{
      border: '1px solid var(--border-subtle)', background: 'var(--bg-2)',
      padding: '0.5rem 0.625rem',
      display: 'flex', flexDirection: 'column', gap: '0.125rem',
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', fontWeight: 700, color: accent, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {value}
      </span>
    </div>
  )
}
