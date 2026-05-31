'use client'

/**
 * useScanView — single view model for S4, sourced from either the mock driver
 * (id === 'demo', full interactive demo) or the REAL SSE stream (live scans).
 * Both yield the same MockScanState shape so S4 doesn't branch on source.
 *
 * Live mapping: AgentEvent (phase/log/issue/verify/pr/done) → phase + log lines +
 * partial issue cards. On completion it fetches GET /api/scans/[id] to enrich the
 * cards with the persisted diagnosis/diff/Not-Analyzed (full IssueVM).
 */

import { useEffect, useMemo, useState } from 'react'
import { notFound } from 'next/navigation'
import { useScanStream } from '@/hooks/use-scan-stream'
import { useMockScan, MOCK_DEPS, type MockScanState } from '@/hooks/use-mock-scan'
import type { AgentEvent, AgentPhase } from '@/lib/agent/runner'
import type { IssueVM, LogLine, Phase } from '@/components/phase-d/types'
import type { DepNode } from '@/components/phase-d/DepGraph'

const DEMO_ID = 'demo'

const PHASE_MAP: Record<AgentPhase, Phase> = {
  DETECT: 'SCAN',
  DIAGNOSE: 'DIAGNOSE',
  PATCH: 'PATCH',
  VERIFY: 'VERIFY',
  SUBMIT: 'VERIFY',
}

const STANDARD_NOT_ANALYZED = [
  'Full runtime behavior — changelog-parsing-only analysis (no semantic API diff in v1.0).',
  'Transitive dependency impact of the version bump.',
  'Test coverage of the changed code paths.',
]

function partialIssue(dep: string, cur: string, latest: string): IssueVM {
  return {
    id: dep,
    dep,
    currentVersion: cur,
    latestVersion: latest,
    confidence: 'medium',
    what: 'Diagnosing…',
    why: '',
    evidence: [],
    filePath: '',
    diff: [],
    notAnalyzed: STANDARD_NOT_ANALYZED,
    verificationPassed: false,
  }
}

