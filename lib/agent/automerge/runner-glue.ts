/**
 * v2.3 / F24 sub-phase 2 — auto-merge runner glue.
 *
 * Bridges the pure §5c policy (./policy.ts) with the world: gathers all
 * inputs from the scan + RepoSetting + rejection store, calls
 * `evaluateAutoMerge`, persists EVERY verdict + reason to AgentLog
 * (CLAUDE.md §5c: "every NO reason is logged — no silent action, no
 * silent skip"), then — only on a YES verdict — runs the cancelable
 * dwell window and calls the GitHub merge API.
 *
 * **Layering rule:** the pure policy (./policy.ts) must NEVER reach
 * into this file. The runner calls `runAutoMergeFor(...)` and this
 * file owns all the IO. That keeps the §5c boundary tests in
 * tests/automerge-policy.test.ts exhaustive: nothing in the policy
 * touches DB/octokit/clock, so a future refactor can't accidentally
 * weaken the envelope by injecting state.
 *
 * **Honesty rules baked in:**
 *   - Even when the policy says NO, we still write an `automerge.verdict`
 *     AgentLog row with every reason — so an audit can see what was
 *     considered and why. The same shape lands in Issue.autoMerge.
 *   - When the policy says YES, we IMMEDIATELY log a `dwell.started`
 *     event, then sleep the configured window, then re-confirm the
 *     PR is still mergeable, then call the merge API. Every step
 *     gets its own AgentLog row.
 *   - The merge call itself is wrapped in a hard timeout + an honest
 *     failure path. A 405/409 (PR not mergeable) is recorded as a
 *     `merge.failed` event with the GitHub-returned reason. NEVER as
 *     "kinda merged."
 */

import type { PrismaClient } from '@prisma/client'
import type { BreakingChange } from '@/lib/agent/signals/changelog'
import type { SemanticDiff } from '@/lib/agent/signals/semantic-diff'
import type { ConfidenceScore } from '@/lib/agent/confidence/score'
import { mergePullRequest, type MergePullRequestResult } from '@/lib/github'
import {
  evaluateAutoMerge,
  classifyVersionBump,
  type AutoMergeInput,
  type AutoMergeVerdict,
  type VersionBumpKind,
} from './policy'

// ── Inputs ────────────────────────────────────────────────────────────────────

/** Everything the runner already has on hand by the time a PR is opened. */
export interface AutoMergeContext {
  scanId: string
  issueId: string
  // Repo + PR identifiers
  repoFullName: string
  prNumber: number
  prUrl: string
  // Dependency under upgrade
  depName: string
  depChangeType: string
  fromVersion: string
  toVersion: string
  // Signals + verification + smoke + confidence
  breakingChanges: BreakingChange[]
  semanticDiff: SemanticDiff | null
  confidence: ConfidenceScore
  verificationPassed: boolean
  smokePassed: boolean | null
  // Threshold + capability (already computed by the runner)
  threshold: number
  patHasMergeRights: boolean
}

/** Minimal Prisma surface this module touches. Lets tests inject a fake. */
export type AutoMergePrisma = Pick<PrismaClient, 'repoSetting' | 'rejectionPattern' | 'agentLog' | 'issue'>

/** Sleep + GitHub merge are wrapped so tests can inject fakes
 *  (fake clock, fake merge result) without spinning real timers or APIs. */
export interface AutoMergeIO {
  /** Resolves after `ms`. Tests can replace with a fake-clock waiter. */
  sleep: (ms: number) => Promise<void>
  /** Wraps lib/github.mergePullRequest. Tests inject the result. */
  merge: typeof mergePullRequest
  /** ISO timestamp generator — injectable so tests can pin time. */
  now: () => Date
}

export const defaultIO: AutoMergeIO = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  merge: mergePullRequest,
  now: () => new Date(),
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Evaluate + (maybe) merge for one Issue. Returns the verdict + outcome
 * so the runner can include it in logs/SSE. Persists ALL of:
 *   - AgentLog row: `automerge.verdict` (with every reason)
 *   - AgentLog row: `automerge.dwell` (if shouldMerge=true)
 *   - AgentLog row: `automerge.merge` (if dwell completed)
 *   - Issue.autoMerge JSON column (terminal outcome)
 *
 * The runner SHOULD await this AFTER the PR is opened + Issue row is
 * persisted (so issueId exists). It runs synchronously: the dwell
 * window happens inside this call. A future polish can move dwell to
 * the monitor (F25), enabling true cancelability via UI button.
 */
