'use client'

/**
 * S7 permalink — PR Confirmation as a standalone route (DESIGN.md §10 hybrid).
 * Fetches the persisted scan and renders the matching issue (with its opened PR)
 * via IssueCard in REST context — useful for case-study links.
 */

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { IssueCard } from '@/components/phase-d/IssueCard'
import type { IssueVM } from '@/components/phase-d/types'

export default function PrPermalinkPage({
  params,
}: {
  params: Promise<{ id: string; prId: string }>
}) {
  const { id, prId } = use(params)
  const [issue, setIssue] = useState<IssueVM | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/scans/${id}`)
      .then((r) => r.json())
      .then((data: { issues?: IssueVM[] }) => {
        if (cancelled) return
        // Match by issue id, else the first issue that actually opened a PR.
        const found = data.issues?.find((i) => i.id === prId) ?? data.issues?.find((i) => i.prUrl) ?? null
        setIssue(found)
        setState(found ? 'ready' : 'missing')
      })
      .catch(() => !cancelled && setState('missing'))
    return () => { cancelled = true }
  }, [id, prId])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', padding: '2.5rem 2rem', maxWidth: '820px', margin: '0 auto' }}>
      <Link href={`/scan/${id}`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)', textDecoration: 'none' }}>
        ← Back to scan
      </Link>

      <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: '1rem 0 0.25rem' }}>
        Draft PR Opened
      </h1>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '2rem' }}>
        Scan {id.slice(0, 12)} · Permalink
      </p>

      {state === 'loading' && <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Loading…<span className="terminal-cursor" /></p>}
      {state === 'missing' && <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No PR on record for this scan.</p>}
      {state === 'ready' && issue && <IssueCard issue={issue} context="rest" defaultExpanded />}
    </div>
  )
}
