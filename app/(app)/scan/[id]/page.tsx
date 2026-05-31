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

import { use, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { PanelFrame } from '@/components/phase-d/PanelFrame'
import { StageLane } from '@/components/phase-d/StageLane'
import { TerminalLog } from '@/components/phase-d/TerminalLog'
import { CommandBar } from '@/components/phase-d/CommandBar'
import { useToast } from '@/components/shared/toast'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { STAGES, type Stage } from '@/components/phase-d/types'
import { Particles } from '@/components/phase-d/Particles'

// Lazy-load the dep graph so initial S4 chrome paints fast. Pure-SVG/CSS now —
// no Three.js — but kept lazy because it's a heavy interactive surface.
// (Replaced DepGraph3D per audit 2026-05-26 — decorative 3D wireframes had no
//  semantic load. New DepGraph is real interactive dep-risk map.)
const DepGraph = dynamic(
  () => import('@/components/phase-d/DepGraph').then((m) => m.DepGraph),
  { ssr: false, loading: () => <div style={{ width: '100%', height: '100%' }} /> },
)
import { StatusPill } from '@/components/phase-d/StatusPill'
import { IssueCard } from '@/components/phase-d/IssueCard'
import { PHASE_TO_POSE, type IssueVM } from '@/components/phase-d/types'
import { useScanView } from '@/hooks/use-scan-view'
import { useMascotPhase } from '@/components/mascot-phase-context'

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
  const depNodes = scan.deps
  const { setPhase } = useMascotPhase()

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

  // Fix B3 (audit 2026-05-26): F7 EXPORT is now wired for real (no more dead
  // controls per new CLAUDE.md §7.2 step 4). Downloads the persisted scan JSON
  // — exactly what the API returns — so the user has a portable artifact.
  const exportScan = async () => {
    if (isDemo) {
      toast.info('Export is only available for real scans.')
      return
    }
    try {
      const r = await fetch(`/api/scans/${id}`)
      if (!r.ok) {
        toast.error('Export failed — could not fetch scan record.')
        return
      }
      const data = await r.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mendel-scan-${id}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.info('Scan exported.')
    } catch (err) {
      toast.error(`Export error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Fix U5 (audit 2026-05-26): scan-id is copyable. Click the cuid chip to copy.
  const copyScanId = async () => {
    try {
      await navigator.clipboard.writeText(id)
      toast.info('Scan ID copied to clipboard.')
    } catch {
      toast.error('Could not copy — clipboard blocked.')
    }
  }

  // Track which issues have had a Draft PR opened (S7 inline morph). Mock: assigns
  // the real mendel-test PR URL. Real wiring (D3 follow-up) POSTs to submit + uses
  // the returned URL.
  const [openedPrs, setOpenedPrs] = useState<Record<string, string>>({})
  const handleOpenPR = (issue: IssueVM) =>
    setOpenedPrs((prev) => ({ ...prev, [issue.id]: 'https://github.com/megadave19/mendel-test/pull/2' }))

  // Fix U3 (audit 2026-05-26): sort delivered (PR opened) cards to the top so
  // the "delivered" state visually leads the list. Stable within each group.
  const issues: IssueVM[] = scan.issues
    .map((iss) => (openedPrs[iss.id] ? { ...iss, prUrl: openedPrs[iss.id] } : iss))
    .sort((a, b) => (a.prUrl ? 0 : 1) - (b.prUrl ? 0 : 1))

  /**
   * Fix L1 (audit 2026-05-26): per-phase durations derived from log line
   * timestamps. Live scans get real times; playback (t === -1) gets null
   * → renders as em-dash. Sums approximately to scan.elapsedMs.
   */
  const phaseDurations = useMemo<Record<Stage, number | null>>(() => {
    const result: Record<Stage, number | null> = { SCAN: null, DIAGNOSE: null, PATCH: null, VERIFY: null, SMOKE: null }
    if (scan.lines.length === 0 || scan.lines[0].t < 0) return result
    const firstSeen: Partial<Record<Stage, number>> = {}
    for (const line of scan.lines) {
      const s = line.stage as Stage
      if (STAGES.includes(s) && firstSeen[s] == null) firstSeen[s] = line.t
    }
    for (let i = 0; i < STAGES.length; i++) {
      const stage = STAGES[i]
      const start = firstSeen[stage]
      if (start == null) continue
      // End = first-seen of next stage; if none, the scan's last log timestamp.
      let end: number | undefined
      for (let j = i + 1; j < STAGES.length; j++) {
        if (firstSeen[STAGES[j]] != null) { end = firstSeen[STAGES[j]]; break }
      }
      if (end == null) end = scan.elapsedMs
      result[stage] = Math.max(0, end - start)
    }
    return result
  }, [scan.lines, scan.elapsedMs])

  const deliveredIssues = issues.filter((iss) => !!iss.prUrl)
  const prsOpenedCount = deliveredIssues.length
  const filesChangedCount = new Set(issues.filter((iss) => iss.filePath).map((iss) => iss.filePath)).size

  // Drive the sidebar mascot from this scan's phase. DESIGN.md §8: one mascot,
  // present along the journey. HONESTY FIX (2026-05-28): a completed scan only
  // celebrates (success pose) when a PR actually opened. Bones must NEVER throw
  // up a "DRAFT PR OPENED" banner when prsOpenedCount === 0 (the execa case:
  // submission 403'd, 0 PRs, yet the mascot was celebrating). Reset to 'idle'
  // on unmount so the next route doesn't inherit running-scan state.
  const pose =
    scan.phase === 'DONE' && prsOpenedCount === 0 ? ('idle' as const) : PHASE_TO_POSE[scan.phase]
  useEffect(() => {
    setPhase(pose)
    return () => setPhase('idle')
  }, [pose, setPhase])

  /**
   * Controlled-expansion map (Fix L3 audit 2026-05-26): when the DepGraph
   * fires onNodeClick, we expand the matching issue card AND scroll it into
   * view. Cards initialize from `defaultExpanded={scan.done}` (DONE state
   * shows all cards expanded), but the user can override by clicking either
   * the card header or a graph node.
   */
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  const setExpanded = (issueId: string, next: boolean) =>
    setExpandedIds((prev) => ({ ...prev, [issueId]: next }))
  const handleNodeClick = (depName: string) => {
    const iss = issues.find((i) => i.dep === depName)
    if (!iss) return
    setExpanded(iss.id, true)
    // Defer scroll so the expand animation has a frame to start.
    requestAnimationFrame(() => {
      const el = document.getElementById(`issue-row-${iss.id}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg-0)', position: 'relative' }}>
      {/* Ambient drifting particles per DESIGN.md §11 S4 ("Motion: continuous.
          Particles drifting in background at low opacity"). Off when settled. */}
      <Particles context={scan.running ? 'running' : 'rest'} />
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
        {/* Fix U5: clickable cuid — copy on click. Title hint tells the user. */}
        <button
          onClick={copyScanId}
          title="Click to copy full scan ID"
          style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
            background: 'transparent', border: '1px solid var(--border-subtle)',
            padding: '0.15rem 0.4rem', cursor: 'pointer',
          }}
        >
          {id.slice(0, 10)} ⧉
        </button>
        <StatusPill phase={scan.phase} active />
        {/* Fix U6 (audit 2026-05-26): "playback" reads as a scrubber control we
            haven't built. Renamed to "completed" so the indicator describes
            state, not a transport mode. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <motion.span
            style={{ width: 6, height: 6, borderRadius: '50%', background: scan.running ? 'var(--accent-secondary)' : 'var(--text-muted)' }}
            animate={scan.running ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
            transition={scan.running ? { duration: 1, repeat: Infinity } : undefined}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            {scan.running ? 'live' : scan.done ? 'completed' : 'idle'}
          </span>
        </div>
        {/* Fix L4 (audit 2026-05-26): phase-contextual mini-metric between
            the indicator and the elapsed timer. Live scans get a "what's
            happening now" pulse; completed scans get a delivery summary. */}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <ContextMeta phase={scan.phase} depsScanned={scan.depsScanned} issuesFound={scan.issuesFound} prsOpened={prsOpenedCount} filesChanged={filesChangedCount} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtElapsed(scan.elapsedMs)}
          </span>
        </span>
      </div>

      {/* ── Three panes ── (responsive: stacks vertically below 1024px) */}
      <div className="scan-grid">
        {/* Left — Fix L1 (audit 2026-05-26): replaced the 70% empty void with
            a dense information column: phase + substate, per-phase timeline,
            delivered PRs summary, 2x2 stat grid, copyable scan-id footer.
            Mascot lives in the sidebar (single instance via MascotPhaseContext). */}
        <div style={{ background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', padding: '1.25rem 1rem', gap: '1.25rem', overflowY: 'auto' }}>
          {/* ── Phase header ── */}
          <div>
            <SectionLabel>Current phase</SectionLabel>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--accent-primary)', textShadow: 'var(--glow-primary)', marginTop: '0.25rem' }}>
              {scan.phase}
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.1em', color: 'var(--text-muted)', marginTop: '0.375rem', minHeight: '1.5em' }}>
              {scan.phase === 'DONE'
                ? prsOpenedCount > 0
                  ? `${prsOpenedCount} draft PR${prsOpenedCount === 1 ? '' : 's'} opened`
                  : 'scan complete · no PR opened'
                : SUBSTATE[scan.phase]}
            </p>
            {scan.activeNodeId && scan.running && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.06em', color: 'var(--accent-secondary)', marginTop: '0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ▶ {scan.activeNodeId}
              </p>
            )}
          </div>

          <Divider />

          {/* ── Phase timeline ── */}
          <div>
            <SectionLabel>Timeline</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.625rem' }}>
              {STAGES.map((stage) => {
                const order: Record<Stage, number> = { SCAN: 0, DIAGNOSE: 1, PATCH: 2, VERIFY: 3, SMOKE: 4 }
                const currentOrder = scan.phase === 'DONE' || scan.phase === 'ERROR' ? 5 : order[scan.phase as Stage] ?? 0
                const isDone = order[stage] < currentOrder
                const isActive = scan.phase === stage
                const duration = phaseDurations[stage]
                const dot = isDone ? '✓' : isActive ? '▶' : '·'
                const dotColor = isDone ? 'var(--accent-primary)' : isActive ? 'var(--accent-secondary)' : 'var(--text-muted)'
                return (
                  <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.625rem' }}>
                    <span style={{ width: '0.75rem', textAlign: 'center', color: dotColor, fontWeight: 700 }}>{dot}</span>
                    <span style={{ flex: 1, color: isActive || isDone ? 'var(--text-primary)' : 'var(--text-muted)', letterSpacing: '0.08em' }}>
                      {stage}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {duration != null ? fmtElapsed(duration) : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Delivered (only when ≥1 PR opened) ── */}
          {deliveredIssues.length > 0 && (
            <>
              <Divider />
              <div>
                <SectionLabel>Delivered</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.625rem' }}>
                  {deliveredIssues.map((iss) => (
                    <a
                      key={iss.id}
                      href={iss.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Open ${iss.dep} PR on GitHub`}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: '0.125rem',
                        padding: '0.5rem 0.625rem',
                        borderLeft: '2px solid var(--accent-primary)',
                        background: 'rgba(198,255,61,0.04)',
                        textDecoration: 'none',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {iss.dep}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.08em', color: 'var(--accent-primary)' }}>
                        ↗ view on github
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            </>
          )}

          <Divider />

          {/* ── Stat grid (2x2) ── */}
          <div>
            <SectionLabel>Stats</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem', marginTop: '0.625rem' }}>
              <MiniStat label="Deps" value={scan.depsScanned} accent="var(--accent-secondary)" />
              <MiniStat label="Issues" value={scan.issuesFound} accent="var(--accent-warning)" />
              <MiniStat label="PRs" value={prsOpenedCount} accent="var(--accent-primary)" />
              <MiniStat label="Files" value={filesChangedCount} accent="var(--text-secondary)" />
            </div>
          </div>

          {/* ── Footer: scan id ── */}
          <div style={{ marginTop: 'auto', paddingTop: '0.75rem', borderTop: '1px dashed var(--border-subtle)' }}>
            <SectionLabel>Scan ID</SectionLabel>
            <button
              onClick={copyScanId}
              title="Click to copy full scan ID"
              style={{
                marginTop: '0.375rem', width: '100%', textAlign: 'left',
                fontFamily: 'var(--font-mono)', fontSize: '0.625rem',
                color: 'var(--text-secondary)', letterSpacing: '0.02em',
                background: 'transparent', border: '1px solid var(--border-subtle)',
                padding: '0.375rem 0.5rem', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {id}
              </span>
              <span style={{ color: 'var(--text-muted)', marginLeft: '0.375rem' }}>⧉</span>
            </button>
          </div>
        </div>

        {/* Center — stage lane + issue cards + streaming log */}
        <div style={{ background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '1.25rem 1.25rem 1rem', borderBottom: '1px solid var(--border-subtle)' }}>
            <StageLane phase={scan.phase} />
          </div>

          {/* Issue cards (S5 inline) — stream in as detected; expand for S6/S7.
              Wrapped in id="issue-row-{id}" so DepGraph click-to-expand can scroll
              the card into view. */}
          {issues.length > 0 && (
            <div style={{ padding: '1rem 1.25rem 0', display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '55%', overflowY: 'auto' }}>
              {issues.map((iss) => {
                const initialOpen = scan.done
                const expanded = expandedIds[iss.id] ?? initialOpen
                return (
                  <div key={iss.id} id={`issue-row-${iss.id}`}>
                    <IssueCard
                      issue={iss}
                      context="running"
                      expanded={expanded}
                      onExpandChange={(next) => setExpanded(iss.id, next)}
                      scanId={id}
                      /* Manual action only in the demo; real scans auto-open the PR. */
                      onOpenPR={isDemo ? handleOpenPR : undefined}
                    />
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, padding: '1rem 1.25rem' }}>
            <TerminalLog lines={scan.lines} live={scan.running} />
          </div>
        </div>

        {/* Right — Dep Graph 2.0 (Fix L3 audit 2026-05-26): real interactive
            dep-risk map. Replaces the prior decorative 3D wireframe icosahedrons. */}
        <div style={{ background: 'var(--bg-0)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <PanelFrame
            title="Dependency Graph"
            meta={`${depNodes.length} deps · ${scan.issuesFound} with issue${scan.issuesFound === 1 ? '' : 's'}`}
            accent="var(--accent-secondary)"
            flush
            style={{ flex: 1, border: 'none', background: 'transparent' }}
          >
            <DepGraph
              deps={depNodes}
              issues={issues}
              activeNodeId={scan.activeNodeId}
              context={scan.running ? 'running' : 'rest'}
              onNodeClick={handleNodeClick}
            />
          </PanelFrame>
        </div>
      </div>

      {/* ── Command bar ── (Fix B3+B4: removed F1 PAUSE + F3 INSPECT — they had
          no handlers per new CLAUDE.md §7.2 step 4 "no dead controls". F7 EXPORT
          is now wired to download the scan JSON.) */}
      <CommandBar
        keys={[
          { key: 'F2', label: cancelling ? 'Cancelling…' : 'Cancel', onPress: !isDemo && scan.running ? cancelScan : undefined, disabled: isDemo || !scan.running || cancelling },
          { key: 'F5', label: scan.running ? 'Running' : 'Replay', onPress: scan.replay, disabled: scan.running },
          { key: 'F7', label: 'Export', onPress: !isDemo ? exportScan : undefined, disabled: isDemo },
        ]}
        status={`${scan.phase === 'DONE' ? 'COMPLETE' : 'WORKING'} · CONFIDENCE: MEDIUM · DRAFT-ONLY`}
      />
    </div>
  )
}

/* ── Status-strip contextual meta (Fix L4 audit 2026-05-26) ───────────────── */

function ContextMeta({
  phase, depsScanned, issuesFound, prsOpened, filesChanged,
}: { phase: string; depsScanned: number; issuesFound: number; prsOpened: number; filesChanged: number }) {
  let text = ''
  switch (phase) {
    case 'SCAN':
      text = `▸ ${depsScanned} dep${depsScanned === 1 ? '' : 's'} enumerated`
      break
    case 'DIAGNOSE':
      text = `▸ ${issuesFound} issue${issuesFound === 1 ? '' : 's'} flagged`
      break
    case 'PATCH':
      text = `▸ ${filesChanged} file${filesChanged === 1 ? '' : 's'} rewriting`
      break
    case 'VERIFY':
      text = `▸ sandbox active`
      break
    case 'DONE':
      text = `▸ ${prsOpened} pr${prsOpened === 1 ? '' : 's'} · ${filesChanged} file${filesChanged === 1 ? '' : 's'} · ${issuesFound} issue${issuesFound === 1 ? '' : 's'}`
      break
    case 'ERROR':
      text = `▸ halted`
      break
    default:
      return null
  }
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
      letterSpacing: '0.08em', color: 'var(--text-muted)',
    }}>
      {text}
    </span>
  )
}

/* ── Left-pane helpers (Fix L1 audit 2026-05-26) ─────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontFamily: 'var(--font-mono)', fontSize: '0.5rem',
      letterSpacing: '0.22em', textTransform: 'uppercase',
      color: 'var(--text-muted)',
    }}>{children}</p>
  )
}

function Divider() {
  return (
    <div aria-hidden style={{
      fontFamily: 'var(--font-mono)', fontSize: '0.5rem',
      letterSpacing: '0.3em', color: 'var(--border-strong)',
      textAlign: 'center',
    }}>
      ─── ◇ ───
    </div>
  )
}

function MiniStat({ label, value, accent = 'var(--accent-primary)' }: { label: string; value: number; accent?: string }) {
  return (
    <div style={{
      border: '1px solid var(--border-subtle)', background: 'var(--bg-1)',
      padding: '0.5rem 0.625rem',
      display: 'flex', flexDirection: 'column', gap: '0.125rem',
    }}>
      <p style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.5rem',
        letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}>{label}</p>
      <motion.p
        key={value}
        initial={{ color: '#ffffff' }}
        animate={{ color: accent }}
        transition={{ duration: 0.4 }}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: '1.25rem', fontWeight: 700,
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}
      >
        {value}
      </motion.p>
    </div>
  )
}