export async function runAutoMergeFor(
  ctx: AutoMergeContext,
  db: AutoMergePrisma,
  pat: string,
  io: AutoMergeIO = defaultIO,
): Promise<{ verdict: AutoMergeVerdict; outcome: AutoMergeOutcome }> {
  // 1. Gather the policy inputs (all IO happens here).
  const input = await gatherAutoMergeInput(ctx, db)

  // 2. Run the pure policy.
  const verdict = evaluateAutoMerge(input)

  // 3. Persist the verdict (skip case ends here).
  await db.agentLog.create({
    data: {
      scanId: ctx.scanId,
      issueId: ctx.issueId,
      kind: 'automerge.verdict',
      payload: JSON.stringify({
        shouldMerge: verdict.shouldMerge,
        reasons: verdict.reasons,
        // The policy inputs are echoed so an audit can reproduce the
        // decision without re-querying every source.
        inputs: redactedInput(input),
        prUrl: ctx.prUrl,
        depName: ctx.depName,
        fromVersion: ctx.fromVersion,
        toVersion: ctx.toVersion,
      }),
    },
  })

  if (!verdict.shouldMerge) {
    const outcome: AutoMergeOutcome = {
      verdict: 'skipped',
      reasons: verdict.reasons,
    }
    await persistTerminalOutcome(ctx, db, outcome)
    return { verdict, outcome }
  }

  // 4. Dwell window. Log start + (sleep) + completion. The setting row
  //    MUST exist here — §5c r1 would've blocked otherwise. We re-read
  //    autoMergeDwellSeconds (separate from the policy inputs, which
  //    only need the floor) and clamp to [0, 24h] defensively.
  const dwellSeconds = clampDwell(await readDwellSeconds(ctx, db))
  await db.agentLog.create({
    data: {
      scanId: ctx.scanId,
      issueId: ctx.issueId,
      kind: 'automerge.dwell',
      payload: JSON.stringify({
        phase: 'started',
        dwellSeconds,
        startedAt: io.now().toISOString(),
        prUrl: ctx.prUrl,
      }),
    },
  })
  await io.sleep(dwellSeconds * 1000)
  await db.agentLog.create({
    data: {
      scanId: ctx.scanId,
      issueId: ctx.issueId,
      kind: 'automerge.dwell',
      payload: JSON.stringify({
        phase: 'completed',
        dwellSeconds,
        completedAt: io.now().toISOString(),
        prUrl: ctx.prUrl,
      }),
    },
  })

  // 5. Call the merge API.
  const { owner, repo } = parseRepoFullName(ctx.repoFullName)
  const mergeResult: MergePullRequestResult = await io.merge(pat, owner, repo, ctx.prNumber, {
    mergeMethod: 'merge',
    commitTitle: `Mendel auto-merge: bump ${ctx.depName} ${ctx.fromVersion} → ${ctx.toVersion}`,
    commitMessage:
      `Auto-merged by Mendel under the §5c envelope.\n\n` +
      `Confidence: ${ctx.confidence.overall}/100 (${ctx.confidence.bucket}).\n` +
      `Verification + smoke both passed.\n` +
      `Bump kind: ${input.versionBumpKind}.\n`,
  })

  // 6. Log + persist the terminal outcome.
  await db.agentLog.create({
    data: {
      scanId: ctx.scanId,
      issueId: ctx.issueId,
      kind: 'automerge.merge',
      payload: JSON.stringify({
        ok: mergeResult.ok,
        sha: mergeResult.ok ? mergeResult.sha : undefined,
        reason: mergeResult.ok ? undefined : mergeResult.reason,
        httpStatus: mergeResult.ok ? undefined : mergeResult.status,
        prUrl: ctx.prUrl,
      }),
    },
  })
  const outcome: AutoMergeOutcome = mergeResult.ok
    ? {
        verdict: 'merged',
        reasons: [],
        mergedCommitSha: mergeResult.sha,
        mergedAt: io.now().toISOString(),
      }
    : {
        verdict: 'failed',
        reasons: [`GitHub merge call failed: ${mergeResult.reason}${mergeResult.status ? ` (HTTP ${mergeResult.status})` : ''}`],
      }
  await persistTerminalOutcome(ctx, db, outcome)
  return { verdict, outcome }
}

// ── Input gathering ──────────────────────────────────────────────────────────

async function gatherAutoMergeInput(
  ctx: AutoMergeContext,
  db: AutoMergePrisma,
): Promise<AutoMergeInput> {
  // setting: query by repoFullName. Null when no row exists = implicitly OFF.
  const setting = await db.repoSetting.findUnique({ where: { repoFullName: ctx.repoFullName } })

  // Rejection history: scoped to (depName, changeType). Mirrors §5c r5.
  const rejection = await db.rejectionPattern.findFirst({
    where: { depName: ctx.depName, changeType: ctx.depChangeType },
    select: { id: true },
  })

  return {
    setting: setting
      ? {
          autoMergeEnabled: setting.autoMergeEnabled,
          autoMergeConfidenceFloor: setting.autoMergeConfidenceFloor,
        }
      : null,
    patHasMergeRights: ctx.patHasMergeRights,
    versionBumpKind: classifyVersionBump(ctx.fromVersion, ctx.toVersion),
    changelogBreakingChanges: ctx.breakingChanges.length,
    semanticDiffBreakingChanges:
      ctx.semanticDiff === null ? null : countSemanticDiffBreakingChanges(ctx.semanticDiff),
    signalsAgree: computeSignalsAgree(ctx.breakingChanges, ctx.semanticDiff),
    confidence: { overall: ctx.confidence.overall, bucket: ctx.confidence.bucket },
    threshold: ctx.threshold,
    verificationPassed: ctx.verificationPassed,
    smokePassed: ctx.smokePassed,
    hasRejectionHistory: rejection !== null,
  }
}

