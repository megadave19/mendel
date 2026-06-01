'use client'

/**
 * S? — /inspect/[id] (v2.1 / F22 permalink).
 *
 * Resolves a stored inspection from `/api/inspect/[id]` and renders the
 * exact same report panel as the live `/inspect` page. Shareable URL for
 * case studies (V2_PLAN §F22, consistent with the §10 hybrid permalink
 * philosophy).
 *
 * Honest empty / error / loading states. NO write actions — this page is
 * pure read.
 */

import { useEffect, useState } from 'react'
import { useParams, notFound } from 'next/navigation'
import Link from 'next/link'
import { PanelFrame } from '@/components/phase-d/PanelFrame'
import { NotAnalyzedCallout } from '@/components/phase-d/NotAnalyzedCallout'
import { ConfidenceBadge } from '@/components/phase-d/ConfidenceBadge'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { InspectionReportPanel, type InspectionVM } from '@/components/inspect/InspectionReportPanel'

export default function InspectPermalinkPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const [vm, setVm] = useState<InspectionVM | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  useDocumentTitle(vm ? `${vm.packageName} ${vm.fromVersion}→${vm.toVersion} · Inspect` : 'Inspection · Mendel')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/inspect/${id}`)
        if (res.status === 404) {
          if (!cancelled) notFound()
          return
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const body = (await res.json()) as {
          id: string; packageName: string; fromVersion: string; toVersion: string;
          report: InspectionVM['report']
        }
        if (cancelled) return
        setVm({
          packageName: body.packageName,
          fromVersion: body.fromVersion,
          toVersion: body.toVersion,
          report: body.report,
        })
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load inspection')
        setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [id])

  return (
    <main id="main" style={{ minHeight: '100vh', padding: '2.25rem 2rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
          Mendel // Inspect API · Permalink
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        <Link href="/inspect" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-secondary)' }}>
          ← run a new one
        </Link>
      </div>

      {status === 'loading' && (
        <p style={{ marginTop: '1.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Loading inspection…
        </p>
      )}

      {status === 'error' && (
        <div style={{ marginTop: '1.5rem' }}>
          <PanelFrame title="Could not load this inspection" accent="var(--accent-danger)">
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-primary)' }}>
              {error ?? 'Unknown error.'}
            </p>
            <p style={{ marginTop: '0.625rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              The permalink may have been deleted, or the stored report is malformed.
              You can <Link href="/inspect" style={{ color: 'var(--accent-secondary)' }}>start a new inspection</Link>.
            </p>
          </PanelFrame>
        </div>
      )}

      {status === 'ready' && vm && (
        <>
          <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.5rem', marginBottom: '1.25rem' }}>
            {vm.packageName} <span style={{ color: 'var(--text-muted)' }}>{vm.fromVersion} → {vm.toVersion}</span>
          </h1>

          <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center', marginBottom: '0.875rem' }}>
            <ConfidenceBadge
              level={vm.report.confidence.bucket}
              score={vm.report.confidence.overall}
              capped={vm.report.structuralCap !== null}
              size="md"
            />
          </div>

          <InspectionReportPanel vm={vm} />

          <div style={{ marginTop: '0.875rem' }}>
            <NotAnalyzedCallout
              context="rest"
              items={[
                'No repo context — affected-sites analysis was not performed.',
                'No verification — Phase B (typecheck/test) and Phase C (smoke) were not run.',
                ...(vm.report.structuralCap === 'medium-ceiling-no-verify'
                  ? ['Structural cap: confidence is capped at MEDIUM. Inspect mode cannot claim high without verification + repo context.']
                  : []),
              ]}
            />
          </div>

          {vm.report.errors.length > 0 && (
            <div style={{ marginTop: '0.875rem' }}>
              <PanelFrame title="Signal errors" accent="var(--accent-danger)">
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {vm.report.errors.map((e, i) => (
                    <li key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--accent-danger)' }}>
                      · {e}
                    </li>
                  ))}
                </ul>
              </PanelFrame>
            </div>
          )}
        </>
      )}
    </main>
  )
}
