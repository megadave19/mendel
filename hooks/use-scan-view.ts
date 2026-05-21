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
import { useScanStream } from '@/hooks/use-scan-stream'
import { useMockScan, type MockScanState } from '@/hooks/use-mock-scan'
import type { AgentEvent, AgentPhase } from '@/lib/agent/runner'
import type { IssueVM, LogLine, Phase } from '@/components/phase-d/types'

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

  // On completion, fetch persisted issues for full detail (diagnosis/diff/notAnalyzed).
  useEffect(() => {
    if (!done) return
    let cancelled = false
    fetch(`/api/scans/${id}`)
      .then((r) => r.json())
      .then((data: { issues?: IssueVM[] }) => {
        if (!cancelled && Array.isArray(data.issues) && data.issues.length > 0) setEnriched(data.issues)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [done, id])

  return {
    phase: derived.phase,
    lines: derived.lines,
    activeNodeId: derived.activeNodeId,
    elapsedMs: derived.elapsedMs,
    depsScanned: derived.issues.length,
    issuesFound: derived.issues.length,
    issues: enriched ?? derived.issues,
    running: !done,
    done,
    replay: () => window.location.reload(),
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
