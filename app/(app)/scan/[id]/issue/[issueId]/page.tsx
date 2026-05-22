'use client'

/**
 * S6 permalink — Fix Detail as a standalone route (DESIGN.md §10 hybrid).
 * Fetches the persisted scan and renders the matching issue via IssueCard in
 * REST context (flat, no streaming) — shareable case-study link.
 */

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { IssueCard } from '@/components/phase-d/IssueCard'
import type { IssueVM } from '@/components/phase-d/types'

export default function IssuePermalinkPage({
  params,
}: {
  params: Promise<{ id: string; issueId: string }>
}) {
  const { id, issueId } = use(params)
  const [issue, setIssue] = useState<IssueVM | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/scans/${id}`)
      .then((r) => r.json())
      .then((data: { issues?: IssueVM[] }) => {
        if (cancelled) return
        const found = data.issues?.find((i) => i.id === issueId) ?? data.issues?.[0] ?? null
        setIssue(found)
        setState(found ? 'ready' : 'missing')
      })
      .catch(() => !cancelled && setState('missing'))
    return () => { cancelled = true }
  }, [id, issueId])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', padding: '2.5rem 2rem', maxWidth: '820px', margin: '0 auto' }}>
      <Link href={`/scan/${id}`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)', textDecoration: 'none' }}>
        ← Back to scan
      </Link>

      <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', margin: '1rem 0 0.25rem' }}>
        Fix Detail
      </h1>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '2rem' }}>
        Scan {id.slice(0, 12)} · Permalink · Playback
      </p>

      {state === 'loading' && <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>Loading…<span className="terminal-cursor" /></p>}
      {state === 'missing' && <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>No saved issue detail for this scan.</p>}
      {state === 'ready' && issue && <IssueCard issue={issue} context="rest" defaultExpanded />}
    </div>
  )
}