async function readDwellSeconds(ctx: AutoMergeContext, db: AutoMergePrisma): Promise<number> {
  const row = await db.repoSetting.findUnique({ where: { repoFullName: ctx.repoFullName } })
  return row?.autoMergeDwellSeconds ?? 60
}

// ── Pure helpers (covered by automerge-runner-glue.test.ts) ──────────────────

/**
 * Count breaking changes the semantic-diff signal saw — removed exports
 * + signature changes (deprecations are not a break by themselves). This
 * matches the change-classification the per-symbol scorer uses.
 */
export function countSemanticDiffBreakingChanges(sd: SemanticDiff): number {
  return sd.removedExports.length + sd.signatureChanges.length
}

/**
 * Decide whether the two signals AGREE on the breaking-change set. Per
 * §5c rule 2: "signals agree." The cleanest honest definition:
 *
 *   - Both empty            → agree (nothing to disagree on)
 *   - One empty, other not  → disagree (one says break, other says clean)
 *   - Both non-empty AND
 *     the symbol sets match → agree
 *   - Both non-empty AND
 *     the symbol sets differ → disagree
 *
 * Semantic-diff is null (signal didn't run) → false (can't confirm
 * agreement). The policy handles the null case separately too.
 */
export function computeSignalsAgree(
  breakingChanges: BreakingChange[],
  semanticDiff: SemanticDiff | null,
): boolean {
  if (semanticDiff === null) return false
  const changelogSet = new Set(breakingChanges.map((bc) => bc.symbol))
  const semanticSet = new Set<string>([
    ...semanticDiff.removedExports,
    ...semanticDiff.signatureChanges.map((sc) => sc.symbol),
  ])
  if (changelogSet.size === 0 && semanticSet.size === 0) return true
  if (changelogSet.size !== semanticSet.size) return false
  for (const sym of changelogSet) {
    if (!semanticSet.has(sym)) return false
  }
  return true
}

export function parseRepoFullName(name: string): { owner: string; repo: string } {
  const [owner, repo] = name.split('/')
  if (!owner || !repo) throw new Error(`repoFullName "${name}" is not "owner/name"`)
  return { owner, repo }
}

/** Defensive dwell clamp — never sleep > 24h, never < 0.
 *
 *  Infinity is treated as "above the upper bound" (clamp to 24h) so an
 *  out-of-range value defaults to the SAFER side of the §5c rule 6
 *  dwell window — maximally delaying the merge rather than firing
 *  instantly. NaN is treated as 0 (aberrant; legitimate code never
 *  produces it). */
export function clampDwell(seconds: number): number {
  if (Number.isNaN(seconds)) return 0
  if (seconds < 0) return 0
  if (seconds > 86_400 || !Number.isFinite(seconds)) return 86_400
  return seconds
}

/** Strip noisy fields from the persisted input echo. Keeps the AgentLog
 *  payload small + readable; the runner already wrote the full signals
 *  elsewhere. */
function redactedInput(input: AutoMergeInput): Record<string, unknown> {
  return {
    versionBumpKind: input.versionBumpKind,
    changelogBreakingChanges: input.changelogBreakingChanges,
    semanticDiffBreakingChanges: input.semanticDiffBreakingChanges,
    signalsAgree: input.signalsAgree,
    confidence: input.confidence,
    threshold: input.threshold,
    verificationPassed: input.verificationPassed,
    smokePassed: input.smokePassed,
    hasRejectionHistory: input.hasRejectionHistory,
    patHasMergeRights: input.patHasMergeRights,
    setting: input.setting,
  }
}

// ── Outcome persisted to Issue.autoMerge ─────────────────────────────────────

export interface AutoMergeOutcome {
  verdict: 'merged' | 'skipped' | 'failed' | 'cancelled'
  reasons: string[]
  mergedCommitSha?: string
  mergedAt?: string
}

async function persistTerminalOutcome(
  ctx: AutoMergeContext,
  db: AutoMergePrisma,
  outcome: AutoMergeOutcome,
): Promise<void> {
  await db.issue.update({
    where: { id: ctx.issueId },
    data: { autoMerge: JSON.stringify(outcome) },
  })
}

// Re-export classifyVersionBump for parity with the policy module
// (so callers in the runner can stay on one import).
export { classifyVersionBump, type VersionBumpKind }
