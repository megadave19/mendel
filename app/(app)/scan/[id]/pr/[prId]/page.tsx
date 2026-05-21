'use client'

/**
 * S7 permalink — PR Confirmation as a standalone route (DESIGN.md §10 hybrid).
 * Reuses IssueCard in REST context with the PR already opened (shows the S7
 * success state). Useful for case-study links.
 *
 * D3 (now): mock issue + mock PR URL. D3 follow-up: fetch the real scan/issue and
 * its prUrl from GET /api/scans/[id].
 */

import { use } from 'react'
import Link from 'next/link'
import { IssueCard } from '@/components/phase-d/IssueCard'
import { MOCK_ISSUE } from '@/hooks/use-mock-scan'

export default function PrPermalinkPage({
  params,
}: {
  params: Promise<{ id: string; prId: string }>
}) {
  const { id } = use(params)
  const issueWithPr = { ...MOCK_ISSUE, prUrl: 'https://github.com/megadave19/mendel-test/pull/2' }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', padding: '2.5rem 2rem', maxWidth: '820px', margin: '0 auto' }}>
      <Link
        href={`/scan/${id}`}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)', textDecoration: 'none' }}
      >
        ← Back to scan
      </Link>

      <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: '1rem 0 0.25rem' }}>
        Draft PR Opened
      </h1>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '2rem' }}>
        Scan {id.slice(0, 12)} · Permalink
      </p>

      <IssueCard issue={issueWithPr} context="rest" defaultExpanded />
    </div>
  )
}
