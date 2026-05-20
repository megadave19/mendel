'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Skull } from '@/components/mascot/skull'

interface ScanRecord {
  id: string
  repoUrl: string
  status: string
  startedAt: string        // field name from Prisma schema
  issuesFound?: number     // field name from Prisma schema
  prsOpened?: number
  prUrl?: string
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return 'var(--accent-primary)'
    case 'running': return 'var(--accent-secondary)'
    case 'error': return 'var(--accent-danger)'
    default: return 'var(--text-muted)'
  }
}

function repoName(url: string): string {
  return url.replace(/https?:\/\/github\.com\//, '').replace(/\.git$/, '')
}

export default function DashboardPage() {
  const [scans, setScans] = useState<ScanRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/scans')
      .then((r) => r.json())
      .then((data: unknown) => {
        setScans(Array.isArray(data) ? (data as ScanRecord[]) : [])
      })
      .catch(() => setScans([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ padding: '2.5rem 2rem', minHeight: '100vh' }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ marginBottom: '2.5rem' }}
      >
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.5625rem',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--accent-primary)',
          marginBottom: '0.5rem',
        }}>Mendel</p>
        <h1 style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.875rem',
          fontWeight: 700,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
          marginBottom: '0.25rem',
        }}>Scan History</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          All repository scans · Draft PRs only · Confidence: medium
        </p>
      </motion.div>

      {/* Action bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.625rem',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>
          {loading ? 'Loading…' : `${scans.length} scan${scans.length !== 1 ? 's' : ''}`}
        </span>
        <Link href="/scan/new" className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.625rem' }}>
          + New Scan
        </Link>
      </div>

      {/* Table or empty state */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <Skull state="waiting" size={64} showLabel />
        </div>
      ) : scans.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '5rem 2rem',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-1)',
            textAlign: 'center',
          }}
        >
          <Skull state="idle" size={80} showLabel />
          <h2 style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '1rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginTop: '1.5rem',
            marginBottom: '0.5rem',
          }}>No scans yet</h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Point me at a GitHub repo and I&apos;ll find the stale deps.
          </p>
          <Link href="/scan/new" className="btn-primary">
            Start First Scan →
          </Link>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 120px 80px 100px 120px',
            gap: '1rem',
            padding: '0.625rem 1.25rem',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            {['Repository', 'Date', 'Deps', 'Status', 'PR'].map((h) => (
              <span key={h} style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.5625rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}>{h}</span>
            ))}
          </div>

          {/* Rows */}
          {scans.map((scan, i) => (
            <motion.div
              key={scan.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 120px 80px 100px 120px',
                gap: '1rem',
                padding: '0.875rem 1.25rem',
                borderBottom: '1px solid var(--border-subtle)',
                background: 'var(--bg-1)',
                alignItems: 'center',
              }}
            >
              <Link
                href={`/scan/${scan.id}`}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8125rem',
                  color: 'var(--text-primary)',
                  textDecoration: 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {repoName(scan.repoUrl)}
              </Link>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                {scan.startedAt ? new Date(scan.startedAt).toLocaleDateString() : '—'}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                {scan.issuesFound ?? '—'}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.5625rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: statusColor(scan.status),
              }}>
                {scan.status}
              </span>
              <div>
                {scan.prUrl ? (
                  <a
                    href={scan.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.625rem',
                      color: 'var(--accent-primary)',
                      textDecoration: 'none',
                      letterSpacing: '0.08em',
                    }}
                  >
                    View PR →
                  </a>
                ) : (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)' }}>
                    —
                  </span>
                )}
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  )
}
