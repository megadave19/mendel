'use client'

/**
 * S8 — Dashboard / Scan History (DESIGN.md §11 S8). Rest mode, Nixtio density.
 *
 * Header is a stat row (NOT the H1+subtitle template — anti-ref §13): bold
 * tabular numbers + sparkline. Below: dense scan-history table. Fills the screen
 * with real data so it never reads as the empty-black anti-pattern.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { StatCard } from '@/components/phase-d/StatCard'
import { MascotWidget } from '@/components/MascotWidget'
import { useDocumentTitle } from '@/hooks/use-document-title'

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
}

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

export default function DashboardPage() {
  useDocumentTitle('Dashboard')
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/scans')
      .then((r) => r.json())
      .then((data: unknown) => setScans(Array.isArray(data) ? (data as ScanRecord[]) : []))
      .catch(() => setScans([]))
      .finally(() => setLoading(false))
  }, [])

  const stats = useMemo(() => {
    const issues = scans.reduce((s, x) => s + (x.issuesFound ?? 0), 0)
    const prs = scans.reduce((s, x) => s + (x.prsOpened ?? 0), 0)
    const failed = scans.filter((x) => x.status === 'failed' || x.status === 'cancelled').length
    // Sparkline of issues-per-scan, oldest → newest (list is newest-first).
    const series = [...scans].reverse().map((x) => x.issuesFound ?? 0)
    return { scans: scans.length, issues, prs, failed, series }
  }, [scans])

  return (
    <div style={{ padding: '2.25rem 2rem', minHeight: '100vh' }}>
      {/* ── Stat row (rest-mode header) ── */}
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
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'var(--border-subtle)', border: '1px solid var(--border-subtle)', marginBottom: '2rem' }}
      >
        {/* Fix #6 (audit-2): replaced fabricated "Time Saved" with a real stat (failed/cancelled). */}
        <StatCard label="Issues Found" value={stats.issues} accent="var(--accent-warning)" series={stats.series} />
        <StatCard label="Draft PRs Opened" value={stats.prs} accent="var(--accent-primary)" />
        <StatCard label="Scans Run" value={stats.scans} accent="var(--accent-secondary)" />
        <StatCard label="Failed / Cancelled" value={stats.failed} accent="var(--accent-danger)" />
      </motion.div>

      {/* ── Action bar ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Scan History
        </span>
        <Link href="/scan/new" className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.625rem' }}>
          + New Scan
        </Link>
      </div>

      {/* ── Table / states ── */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <MascotWidget pose="scanning" size={120} />
        </div>
      ) : scans.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 2rem', border: '1px solid var(--border-subtle)', background: 'var(--bg-1)', textAlign: 'center', gap: '1.25rem' }}>
          <MascotWidget pose="idle" size={120} />
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>No scans yet. Point Mendel at a repo.</p>
          <Link href="/scan/new" className="btn-primary">Start First Scan →</Link>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-subtle)' }}>
          {/* header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 70px 70px 110px', gap: '1rem', padding: '0.625rem 1.25rem', background: 'var(--bg-2)', borderBottom: '1px solid var(--border-subtle)' }}>
            {['Repository', 'Date', 'Issues', 'PRs', 'Status'].map((h) => (
              <span key={h} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{h}</span>
            ))}
          </div>
          {scans.map((scan, i) => {
            const failed = scan.status === 'failed' || scan.status === 'cancelled'
            return (
              <motion.div
                key={scan.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.25 }}
                whileHover={{ backgroundColor: 'var(--bg-2)' }}
                /* Fix #5 (audit-2): show errorMessage on hover for failed/cancelled. */
                title={failed && scan.errorMessage ? scan.errorMessage : undefined}
                style={{ display: 'grid', gridTemplateColumns: '1fr 120px 70px 70px 110px', gap: '1rem', padding: '0.8rem 1.25rem', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-1)', alignItems: 'center' }}
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
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {scan.startedAt ? new Date(scan.startedAt).toLocaleDateString() : '—'}
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
  )
}
