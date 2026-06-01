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
import type { SemanticDiff } from '@/lib/agent/signals/semantic-diff'
import type { ConfidenceScore } from '@/lib/agent/confidence/score'
import { ConfidenceScoreSchema } from '@/lib/agent/confidence/score'
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
  /** v1.5 — Semantic-diff signal output. Null if signal failed or was skipped. */
  semanticDiff?: SemanticDiff | null
  /**
   * v1.5 Workstream #2 — Full calibrated ConfidenceScore. When present, it
   * replaces the v1.0 `{ level: 'medium' }` stub in the `confidence` column.
   * When absent, we fall back to the stub to preserve §5b honest framing
   * (a missing score must NOT be misread as "high confidence").
   */
  confidenceScore?: ConfidenceScore | null
  /**
   * Last ~1500 chars of stdout/stderr from the phase that FAILED. The runner
   * sends Phase A output when install failed, OR Phase B output when install
   * passed but typecheck/test failed (the 2026-05-31 gap caught auditing scan
   * cmptwjea2…). Without this, the user couldn't see WHAT broke verification
   * — same opacity §11c was added to prevent. Name kept for back-compat with
   * older callers; semantics are now "the relevant failure output."
   */
  phaseAOutput?: string
  /**
   * v2.1 / F21 — workspace-relative dir of the member package this issue
   * belongs to (e.g. 'packages/ui' or '.'). Persisted to Issue.packageDir
   * so the UI can render per-package chips and the dep graph can cluster
   * by package. Omit for v1.5-shape callers (back-compat).
   */
  packageDir?: string
  /**
   * v2.2 / F23a — language id of the adapter that analyzed this issue
   * (e.g. 'typescript', 'python'). Persisted to Issue.language so the UI
   * can render LangBadge and the bench summary can split by language.
   * Omit for v1.5-shape callers (back-compat → null at Prisma layer).
   */
  language?: string
}) {
  const { scanId, dep, breakingChanges, diagnosis, patches, verificationPassed, prUrl, semanticDiff, confidenceScore, phaseAOutput, packageDir, language } = args

  // Evidence: prefer changelog citations; if none, fall back to npm link.
  // Once Workstream #2 (confidence scoring) lands, semantic-diff symbols can
  // also be cited here. For Workstream #1 we keep the v1.0 evidence shape.
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

  // v1.5: Not-Analyzed grows when semantic-diff was successful — we drop the
  // "no semantic API diff" disclosure since we DID one. Confidence framing
  // (CLAUDE.md §5b) still requires honest disclosure of what we missed.
  const notAnalyzed = semanticDiff && semanticDiff.coveragePercent > 0
    ? [
        `Analyzed ${semanticDiff.coveragePercent}% of exported symbols via ${semanticDiff.analysisTier} signal. The remainder was unanalyzable.`,
        'Transitive dependency impact of the version bump.',
        'Test coverage of the changed code paths.',
      ]
    : STANDARD_NOT_ANALYZED

  // §5b honest framing: when no calibrated score is available, we DO NOT
  // synthesize one. We persist the v1.0 stub so the UI keeps showing
  // "medium" — never accidentally inflating to high.
  const confidenceBlob = confidenceScore
    ? confidenceScore
    : { level: 'medium' as const }

  return {
    scanId,
    type: 'stale-dependency',
    severity: 'major',
    confidence: JSON.stringify(confidenceBlob),
    diagnosis: JSON.stringify(diagnosisBlob),
    patch: JSON.stringify({ filePath: patches[0]?.filePath ?? 'package.json', diff: buildDiff(dep, patches) }),
    verification: JSON.stringify(
      verificationPassed
        ? { passed: true }
        : { passed: false, output: (phaseAOutput ?? '').slice(-1500) },
    ),
    notAnalyzed: JSON.stringify(notAnalyzed),
    prUrl: prUrl ?? null,
    status: prUrl ? 'pr-opened' : 'diagnosed',
    semanticDiff: semanticDiff ? JSON.stringify(semanticDiff) : null,
    // v2.1 / F21 — single-package callers omit this; back-compat preserved
    // by Prisma defaulting `Issue.packageDir` to null.
    packageDir: packageDir ?? null,
    // v2.2 / F23a — pre-F23 callers (pre-adapter) omit this; back-compat
    // preserved by Prisma defaulting `Issue.language` to null.
    language: language ?? null,
  }
}

/**
 * v1.5 Workstream #2 — read the persisted confidence blob and tell us
 * whether it's a v1.0 stub or a full ConfidenceScore. Used by API + UI
 * to display calibrated bucket/score when present, fallback to "medium"
 * label when not.
 */
export function parseConfidenceBlob(raw: string | null | undefined):
  | { kind: 'stub'; level: 'medium' }
  | { kind: 'score'; value: ConfidenceScore }
{
  if (!raw) return { kind: 'stub', level: 'medium' }
  try {
    const obj = JSON.parse(raw)
    const parsed = ConfidenceScoreSchema.safeParse(obj)
    if (parsed.success) return { kind: 'score', value: parsed.data }
    return { kind: 'stub', level: 'medium' }
  } catch {
    return { kind: 'stub', level: 'medium' }
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

  // v1.5 Workstream #4: surface calibrated bucket + score when persisted as a
  // full ConfidenceScore. v1.0 stub data keeps the 'medium' bucket and ships
  // no confidenceData — UI components must accept absence (CLAUDE.md §5b: no
  // synthetic numbers when only the stub exists).
  const parsed = parseConfidenceBlob(issue.confidence)
  let bucket: 'high' | 'medium' | 'low' = 'medium'
  let confidenceData: IssueVM['confidenceData']
  if (parsed.kind === 'score') {
    bucket = parsed.value.bucket
    confidenceData = {
      bucket: parsed.value.bucket,
      score: parsed.value.overall,
      capped: parsed.value.verificationCapped,
      tier: parsed.value.analysisCoverage.analysisTier,
      coveragePercent: parsed.value.analysisCoverage.percentCovered,
      perBreakingChange: parsed.value.perBreakingChange.map((p) => ({
        symbol: p.symbol, score: p.score, tag: p.tag,
      })),
    }
  }

  return {
    id: issue.id,
    dep: d.dep,
    currentVersion: d.currentVersion,
    latestVersion: d.latestVersion,
    confidence: bucket,
    what: d.what,
    why: d.why,
    evidence: d.evidence,
    filePath: p.filePath,
    diff: p.diff,
    notAnalyzed,
    verificationPassed: v.passed,
    prUrl: issue.prUrl ?? undefined,
    confidenceData,
    // v2.1 / F21 — surface packageDir if persisted. packageName is filled in
    // by the API layer (it joins ScanPackage to look up the name); we don't
    // store the name on Issue to avoid drift if a package gets renamed.
    packageDir: (issue as Issue & { packageDir?: string | null }).packageDir ?? undefined,
  }
}
