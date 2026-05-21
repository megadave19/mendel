/**
 * Issue persistence + view-model mapping.
 *
 * The runner persists each finding as a DB `Issue` row with JSON-stringified
 * blobs (SQLite has no native JSON). This module is the single place that:
 *   1. builds those blobs from agent outputs (persistIssueData), and
 *   2. parses them back into the frontend IssueVM (dbIssueToVM).
 *
 * CLAUDE.md §5b: confidence is always "medium" in v1.0, and the "Not Analyzed"
 * disclosures are always present — enforced here so they can't be omitted.
 */

import { z } from 'zod'
import type { Issue } from '@prisma/client'
import type { BreakingChange } from '@/lib/agent/signals/changelog'
import type { Diagnosis } from '@/lib/agent/phases/diagnose'
import type { FilePatch } from '@/lib/agent/patching/full-file'
import type { StaleDep } from '@/lib/agent/phases/detect'
import type { IssueVM, DiffLine } from '@/components/phase-d/types'

// Standard v1.0 disclosures — always included (CLAUDE.md §5b rule 3).
const STANDARD_NOT_ANALYZED = [
  'Full runtime behavior — changelog-parsing-only analysis (no semantic API diff in v1.0).',
  'Transitive dependency impact of the version bump.',
  'Test coverage of the changed code paths.',
]

// ── Persisted JSON shapes (validated on read) ─────────────────────────────────

const DiffLineSchema = z.object({
  kind: z.enum(['add', 'del', 'ctx', 'meta']),
  text: z.string(),
})

const DiagnosisBlob = z.object({
  dep: z.string(),
  currentVersion: z.string(),
  latestVersion: z.string(),
  what: z.string(),
  why: z.string(),
  evidence: z.array(z.object({ label: z.string(), url: z.string() })),
})

const PatchBlob = z.object({
  filePath: z.string(),
  diff: z.array(DiffLineSchema),
})

const VerificationBlob = z.object({ passed: z.boolean() })

// ── Build the diff preview from a version bump + file explanations ────────────
// Full-file rewrites don't yield a line diff cheaply, so we render an honest
// minimal diff: the manifest version change + each touched file's explanation.
function buildDiff(dep: StaleDep, patches: FilePatch[]): DiffLine[] {
  const diff: DiffLine[] = [
    { kind: 'meta', text: '@@ package.json @@' },
    { kind: 'del', text: `  "${dep.name}": "${dep.currentVersion}"` },
    { kind: 'add', text: `  "${dep.name}": "^${dep.latestVersion}"` },
  ]
  for (const p of patches.filter((p) => p.filePath !== 'package.json')) {
    diff.push({ kind: 'meta', text: `@@ ${p.filePath} @@` })
    diff.push({ kind: 'ctx', text: `// ${p.explanation}` })
  }
  return diff
}

// ── Persist: agent outputs → db.issue.create data ─────────────────────────────

export function persistIssueData(args: {
  scanId: string
  dep: StaleDep
  breakingChanges: BreakingChange[]
  diagnosis: Diagnosis
  patches: FilePatch[]
  verificationPassed: boolean
  prUrl?: string
}) {
  const { scanId, dep, breakingChanges, diagnosis, patches, verificationPassed, prUrl } = args

  const evidence =
    breakingChanges.length > 0
      ? breakingChanges.slice(0, 5).map((bc) => ({ label: `${bc.symbol} (${bc.changeType})`, url: bc.sourceUrl }))
      : [{ label: `${dep.name} ${dep.currentVersion} → ${dep.latestVersion} (major)`, url: `https://www.npmjs.com/package/${dep.name}` }]

  const diagnosisBlob = {
    dep: dep.name,
    currentVersion: dep.currentVersion,
    latestVersion: dep.latestVersion,
    what: diagnosis.summary,
    why: diagnosis.impact,
    evidence,
  }

  return {
    scanId,
    type: 'stale-dependency',
    severity: 'major',
    confidence: JSON.stringify({ level: 'medium' }), // §5b: always medium in v1.0
    diagnosis: JSON.stringify(diagnosisBlob),
    patch: JSON.stringify({ filePath: patches[0]?.filePath ?? 'package.json', diff: buildDiff(dep, patches) }),
    verification: JSON.stringify({ passed: verificationPassed }),
    notAnalyzed: JSON.stringify(STANDARD_NOT_ANALYZED),
    prUrl: prUrl ?? null,
    status: prUrl ? 'pr-opened' : 'diagnosed',
  }
}

// ── Read: DB Issue → IssueVM (safe parse with fallbacks) ──────────────────────

function safeParse<T>(schema: z.ZodType<T>, raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    const parsed = schema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : fallback
  } catch {
    return fallback
  }
}

export function dbIssueToVM(issue: Issue): IssueVM {
  const d = safeParse(DiagnosisBlob, issue.diagnosis, {
    dep: 'unknown', currentVersion: '?', latestVersion: '?', what: '', why: '', evidence: [],
  })
  const p = safeParse(PatchBlob, issue.patch, { filePath: 'package.json', diff: [] })
  const v = safeParse(VerificationBlob, issue.verification, { passed: false })
  const notAnalyzed = safeParse(z.array(z.string()), issue.notAnalyzed, STANDARD_NOT_ANALYZED)

  return {
    id: issue.id,
    dep: d.dep,
    currentVersion: d.currentVersion,
    latestVersion: d.latestVersion,
    confidence: 'medium',
    what: d.what,
    why: d.why,
    evidence: d.evidence,
    filePath: p.filePath,
    diff: p.diff,
    notAnalyzed,
    verificationPassed: v.passed,
    prUrl: issue.prUrl ?? undefined,
  }
}
