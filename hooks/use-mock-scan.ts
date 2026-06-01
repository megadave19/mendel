'use client'

/**
 * useMockScan — scripted client-side scan playback for the S4 Live Console.
 *
 * D2 gate (PRD §17b): "S4 runs a full mock scan with all motion firing." This
 * hook drives a deterministic timeline so every pane animates end-to-end without
 * a backend: phase progression (→ mascot pose + stage lane), streaming log lines
 * (→ TerminalLog type-on), and the active dep node (→ DepGraph3D pulse).
 *
 * Real SSE wiring (useScanStream) replaces this for live scans in D3, when issue
 * cards land. Mock and live share the same Phase/LogLine shapes (phase-d/types).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogLine, Phase, IssueVM } from '@/components/phase-d/types'
import type { DepNode } from '@/components/phase-d/DepGraph'

// The issue the mock scan surfaces (mirrors a real axios 0.24 → 1.x finding).
export const MOCK_ISSUE: IssueVM = {
  id: 'axios-mock',
  dep: 'axios',
  currentVersion: '0.24.0',
  latestVersion: '1.7.9',
  confidence: 'medium',
  what: 'Upgrades axios from 0.24.0 to 1.7.9 (major). The default export and response error shape changed across the 1.0 boundary.',
  why: 'axios@1 removed the CommonJS default export and changed how request errors surface. Code importing the default and reading err.response will break at runtime.',
  evidence: [
    { label: 'axios 1.0.0 release notes', url: 'https://github.com/axios/axios/releases/tag/v1.0.0' },
    { label: 'CHANGELOG — breaking changes', url: 'https://github.com/axios/axios/blob/v1.x/CHANGELOG.md' },
  ],
  filePath: 'src/client.ts',
  diff: [
    { kind: 'meta', text: '@@ src/client.ts @@' },
    { kind: 'del', text: "import axios from 'axios'" },
    { kind: 'add', text: "import { axios } from 'axios'" },
    { kind: 'ctx', text: '' },
    { kind: 'ctx', text: 'export async function getUser(id: string) {' },
    { kind: 'del', text: '  const res = await axios.get(`/users/${id}`)' },
    { kind: 'add', text: '  const res = await axios.get(`/users/${id}`, { validateStatus: () => true })' },
    { kind: 'ctx', text: '  return res.data' },
    { kind: 'ctx', text: '}' },
  ],
  notAnalyzed: [
    'Full runtime behavior — analysis is changelog-parsing only (no semantic API diff in v1.0).',
    'Transitive dependency impact of the axios bump.',
    'Test coverage of the changed code paths.',
  ],
  verificationPassed: true,
}

export const MOCK_DEPS: DepNode[] = [
  { id: 'axios', label: 'axios' },
  { id: 'typescript', label: 'typescript' },
  { id: 'zod', label: 'zod' },
  { id: 'react', label: 'react' },
  { id: 'next', label: 'next' },
  { id: 'eslint', label: 'eslint' },
  { id: 'vitest', label: 'vitest' },
  { id: 'prisma', label: 'prisma' },
]

interface ScriptStep {
  at: number // ms from start
  phase: Phase
  text: string
  node?: string | null
  depsScanned?: number
  issuesFound?: number
}

// Mimics a real scan of megadave19/mendel-test (axios 0.24 → 1.x).
const SCRIPT: ScriptStep[] = [
  { at: 300, phase: 'SCAN', text: 'Cloning megadave19/mendel-test (depth=1)…', depsScanned: 0 },
  { at: 1100, phase: 'SCAN', text: 'Reading package.json — 8 dependencies found', node: 'axios', depsScanned: 8 },
  { at: 1900, phase: 'SCAN', text: 'Querying npm registry for latest versions…', node: 'typescript' },
  { at: 2600, phase: 'SCAN', text: 'axios 0.24.0 → 1.7.9 (major) · flagged stale', node: 'axios', issuesFound: 1 },
  { at: 3300, phase: 'DIAGNOSE', text: 'Fetching axios CHANGELOG from GitHub releases…', node: 'axios' },
  { at: 4200, phase: 'DIAGNOSE', text: 'Breaking change: default export removed in 1.0', node: 'axios' },
  { at: 5000, phase: 'DIAGNOSE', text: 'Cross-referencing 3 usage sites in src/…', node: 'zod' },
  { at: 5800, phase: 'PATCH', text: 'Generating full-file patch for src/client.ts', node: 'axios' },
  { at: 6700, phase: 'PATCH', text: 'Rewriting import + response-shape access', node: 'next' },
  { at: 7500, phase: 'PATCH', text: 'Running Prettier on patched files', node: 'eslint' },
  { at: 8300, phase: 'VERIFY', text: 'Phase A — pnpm install (--network=bridge)', node: 'prisma' },
  { at: 9300, phase: 'VERIFY', text: 'Phase B — tsc --noEmit (--network=none)', node: 'vitest' },
  { at: 10300, phase: 'VERIFY', text: 'TYPECHECK_OK — verification passed', node: 'react' },
  { at: 11100, phase: 'DONE', text: 'Draft PR opened · confidence: medium · review required', node: null },
]

const TOTAL_MS = 11800

export interface MockScanState {
  phase: Phase
  lines: LogLine[]
  activeNodeId: string | null
  elapsedMs: number
  depsScanned: number
  issuesFound: number
  issues: IssueVM[]
  /** Dependency nodes for the 3D graph. */
  deps: DepNode[]
  running: boolean
  done: boolean
  replay: () => void
  /**
   * v2.0 / F20 — true when this scan opted into Phase C smoke-test. Drives
   * whether StageLane renders the 5th lane. Default false → v1.5 4-lane view.
   */
  smokeRequested: boolean
  /** v2.1 / F21 — workspace flavor (null for single-package + demo mock). */
  workspaceKind: string | null
  /** v2.1 / F21 — per-package rows for the workspace mini-stats; empty for single. */
  packages: Array<{
    id: string; name: string; dir: string; depsCount: number; issuesFound: number;
    scanned: boolean; skipReason: string | null
  }>
}

