'use client'

/**
 * S4 — Live Agent Console (DESIGN.md §11 S4). Running mode. The signature screen.
 *
 * Three panes: [mascot + state + stats] | [stage lane + streaming log] | [3D dep graph],
 * over a bottom F-key command bar. Every agent phase fires motion in all three panes
 * simultaneously (DESIGN.md §11 S4 must-have).
 *
 * D2: driven by useMockScan so the whole screen animates end-to-end without a backend
 * (PRD §17b D2 gate). D3 reconciles the real useScanStream into this same layout and
 * adds inline issue cards (S5/S6/S7). The mock driver and real stream share the
 * Phase/LogLine shapes in components/phase-d/types, so the swap is contained.
 */

import { use, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { PanelFrame } from '@/components/phase-d/PanelFrame'
import { StageLane } from '@/components/phase-d/StageLane'
import { TerminalLog } from '@/components/phase-d/TerminalLog'
import { CommandBar } from '@/components/phase-d/CommandBar'
import { useToast } from '@/components/shared/toast'
import { useDocumentTitle } from '@/hooks/use-document-title'

// Fix #10: lazy-load the heavy WebGL components so the S4 chrome paints
// without waiting on Three.js (~150KB) + the 3D glb. Both are client-only,
// so SSR is disabled — no impact since the rest of S4 is interactive anyway.
const MascotWidget = dynamic(
  () => import('@/components/MascotWidget').then((m) => m.MascotWidget),
  { ssr: false, loading: () => <div style={{ width: 150, height: 150 }} /> },
)
const DepGraph3D = dynamic(
  () => import('@/components/phase-d/DepGraph3D').then((m) => m.DepGraph3D),
  { ssr: false, loading: () => <div style={{ width: '100%', height: '100%' }} /> },
)
import { StatusPill } from '@/components/phase-d/StatusPill'
import { IssueCard } from '@/components/phase-d/IssueCard'
import { PHASE_TO_POSE, type IssueVM } from '@/components/phase-d/types'
import { useScanView } from '@/hooks/use-scan-view'

const SUBSTATE: Record<string, string> = {
  SCAN: 'reading manifest · querying registry',
  DIAGNOSE: 'parsing changelog · cross-referencing usage',
  PATCH: 'rewriting source · formatting',
  VERIFY: 'docker sandbox · two-phase',
  DONE: 'draft pr opened',
  ERROR: 'halted',
}

function fmtElapsed(ms: number): string {
  const s = (ms / 1000).toFixed(1)
  return `${s.padStart(5, '0')}s`
}

function repoNameFromUrl(url: string): string {
  return url.replace(/https?:\/\/github\.com\//, '').replace(/\.git$/, '')
}

export default function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const toast = useToast()
  // Demo id → scripted mock; any real scan id → live SSE stream (same shape).
  const scan = useScanView(id)
  const isDemo = id === 'demo'
  const pose = PHASE_TO_POSE[scan.phase]
  const depNodes = scan.deps

  // Fix #7 (audit-2): show repo name in the status strip instead of the cuid.
  const [repoName, setRepoName] = useState<string | null>(null)
  useEffect(() => {
    if (isDemo) { setRepoName('demo · mock scan'); return }
    fetch(`/api/scans/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { repoUrl?: string } | null) => d?.repoUrl && setRepoName(repoNameFromUrl(d.repoUrl)))
      .catch(() => {})
  }, [id, isDemo])
  // Fix #13 (audit-2): dynamic tab title reflects the scan in progress.
  useDocumentTitle(repoName ? `${repoName} · ${scan.phase.toLowerCase()}` : `Scan · ${scan.phase.toLowerCase()}`)

  // Fix #4 (audit-2): wire CANCEL — POST to /api/scans/[id]/cancel.
  const [cancelling, setCancelling] = useState(false)
  const cancelScan = async () => {
    if (!scan.running || isDemo || cancelling) return
    setCancelling(true)
    try {
      const r = await fetch(`/api/scans/${id}/cancel`, { method: 'POST' })
      if (r.ok) toast.info('Cancel requested — runner stops at the next phase boundary.')
      else toast.error('Cancel failed — the scan may have already finished.')
    } catch (err) {
      toast.error(`Cancel error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCancelling(false)
    }
  }

  // Track which issues have had a Draft PR opened (S7 inline morph). Mock: assigns
  // the real mendel-test PR URL. Real wiring (D3 follow-up) POSTs to submit + uses
  // the returned URL.
  const [openedPrs, setOpenedPrs] = useState<Record<string, string>>({})
  const handleOpenPR = (issue: IssueVM) =>
    setOpenedPrs((prev) => ({ ...prev, [issue.id]: 'https://github.com/megadave19/mendel-test/pull/2' }))

  const issues: IssueVM[] = scan.issues.map((iss) =>
    openedPrs[iss.id] ? { ...iss, prUrl: openedPrs[iss.id] } : iss,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-0)' }}>
      {/* ── Status strip (running-mode header, NOT the H1+subtitle anti-pattern) ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          padding: '0.75rem 1.25rem',
          borderBottom: '1px solid var(--border-strong)',
          background: 'var(--bg-1)',
          flexShrink: 0,
        }}
      >
        {/* Fix #7 (audit-2): primary label is the repo name; cuid is secondary. */}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-primary)', fontWeight: 700 }}>
          {repoName ?? `scan · ${id.slice(0, 8)}`}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          {id.slice(0, 10)}
        </span>
        <StatusPill phase={scan.phase} active />
        {/* Fix #6: connection indicator uses distinct labels (LIVE / PLAYBACK / IDLE)
            so it doesn't duplicate the phase pill (which already says DONE on completion). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <motion.span
            style={{ width: 6, height: 6, borderRadius: '50%', background: scan.running ? 'var(--accent-secondary)' : 'var(--text-muted)' }}
            animate={scan.running ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
            transition={scan.running ? { duration: 1, repeat: Infinity } : undefined}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            {scan.running ? 'live' : scan.done ? 'playback' : 'idle'}
          </span>
        </div>
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtElapsed(scan.elapsedMs)}
        </span>
      </div>

      {/* ── Three panes ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr 360px', gap: '1px', background: 'var(--border-strong)', minHeight: 0 }}>
        {/* Left — mascot + state + stats */}
        <div style={{ background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', padding: '1.25rem', gap: '1.25rem', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <MascotWidget pose={pose} size={150} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-primary)', textShadow: 'var(--glow-primary)' }}>
              {scan.phase}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.1em', color: 'var(--text-muted)', marginTop: '0.375rem', minHeight: '1.5em' }}>
              {SUBSTATE[scan.phase]}
            </p>
            {/* Fix #10 (audit-2): show which dep is currently being worked on so
                long scans don't feel stuck — derived from the latest 'issue' event. */}
            {scan.activeNodeId && scan.running && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.08em', color: 'var(--accent-secondary)', marginTop: '0.5rem' }}>
                ▶ {scan.activeNodeId}
              </p>
            )}
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <Stat label="Deps Scanned" value={scan.depsScanned} />
            <Stat label="Issues Found" value={scan.issuesFound} accent="var(--accent-warning)" />
          </div>
        </div>

        {/* Center — stage lane + issue cards + streaming log */}
        <div style={{ background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '1.25rem 1.25rem 1rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <StageLane phase={scan.phase} />
          </div>

          {/* Issue cards (S5 inline) — stream in as detected; expand for S6/S7 */}
          {issues.length > 0 && (
            <div style={{ padding: '1rem 1.25rem 0', display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '55%', overflowY: 'auto' }}>
              {issues.map((iss) => (
                <IssueCard
                  key={iss.id}
                  issue={iss}
                  context="running"
                  defaultExpanded={scan.done}
                  scanId={id}
                  /* Manual action only in the demo; real scans auto-open the PR. */
                  onOpenPR={isDemo ? handleOpenPR : undefined}
                />
              ))}
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, padding: '1rem 1.25rem' }}>
            <TerminalLog lines={scan.lines} live={scan.running} />
          </div>
        </div>

        {/* Right — 3D dep graph */}
        <div style={{ background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <PanelFrame title="Dependency Graph" meta={`${depNodes.length} nodes`} accent="var(--accent-secondary)" flush style={{ flex: 1, border: 'none', background: 'transparent' }}>
            {/* Fix #9 (audit-2): graph settles when scan is done — slower spin, muted edges. */}
            <DepGraph3D nodes={depNodes} activeNodeId={scan.activeNodeId} context={scan.running ? 'running' : 'rest'} />
          </PanelFrame>
        </div>
      </div>

      {/* ── Command bar ── */}
      <CommandBar
        keys={[
          { key: 'F1', label: 'Pause' },
          // Fix #4 (audit-2): F2 CANCEL is wired for real (live, non-demo) scans.
          { key: 'F2', label: cancelling ? 'Cancelling…' : 'Cancel', onPress: !isDemo && scan.running ? cancelScan : undefined, disabled: isDemo || !scan.running || cancelling },
          { key: 'F3', label: 'Inspect' },
          { key: 'F5', label: scan.running ? 'Running' : 'Replay', onPress: scan.replay, disabled: scan.running },
          { key: 'F7', label: 'Export' },
        ]}
        status={`${scan.phase === 'DONE' ? 'COMPLETE' : 'WORKING'} · CONFIDENCE: MEDIUM · DRAFT-ONLY`}
      />
    </div>
  )
}

function Stat({ label, value, accent = 'var(--accent-primary)' }: { label: string; value: number; accent?: string }) {
  return (
    <div style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-1)', padding: '0.625rem 0.75rem' }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</p>
      <motion.p
        key={value}
        initial={{ color: '#ffffff' }}
        animate={{ color: accent }}
        transition={{ duration: 0.4 }}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: '0.125rem' }}
      >
        {value}
      </motion.p>
    </div>
  )
}
