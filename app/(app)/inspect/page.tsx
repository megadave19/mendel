'use client'

/**
 * S? — /inspect (v2.1 / F22 "Point at any API").
 *
 * Paste a package + from/to version → get a calibrated breaking-change
 * report. No repo, no clone, no PR — pure analysis from the existing
 * changelog + semantic-diff signals + the scorer. Honest report mode:
 * confidence is structurally capped at medium ceiling (CLAUDE.md §5b /
 * V2_PLAN §F22).
 *
 * Component reuse: result panel uses `PanelFrame`, `ConfidenceBadge`,
 * `NotAnalyzedCallout` — same visual vocabulary as a scan issue, no new
 * card design needed. The header uses the same pkg@from→to pattern from
 * the IssueCard.
 *
 * §7.2a: every control is wired. The submit button is gated on valid
 * inputs + non-equal versions; the share button only renders once the
 * permalink id lands; the rerun button restarts the form.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PanelFrame } from '@/components/phase-d/PanelFrame'
import { ConfidenceBadge } from '@/components/phase-d/ConfidenceBadge'
import { NotAnalyzedCallout } from '@/components/phase-d/NotAnalyzedCallout'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useToast } from '@/components/shared/toast'
import { InspectionReportPanel, type InspectionVM } from '@/components/inspect/InspectionReportPanel'

const SEMVER_HINT = /^[0-9]+(?:\.[0-9]+){0,2}(?:[-+][A-Za-z0-9.\-+]+)?$/

export default function InspectPage() {
  useDocumentTitle('Inspect API')
  const toast = useToast()
  const [packageName, setPackageName] = useState('')
  const [fromVersion, setFromVersion] = useState('')
  const [toVersion, setToVersion] = useState('')
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [result, setResult] = useState<{ id: string | null; vm: InspectionVM } | null>(null)
  const [hasPat, setHasPat] = useState(false)

  // The changelog signal needs a PAT to walk GitHub release notes. If the
  // user is connected (via the standard sessionStorage cookie the rest of
  // the app uses), we'll forward it; otherwise we honest-warn that the
  // changelog signal will be skipped.
  useEffect(() => {
    setHasPat(typeof window !== 'undefined' && !!sessionStorage.getItem('mendel_pat'))
  }, [])

  const validName = packageName.trim().length > 0
  const validFrom = SEMVER_HINT.test(fromVersion.trim())
  const validTo = SEMVER_HINT.test(toVersion.trim())
  const distinct = fromVersion.trim() !== toVersion.trim()
  const canSubmit = validName && validFrom && validTo && distinct && status !== 'running'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setStatus('running')
    setErrorMsg('')
    setResult(null)
    const pat = sessionStorage.getItem('mendel_pat') ?? undefined
    try {
      const res = await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageName: packageName.trim(),
          fromVersion: fromVersion.trim(),
          toVersion: toVersion.trim(),
          ...(pat ? { pat } : {}),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`)
      }
      const body = (await res.json()) as { id: string | null; report: InspectionVM['report'] }
      setResult({
        id: body.id,
        vm: {
          packageName: packageName.trim(),
          fromVersion: fromVersion.trim(),
          toVersion: toVersion.trim(),
          report: body.report,
        },
      })
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to run inspection')
    }
  }

  function reset() {
    setResult(null)
    setStatus('idle')
    setErrorMsg('')
  }

  async function copyShareLink() {
    if (!result?.id) return
    const url = `${window.location.origin}/inspect/${result.id}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Permalink copied.')
    } catch {
      toast.error("Couldn't copy — select the URL manually.")
    }
  }

  return (
    <main id="main" style={{ minHeight: '100vh', padding: '2.25rem 2rem' }}>
      {/* Header — same chrome as /scan/new for visual consistency */}
      <div style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
          Mendel // Inspect API
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          report only · medium ceiling
        </span>
      </div>

      <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
        Inspect an npm API
      </h1>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', maxWidth: '64ch', marginBottom: '1.75rem' }}>
        Paste a package + from/to version. Mendel runs the same calibrated signals it uses in a scan (changelog + semantic-diff), without a repo — so confidence is structurally capped at <strong>medium</strong>. No PR. No sandbox. Shareable permalink.
      </p>

      <form onSubmit={handleSubmit}>
        <PanelFrame title="Package · From · To" accent="var(--accent-secondary)">
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', gap: '0.625rem', alignItems: 'stretch' }}>
            <input
              aria-label="Package name"
              type="text"
              value={packageName}
              onChange={(e) => { setPackageName(e.target.value); setStatus('idle'); setErrorMsg('') }}
              placeholder="@scope/name"
              spellCheck={false}
              autoComplete="off"
              autoFocus
              style={{
                background: 'var(--bg-3, #222)', color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)', fontSize: '0.8125rem',
                padding: '0.875rem 1rem', outline: 'none', minWidth: 0,
                border: `1px solid ${validName ? 'var(--accent-primary)' : 'var(--border-strong)'}`,
              }}
            />
            <input
              aria-label="From version"
              type="text"
              value={fromVersion}
              onChange={(e) => { setFromVersion(e.target.value); setStatus('idle'); setErrorMsg('') }}
              placeholder="1.0.0"
              spellCheck={false}
              autoComplete="off"
              style={{
                background: 'var(--bg-3, #222)', color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)', fontSize: '0.8125rem',
                padding: '0.875rem 1rem', outline: 'none', minWidth: 0,
                border: `1px solid ${validFrom ? 'var(--accent-primary)' : 'var(--border-strong)'}`,
              }}
            />
            <input
              aria-label="To version"
              type="text"
              value={toVersion}
              onChange={(e) => { setToVersion(e.target.value); setStatus('idle'); setErrorMsg('') }}
              placeholder="2.0.0"
              spellCheck={false}
              autoComplete="off"
              style={{
                background: 'var(--bg-3, #222)', color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)', fontSize: '0.8125rem',
                padding: '0.875rem 1rem', outline: 'none', minWidth: 0,
                border: `1px solid ${validTo && distinct ? 'var(--accent-primary)' : 'var(--border-strong)'}`,
              }}
            />
            <button
              type="submit"
              disabled={!canSubmit}
              className="btn-primary"
              style={{ borderRadius: 0, padding: '0.875rem 1.5rem', whiteSpace: 'nowrap' }}
              title={!distinct && validFrom && validTo ? 'From and To must differ' : undefined}
            >
              {status === 'running' ? 'INSPECTING…' : 'Inspect →'}
            </button>
          </div>

          {/* Honest about the PAT precondition for the changelog signal. */}
          {!hasPat && (
            <p style={{ marginTop: '0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)' }}>
              · No GitHub token connected — changelog signal will be skipped.{' '}
              <Link href="/connect?return=/inspect" style={{ color: 'var(--accent-secondary)' }}>connect a token →</Link>
            </p>
          )}
          {errorMsg && (
            <p role="alert" style={{ marginTop: '0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--accent-danger)' }}>
              ✕ {errorMsg}
            </p>
          )}
        </PanelFrame>
      </form>

      {/* Result panel — separate from the input so the layout stays
          stable when the result renders. */}
      {result && (
        <section style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
            <ConfidenceBadge
              level={result.vm.report.confidence.bucket}
              score={result.vm.report.confidence.overall}
              capped={result.vm.report.structuralCap !== null}
              size="md"
            />
            <span style={{ flex: 1 }} />
            {result.id && (
              <button
                type="button"
                onClick={copyShareLink}
                style={{
                  background: 'transparent', border: '1px solid var(--accent-secondary)',
                  color: 'var(--accent-secondary)', cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                  padding: '0.45rem 0.875rem',
                }}
              >
                ↗ Copy permalink
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              style={{
                background: 'transparent', border: '1px solid var(--border-strong)',
                color: 'var(--text-secondary)', cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
                letterSpacing: '0.12em', textTransform: 'uppercase',
                padding: '0.45rem 0.875rem',
              }}
            >
              · New inspection
            </button>
          </div>

          <InspectionReportPanel vm={result.vm} />

          {/* Honest: the structural cap explanation lives here, NOT hidden
              behind the badge tooltip. */}
          <NotAnalyzedCallout
            context="rest"
            items={buildNotAnalyzedItems(result.vm)}
          />

          {/* Honest about per-signal failures. */}
          {result.vm.report.errors.length > 0 && (
            <PanelFrame title="Signal errors" accent="var(--accent-danger)">
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {result.vm.report.errors.map((e, i) => (
                  <li key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--accent-danger)' }}>
                    · {e}
                  </li>
                ))}
              </ul>
            </PanelFrame>
          )}

          {/* Permalink hint — also acts as a backup if the clipboard write failed. */}
          {result.id && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)' }}>
              permalink:{' '}
              <Link href={`/inspect/${result.id}`} style={{ color: 'var(--accent-secondary)' }}>
                /inspect/{result.id}
              </Link>
            </p>
          )}
        </section>
      )}

      {/* Mascot wiring is centralized in <AppNav> — we don't render another
          one here (DESIGN.md §8: one mascot per screen). */}
    </main>
  )
}

function buildNotAnalyzedItems(vm: InspectionVM): string[] {
  const items: string[] = [
    'No repo context — affected-sites analysis was not performed.',
    'No verification — Phase B (typecheck/test) and Phase C (smoke) were not run.',
  ]
  if (vm.report.structuralCap === 'medium-ceiling-no-verify') {
    items.push(
      'Structural cap: confidence is capped at MEDIUM. The signals point at high agreement, but inspect mode cannot claim high without verification + repo context.',
    )
  }
  if (vm.report.errors.length > 0) {
    items.push(`Some signals failed — see the "Signal errors" panel below for details.`)
  }
  return items
}