export function useMockScan(autoStart = true): MockScanState {
  const [phase, setPhase] = useState<Phase>('SCAN')
  const [lines, setLines] = useState<LogLine[]>([])
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [depsScanned, setDepsScanned] = useState(0)
  const [issuesFound, setIssuesFound] = useState(0)
  const [issues, setIssues] = useState<IssueVM[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (ticker.current) clearInterval(ticker.current)
    ticker.current = null
  }, [])

  const replay = useCallback(() => {
    clearAll()
    setLines([])
    setPhase('SCAN')
    setActiveNodeId(null)
    setElapsedMs(0)
    setDepsScanned(0)
    setIssuesFound(0)
    setIssues([])
    setDone(false)
    setRunning(true)

    const start = Date.now()
    ticker.current = setInterval(() => setElapsedMs(Date.now() - start), 50)

    SCRIPT.forEach((step) => {
      timers.current.push(
        setTimeout(() => {
          setPhase(step.phase)
          if (step.node !== undefined) setActiveNodeId(step.node)
          if (step.depsScanned !== undefined) setDepsScanned(step.depsScanned)
          if (step.issuesFound !== undefined) {
            setIssuesFound(step.issuesFound)
            // Surface the issue card the moment the dep is flagged stale.
            if (step.issuesFound > 0) setIssues([MOCK_ISSUE])
          }
          setLines((prev) => [
            ...prev,
            { id: `${step.at}-${step.phase}`, stage: step.phase, text: step.text, t: step.at },
          ])
        }, step.at),
      )
    })

    timers.current.push(
      setTimeout(() => {
        setRunning(false)
        setDone(true)
        setActiveNodeId(null)
        if (ticker.current) clearInterval(ticker.current)
      }, TOTAL_MS),
    )
  }, [clearAll])

  useEffect(() => {
    if (autoStart) replay()
    return clearAll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fix #12: pause the elapsed-time ticker (50ms setInterval) when the tab is
  // hidden — it was waking the page continuously off-screen for no benefit.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && ticker.current) {
        clearInterval(ticker.current)
        ticker.current = null
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  return { phase, lines, activeNodeId, elapsedMs, depsScanned, issuesFound, issues, deps: MOCK_DEPS, running, done, replay, smokeRequested: false, workspaceKind: null, packages: [] }
}
