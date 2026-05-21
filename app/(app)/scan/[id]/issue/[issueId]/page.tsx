'use client'

/**
 * S6 permalink — Fix Detail as a standalone route (DESIGN.md §10 hybrid).
 * Reuses IssueCard in REST context (flat, no streaming) for shareable case-study
 * links. Rest mode per DESIGN.md §3 / §12.1.
 *
 * D3 (now): renders the mock issue to prove the permalink architecture reuses the
 * same component in rest mode. D3 follow-up: fetch GET /api/scans/[id], map the
 * DB Issue → IssueVM, select by issueId.
 */

import { use } from 'react'
import Link from 'next/link'
import { IssueCard } from '@/components/phase-d/IssueCard'
import { MOCK_ISSUE } from '@/hooks/use-mock-scan'

export default function IssuePermalinkPage({
  params,
}: {
  params: Promise<{ id: string; issueId: string }>
}) {
  const { id } = use(params)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', padding: '2.5rem 2rem', maxWidth: '820px', margin: '0 auto' }}>
      <Link
        href={`/scan/${id}`}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)', textDecoration: 'none' }}
      >
        ← Back to scan
      </Link>

      <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: '1rem 0 0.25rem' }}>
        Fix Detail
      </h1>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '2rem' }}>
        Scan {id.slice(0, 12)} · Permalink · Playback
      </p>

      <IssueCard issue={MOCK_ISSUE} context="rest" defaultExpanded />
    </div>
  )
}