function useRealScanView(id: string): MockScanState {
  // id === '' makes useScanStream no-op (disabled in demo mode).
  const { entries, done } = useScanStream(id)
  const [enriched, setEnriched] = useState<IssueVM[] | null>(null)
  const [deps, setDeps] = useState<DepNode[]>([])
  /**
   * Persisted timing for playback. Fix B1 (audit 2026-05-26): on DONE scans
   * the live stream is empty (it never re-replays), so `entries` is [] and
   * elapsedMs computed below would be 0 → status strip showed `000.0s`.
   * Pull `startedAt` + `completedAt` from the API so playback shows the real
   * total duration.
   */
  const [persistedElapsedMs, setPersistedElapsedMs] = useState<number | null>(null)
  /**
   * Persisted failure surface (2026-05-29 fix). The runner records
   * `status: 'failed' | 'cancelled'` + `errorMessage` on the Scan row, but the
   * page used to ignore both and hard-code 'DONE' for playback — so a scan that
   * crashed at `ensureSandboxImage` (docker build EEXIST) rendered as
   * "scan complete · no PR opened" with Bones idle. False success. Now: if
   * status is failed/cancelled, render phase = 'ERROR' + show the real error.
   */
  const [persistedFailure, setPersistedFailure] = useState<{ failed: boolean; cancelled: boolean; errorMessage: string | null }>({
    failed: false, cancelled: false, errorMessage: null,
  })
  // v2.0 / F20 — drives whether StageLane renders the 5th (SMOKE) lane. We
  // read this from the scan's persisted `smokeRequested` flag so a live scan
  // that opted in shows the SMOKE lane the moment the page mounts, even
  // before the first Phase C verify event arrives.
  const [smokeRequested, setSmokeRequested] = useState(false)

  // Derive the view model from the streamed entries.
  const derived = useMemo(() => {
    let phase: Phase = 'SCAN'
    const lines: LogLine[] = []
    const issues: IssueVM[] = []
    let activeNodeId: string | null = null
    const t0 = entries[0]?.timestamp ?? Date.now()

    for (const { id: eid, timestamp, event } of entries) {
      const t = timestamp - t0
      const e = event as AgentEvent
      switch (e.type) {
        case 'phase':
          phase = PHASE_MAP[e.phase]
          break
        case 'log':
          lines.push({ id: eid, stage: phase, text: e.message, t })
          break
        case 'issue':
          issues.push(partialIssue(e.dep, e.currentVersion, e.latestVersion))
          activeNodeId = e.dep
          lines.push({ id: eid, stage: phase, text: `${e.dep}: ${e.currentVersion} → ${e.latestVersion}`, t })
          break
        case 'verify':
          lines.push({ id: eid, stage: 'VERIFY', text: `Phase ${e.phase} ${e.success ? 'passed' : 'failed'}`, t })
          break
        case 'pr':
          if (issues.length > 0) issues[issues.length - 1].prUrl = e.url
          lines.push({ id: eid, stage: phase, text: `Draft PR opened: ${e.url}`, t })
          break
        case 'done':
          phase = 'DONE'
          lines.push({ id: eid, stage: 'DONE', text: e.summary, t })
          break
        case 'error':
          phase = 'ERROR'
          lines.push({ id: eid, stage: 'ERROR', text: e.message, t })
          break
      }
    }

    const elapsedMs = entries.length > 0 ? (entries[entries.length - 1].timestamp - t0) : 0
    return { phase, lines, issues, activeNodeId, elapsedMs }
  }, [entries])

  // On completion, fetch persisted issues for full detail (diagnosis/diff/notAnalyzed)
  // v2.0 / F20 — read smokeRequested at mount so the StageLane can render the
  // 5th lane DURING a live scan (not only after `done`). Tiny payload (one
  // boolean), one round-trip; the done-gated enrichment fetch below still
  // fires later to populate issues + persisted failure/elapsed.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    fetch(`/api/scans/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { smokeRequested?: boolean } | null) => {
        if (cancelled || !data) return
        if (typeof data.smokeRequested === 'boolean') setSmokeRequested(data.smokeRequested)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [id])

  // and the real start/complete timestamps for playback elapsed-time (Fix B1).
  useEffect(() => {
    if (!done) return
    let cancelled = false
    fetch(`/api/scans/${id}`)
      .then(async (r) => {
        // Fix #8: trigger the styled not-found page for bogus IDs.
        if (r.status === 404) notFound()
        return r.json()
      })
      .then((data: { issues?: IssueVM[]; deps?: string[]; startedAt?: string; completedAt?: string | null; status?: string; errorMessage?: string | null }) => {
        if (cancelled) return
        if (Array.isArray(data.issues) && data.issues.length > 0) setEnriched(data.issues)
        if (Array.isArray(data.deps) && data.deps.length > 0) {
          setDeps(data.deps.map((name) => ({ id: name, label: name })))
        }
        if (data.startedAt && data.completedAt) {
          const ms = new Date(data.completedAt).getTime() - new Date(data.startedAt).getTime()
          if (Number.isFinite(ms) && ms > 0) setPersistedElapsedMs(ms)
        }
        if (data.status === 'failed' || data.status === 'cancelled') {
          setPersistedFailure({
            failed: data.status === 'failed',
            cancelled: data.status === 'cancelled',
            errorMessage: data.errorMessage ?? null,
          })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [done, id])

  const issues = enriched ?? derived.issues

  // Playback: the scan finished before this page opened, so the live stream had
  // nothing to replay (it returned a synthetic "Scan not active"). Detect that —
  // done + no issues came through the live feed — and render the persisted result
  // as static playback instead of the dead-live-feed noise (DESIGN.md §10).
  const isPlayback = done && derived.issues.length === 0

  // Honest playback phase: a persisted failed/cancelled scan must render ERROR,
  // not DONE. Previously the hook hardcoded DONE → a docker-build crash showed
  // as "scan complete · no PR opened" with Bones idle (false success).
  const playbackPhase: Phase = persistedFailure.failed || persistedFailure.cancelled ? 'ERROR' : 'DONE'

  let lines = derived.lines
  if (isPlayback) {
    // Fix B2: -1 sentinel = "no timing available" → TerminalLog renders em-dash
    // instead of misleading `00.00` timestamps on every playback row.
    if (playbackPhase === 'ERROR') {
      const head = persistedFailure.cancelled
        ? 'Playback — scan was CANCELLED.'
        : 'Playback — scan FAILED.'
      const errLines = (persistedFailure.errorMessage ?? 'No saved error message.')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .slice(0, 20) // cap the rendered tail
      lines = [
        { id: 'pb-head', stage: 'ERROR' as Phase, text: head, t: -1 },
        ...errLines.map((text, i) => ({ id: `pb-err-${i}`, stage: 'ERROR' as Phase, text, t: -1 })),
      ]
    } else {
      lines = [
        {
          id: 'pb-head',
          stage: 'DONE' as Phase,
          text: issues.length > 0
            ? `Playback — scan complete. ${issues.length} issue(s) found.`
            : 'Playback — scan complete. No saved issue detail.',
          t: -1,
        },
        ...issues.map((iss, i) => ({
          id: `pb-${i}`,
          stage: 'DONE' as Phase,
          text: `${iss.dep} ${iss.currentVersion} → ${iss.latestVersion}${iss.prUrl ? ' · Draft PR opened' : ''}`,
          t: -1,
        })),
      ]
    }
  }

  // Fix B1: prefer the persisted (completed - started) duration on a finished
  // scan; fall back to the live-stream-derived elapsed for in-flight scans.
  const elapsedMs = (done && persistedElapsedMs != null) ? persistedElapsedMs : derived.elapsedMs

  return {
    phase: isPlayback ? playbackPhase : derived.phase,
    lines,
    activeNodeId: isPlayback ? null : derived.activeNodeId,
    elapsedMs,
    depsScanned: issues.length,
    issuesFound: issues.length,
    issues,
    deps: deps.length > 0 ? deps : MOCK_DEPS,
    running: !done,
    done,
    replay: () => window.location.reload(),
    smokeRequested,
  }
}

/**
 * Top-level switch. Both hooks are ALWAYS called (React rules-of-hooks safe even
 * if the route param changes without remount); args disable the unused one:
 *   demo → mock autostarts, real stream disabled (id='')
 *   live → mock idle (no autostart), real stream active
 */
export function useScanView(id: string): MockScanState {
  const isDemo = id === DEMO_ID
  const mock = useMockScan(isDemo)
  const real = useRealScanView(isDemo ? '' : id)
  return isDemo ? mock : real
}
