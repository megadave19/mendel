import EventEmitter from 'events'
import path from 'path'
import { mkdirSync, rmSync, readFileSync } from 'fs'
import { cloneRepo, detectMonorepo, getRepoMeta, assessSubmitCapability } from '@/lib/github'
import { detectStaleDeps } from './phases/detect'
import { parseBreakingChanges } from './signals/changelog'
import { parseSemanticDiff, type SemanticDiff } from './signals/semantic-diff'
import { calculateConfidence } from './confidence/score'
import { chooseSubmissionMode, explainSubmissionMode } from './confidence/threshold'
import { summarizeScanConfidence } from './confidence/summary'
import { buildAllowlist } from '@/lib/sandbox/iptables-allowlist'
import { diagnoseIssue } from './phases/diagnose'
import { patchFileSmart } from './patching'
import { submitDraftPR } from './phases/submit'
import {
  runPhaseA,
  runPhaseB,
  cleanupVolume,
  ensureSandboxImage,
  volumeName,
} from '@/lib/sandbox/executor'
import { detectPackageManager, hasTsConfig, detectTestRunner, explainInstallFailure } from '@/lib/sandbox/detect'
import { db } from '@/lib/db'
import { persistIssueData } from './issue-vm'
import { buildReferenceIndex, findPackageUsageSites } from './signals/ast-parser'
import { promisify } from 'util'
import { exec } from 'child_process'
const execAsync = promisify(exec)

// ─── Event bus ───────────────────────────────────────────────────────────────

// Shared via globalThis so the POST route (runScan) and the SSE stream route
// (getScanEmitter) hit the SAME map. Next dev gives routes separate module
// instances, so a plain module-level Map isn't shared → the stream can't find a
// running scan's emitter and reports "Scan not active". globalThis fixes both
// dev and prod (same pattern as the Prisma client singleton).
const globalForEmitters = globalThis as unknown as {
  __mendelScanEmitters?: Map<string, EventEmitter>
  __mendelCancelled?: Set<string>
}
const scanEmitters: Map<string, EventEmitter> =
  globalForEmitters.__mendelScanEmitters ?? (globalForEmitters.__mendelScanEmitters = new Map())
// Fix #4: in-process cancel registry — cancel endpoint adds the scanId; the
// runner checks between phases and throws "Scan cancelled" (caught by outer
// catch → status='cancelled'). Soft cancel: any in-flight Docker container
// keeps running for that phase, but no further phase advances.
const cancelledScans: Set<string> =
  globalForEmitters.__mendelCancelled ?? (globalForEmitters.__mendelCancelled = new Set())

export function getScanEmitter(scanId: string): EventEmitter | undefined {
  return scanEmitters.get(scanId)
}

export function requestCancel(scanId: string): boolean {
  if (!scanEmitters.has(scanId)) return false
  cancelledScans.add(scanId)
  return true
}

function throwIfCancelled(scanId: string): void {
  if (cancelledScans.has(scanId)) {
    cancelledScans.delete(scanId)
    throw new Error('Scan cancelled by user')
  }
}

// ─── Event types ─────────────────────────────────────────────────────────────

export type AgentPhase = 'DETECT' | 'DIAGNOSE' | 'PATCH' | 'VERIFY' | 'SUBMIT'

export type AgentEvent =
  | { type: 'phase'; phase: AgentPhase }
  | { type: 'log'; message: string }
  | { type: 'issue'; dep: string; currentVersion: string; latestVersion: string }
  | { type: 'verify'; phase: 'A' | 'B'; success: boolean; output: string }
  | { type: 'pr'; url: string; branch: string }
  | { type: 'done'; summary: string }
  | { type: 'error'; message: string }

// ─── URL parsing ─────────────────────────────────────────────────────────────

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') }
}

// ─── Runner ──────────────────────────────────────────────────────────────────

// v1.5 W#7: token caps lifted per CLAUDE.md §5 Rule 10 + TRD §7.2.
// v1.0 capped at 250k per scan / 3 files per dep.
// v1.5 caps at 500k per scan; 100k per issue (per-issue budget gates file
// ranking — files with the highest impact-score are patched first, lower
// ones skipped if the budget runs out for that issue).
const TOKEN_CAP = 500_000
const MAX_DEPS = 3                  // still cap deps per scan (changelog-LLM cost)
const PER_ISSUE_TOKEN_BUDGET = 100_000
const PER_FILE_TOKEN_ESTIMATE = 8_000

/**
 * Optional per-scan overrides supplied by the API.
 * v1.5 Workstream #4: `confidenceThreshold` lets the user override the env
 * default (MENDEL_CONFIDENCE_THRESHOLD) via the Settings slider. Clamped
 * server-side by the API Zod schema (40–100) before reaching here.
 * v1.5 Workstream #8: `tier2AllowlistHosts` opts the scan into extra
 * sandbox-egress hostnames beyond the default tier-1 list. Validated +
 * deduped server-side. Each rejected host is logged.
 */
export interface RunScanOptions {
  confidenceThreshold?: number
  tier2AllowlistHosts?: string[]
}

export async function runScan(
  scanId: string,
  repoUrl: string,
  pat: string,
  options: RunScanOptions = {},
): Promise<void> {
  const emitter = new EventEmitter()
  scanEmitters.set(scanId, emitter)

  const emit = (event: AgentEvent) => emitter.emit('event', event)
  const log = (message: string) => emit({ type: 'log', message })

  const WORKSPACE = path.resolve(process.cwd(), 'workspace')
  const repoPath = path.join(WORKSPACE, scanId)

  try {
    await db.scan.update({ where: { id: scanId }, data: { status: 'running' } })

    const coords = parseGitHubUrl(repoUrl)
    if (!coords) throw new Error('Invalid GitHub URL — expected https://github.com/owner/repo')
    const { owner, repo } = coords

    // ── DETECT ────────────────────────────────────────────────────────────────
    emit({ type: 'phase', phase: 'DETECT' })
    log('Fetching repository metadata...')

    const meta = await getRepoMeta(pat, owner, repo)
    if (meta.private) throw new Error('Private repositories are not supported in v1.0')
    if (meta.size > 500 * 1024) throw new Error('Repository exceeds 500MB size limit')

    // ── Pre-flight: can this token actually DELIVER a PR? ─────────────────────
    // Decide now (~2s of API calls) so a token that can neither push nor fork
    // fails fast with one clear instruction — instead of cloning + installing +
    // analyzing for minutes and 403'ing at submit. Autonomy is bounded by
    // granted authority (CLAUDE.md §5c): we surface the one-time setup; once the
    // token can fork, every repo is forked + PR'd with zero manual steps.
    log('Pre-flight: checking PR delivery capability...')
    const capability = await assessSubmitCapability(pat, owner, repo)
    if (capability.mode === 'blocked') {
      log('⚠ Cannot deliver a PR with the current token — stopping before analysis.')
      log(capability.reason)
      emit({ type: 'error', message: capability.reason })
      await db.scan
        .update({
          where: { id: scanId },
          data: { status: 'failed', errorMessage: capability.reason.slice(0, 1000), completedAt: new Date() },
        })
        .catch(() => {})
      return
    }
    log(
      capability.mode === 'direct'
        ? 'Pre-flight ✓ — write access confirmed; PRs push directly to the repo.'
        : 'Pre-flight ✓ — no write access; Mendel will fork into your account and open PRs from the fork (autonomous, no manual steps).',
    )

    log(`Cloning ${repoUrl}...`)
    mkdirSync(repoPath, { recursive: true })

    // Clone with PAT in URL so we can push branches later
    const authUrl = `https://${pat}@github.com/${owner}/${repo}.git`
    await cloneRepo(authUrl, repoPath)

    const monorepo = detectMonorepo(repoPath)
    if (monorepo.isMonorepo) {
      throw new Error(
        `Monorepo detected (${monorepo.indicators.join(', ')}) — not supported in v1.0`,
      )
    }

    // Capture the repo's dependency names for the 3D dep graph (real data, §15 Q3).
    try {
      const pkgRaw = readFileSync(path.join(repoPath, 'package.json'), 'utf8')
      const pkg = JSON.parse(pkgRaw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      const depNames = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].slice(0, 40)
      await db.scan.update({ where: { id: scanId }, data: { deps: JSON.stringify(depNames) } })
    } catch {
      /* non-fatal — graph falls back to a default node set */
    }

    // v1.5 W#11 (PRD F17): surface repo characteristics so the user knows
    // what kind of analysis they'll get. JS-only repos route through Tier-3
    // semantic-diff + skip Phase B typecheck — both already wired upstream,
    // but logging it here makes the trade-off visible (CLAUDE.md §5b).
    const pmDetected = detectPackageManager(repoPath)
    const isTs = hasTsConfig(repoPath)
    const tr = detectTestRunner(repoPath)
    log(
      `Repo profile — package manager: ${pmDetected} · type system: ${isTs ? 'TypeScript (tsconfig.json)' : 'JavaScript (no tsconfig — Tier-3 confidence)'} · test runner: ${tr}`,
    )

    log('Checking dependencies...')
    const staleDeps = await detectStaleDeps(repoPath, log)

    if (staleDeps.length === 0) {
      log('No significantly stale dependencies found.')
      await db.scan.update({
        where: { id: scanId },
        data: { status: 'completed', completedAt: new Date() },
      })
      emit({ type: 'done', summary: 'No stale dependencies detected.' })
      return
    }

    log(`Found ${staleDeps.length} stale dep(s): ${staleDeps.map((d) => d.name).join(', ')}`)

    // Fix #9: pre-check Docker so a missing daemon throws an actionable error
    // instead of failing cryptically deep inside ensureSandboxImage().
    try {
      await execAsync('docker info', { timeout: 5_000 })
    } catch {
      throw new Error('Docker Desktop is not running. Start Docker and re-run the scan.')
    }

    log('Preparing sandbox image...')
    await ensureSandboxImage()

    let issuesFound = 0
    let prsOpened = 0
    const tokenEstimate = { used: 0 }

    for (const dep of staleDeps.slice(0, MAX_DEPS)) {
      throwIfCancelled(scanId)
      if (tokenEstimate.used > TOKEN_CAP) {
        log(`Token cap reached (${TOKEN_CAP}) — stopping`)
        break
      }

      emit({ type: 'issue', dep: dep.name, currentVersion: dep.currentVersion, latestVersion: dep.latestVersion })
      issuesFound++

      // Emit DIAGNOSE at the TOP of each iteration. The changelog + semantic-diff
      // signal work and the diagnosis that follows are all the DIAGNOSE phase
      // (matches the S4 left-pane subtitle "parsing changelog · cross-referencing
      // usage"). Without this, these log lines inherit the PREVIOUS dep's
      // VERIFY/SUBMIT phase tag — the per-dep loop reuses phases each iteration.
      emit({ type: 'phase', phase: 'DIAGNOSE' })

      // ── Signals: changelog + semantic-diff in parallel ──────────────────────
      // v1.5 Workstream #1: semantic-diff runs alongside changelog. Both are
      // independent network-bound operations so we await Promise.all. Either
      // can fail individually without taking down the other (failures swallow
      // to empty/null — the agent never abandons a dep just because one
      // signal was unavailable).

      // Build the refIndex once per dep (cheap — in-memory AST parse of the
      // repo). PATCH later rebuilds its own; this one is for affectedSitesInRepo
      // in semantic-diff.
      let refIndexForSignal: ReturnType<typeof buildReferenceIndex> | undefined
      try {
        refIndexForSignal = buildReferenceIndex(repoPath)
      } catch (err) {
        log(`refIndex build failed (${String(err).slice(0, 80)}) — semantic-diff will report empty affectedSitesInRepo`)
      }

      log(`Fetching changelog + semantic-diff for ${dep.name}...`)
      const [breakingChanges, semanticDiff] = await Promise.all([
        parseBreakingChanges(dep.name, dep.currentVersion, dep.latestVersion, pat).catch((err) => {
          log(`changelog signal failed: ${String(err).slice(0, 120)}`)
          return [] as Awaited<ReturnType<typeof parseBreakingChanges>>
        }),
        parseSemanticDiff(dep.name, dep.currentVersion, dep.latestVersion, { refIndex: refIndexForSignal })
          .then((d: SemanticDiff): SemanticDiff | null => d)
          .catch((err: unknown): SemanticDiff | null => {
            log(`semantic-diff signal failed: ${String(err).slice(0, 120)}`)
            return null
          }),
      ])

      log(
        breakingChanges.length > 0
          ? `Changelog: ${breakingChanges.length} breaking change(s)`
          : 'Changelog: no breaking changes — proceeding with version bump',
      )
      if (semanticDiff) {
        log(
          `Semantic-diff (${semanticDiff.analysisTier}): ${semanticDiff.removedExports.length} removed, ` +
            `${semanticDiff.signatureChanges.length} signature changes, ${semanticDiff.newDeprecations.length} new @deprecated. ` +
            `${semanticDiff.affectedSitesInRepo.length} affected site(s) in repo. ` +
            `Coverage: ${semanticDiff.coveragePercent}%.`,
        )
      }
      tokenEstimate.used += 4_000

      // ── DIAGNOSE (phase already emitted at the top of this iteration) ────────
      const diagnosis = await diagnoseIssue(dep, breakingChanges, repoPath, log)
      log(`Diagnosis: ${diagnosis.summary}`)
      tokenEstimate.used += 4_000

      // ── PATCH ───────────────────────────────────────────────────────────────
      emit({ type: 'phase', phase: 'PATCH' })

      // Fix #4: trust real usage sites over LLM file-picking. The LLM only
      // sees ~20 source files in its context and routinely misses where the
      // dep is actually imported (the Antarang case shipped a version-bump-
      // only PR for exactly this reason). Augment with AST findings.
      //
      // v1.5 W#7: drop the hard 3-file cap; rank by impact (usage-count) and
      // budget by per-issue token estimate (TRD §7.2). package.json is always
      // first. AST usage files come next, ranked by how many sites they have.
      // Diagnosis-suggested files fill remaining budget.
      const rankedFiles: string[] = ['package.json']
      try {
        const refIndex = buildReferenceIndex(repoPath)
        const usageSites = findPackageUsageSites(refIndex, dep.name)
        // Rank files by usage count (most affected sites first).
        const fileImpact = new Map<string, number>()
        for (const u of usageSites) fileImpact.set(u.filePath, (fileImpact.get(u.filePath) ?? 0) + 1)
        const usageFilesRanked = [...fileImpact.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([f]) => f)
        if (usageFilesRanked.length > 0) {
          log(`AST: ${usageFilesRanked.length} file(s) actually import ${dep.name} — ranking by usage count`)
        }
        // Compose final list: package.json + AST-ranked + diagnosis suggestions,
        // dedup preserving order.
        const seen = new Set<string>(rankedFiles)
        for (const f of usageFilesRanked) { if (!seen.has(f)) { rankedFiles.push(f); seen.add(f) } }
        for (const f of diagnosis.filesToModify) { if (!seen.has(f)) { rankedFiles.push(f); seen.add(f) } }
      } catch (astErr) {
        log(`AST scan failed (${String(astErr).slice(0, 120)}) — falling back to LLM-suggested files`)
        const seen = new Set<string>(rankedFiles)
        for (const f of diagnosis.filesToModify) { if (!seen.has(f)) { rankedFiles.push(f); seen.add(f) } }
      }

      const patches = []
      let perIssueTokens = 0
      for (const filePath of rankedFiles) {
        if (perIssueTokens + PER_FILE_TOKEN_ESTIMATE > PER_ISSUE_TOKEN_BUDGET) {
          log(`Per-issue token budget (${PER_ISSUE_TOKEN_BUDGET}) reached — skipping remaining ${rankedFiles.length - patches.length - 1} file(s)`)
          break
        }
        // v1.5 W#7: smart dispatcher picks full-file vs search-replace per file
        // size (TRD §7.2), with fall-back to full-file on block-apply failure.
        const result = await patchFileSmart(repoPath, filePath, dep, breakingChanges, diagnosis, log)
        if (result.patch) patches.push(result.patch)
        // search-replace blocks are ~3× more token-efficient than full-file
        // for files > 150 lines; budget accordingly.
        const fileCost = result.strategyUsed === 'search-replace'
          ? Math.floor(PER_FILE_TOKEN_ESTIMATE / 3)
          : PER_FILE_TOKEN_ESTIMATE
        perIssueTokens += fileCost
        tokenEstimate.used += fileCost
      }

      if (patches.length === 0) {
        log('No patches generated — skipping verify and PR for this dep')
        continue
      }

      // ── VERIFY ──────────────────────────────────────────────────────────────
      emit({ type: 'phase', phase: 'VERIFY' })
      const pm = detectPackageManager(repoPath)
      const verifyScanId = `${scanId}-${depSlug(dep.name)}`

      // v1.5 W#8: build the iptables allowlist for Phase A. Tier-1 is always
      // applied; tier-2 (user-opted extra hosts) is merged + validated.
      // Rejected hosts surface as runner log lines so the user knows their
      // opt-in didn't take effect (CLAUDE.md §5b "no silent drops").
      const allowlist = buildAllowlist({ tier2: options.tier2AllowlistHosts })
      if (allowlist.tier2Accepted.length > 0) {
        log(`Sandbox allowlist: tier-1 (default) + tier-2 opt-in: ${allowlist.tier2Accepted.join(', ')}`)
      }
      for (const rej of allowlist.tier2Rejected) {
        log(`⚠ Tier-2 allowlist rejected "${rej.value}" — ${rej.reason}`)
      }

      log('Running Phase A — installing dependencies (iptables-allowlisted egress)...')
      const phaseA = await runPhaseA({
        repoPath, scanId: verifyScanId, packageManager: pm,
        allowlistHosts: allowlist.hosts,
      })
      emit({
        type: 'verify',
        phase: 'A',
        success: phaseA.success,
        output: phaseA.stdout.slice(-500),
      })

      let verificationPassed = false

      if (phaseA.success) {
        log('Running Phase B — typecheck in --network=none sandbox...')
        const vol = volumeName(verifyScanId)
        const phaseB = await runPhaseB(
          { repoPath, scanId: verifyScanId, packageManager: pm },
          vol,
        )
        emit({
          type: 'verify',
          phase: 'B',
          success: phaseB.success,
          output: phaseB.stdout.slice(-500),
        })
        verificationPassed = phaseB.typecheckPassed
        await cleanupVolume(vol)

        if (!phaseB.typecheckPassed) {
          log('⚠ TypeCheck failed — PR will open as Draft with verification warning')
        }
      } else {
        log('⚠ Phase A (install) failed — patch cannot be verified; PR submission will be skipped')
        // Surface the REAL reason. The install runs with 2>&1 so phaseA.stdout
        // carries the npm/pnpm error (e.g. ERESOLVE peer conflict). This used to
        // be captured into the 'verify' event but never shown as a log line —
        // the user was left with a bare "failed" (§5b: be honest about WHY).
        const installCause = explainInstallFailure(phaseA.stdout)
        if (installCause) log(`↳ Cause: ${installCause}`)
        const outputTail = phaseA.stdout.trim().split('\n').filter(Boolean).slice(-10).join('\n')
        if (outputTail) log(`Install output (tail):\n${outputTail}`)
      }

      // ── SUBMIT ──────────────────────────────────────────────────────────────
      // Fix #3: do NOT open a PR if Phase A install failed — the patch is
      // entirely unverified (install couldn't even run), so shipping a Draft
      // here is the dangerous case (it's how PR #17 on Antarang-Portfolio
      // landed as a bare version bump). Phase B (typecheck) failures still
      // open as draft-with-warning per the v1.0 §5b "medium confidence" intent.
      // ── SCORE (v1.5 Workstream #2) ──────────────────────────────────────────
      // Score MUST be computed BEFORE submit so the threshold gate (Workstream
      // #3) can decide standard/draft/skip. Combines signals + verification
      // into a calibrated ConfidenceScore. CLAUDE.md §5b: scoring is honest —
      // disagreement lowers the score; verification failure caps at 50.
      const confidenceScore = calculateConfidence({
        breakingChanges,
        semanticDiff,
        patchedFilePaths: patches.map((p) => p.filePath),
        verificationPassed,
      })
      log(
        `Confidence: ${confidenceScore.overall}/100 (${confidenceScore.bucket})` +
          (confidenceScore.verificationCapped ? ' — capped by verification failure' : '') +
          ` · ${confidenceScore.perBreakingChange.length} symbol${confidenceScore.perBreakingChange.length === 1 ? '' : 's'} scored · ${confidenceScore.analysisCoverage.analysisTier} coverage ${confidenceScore.analysisCoverage.percentCovered}%`,
      )

      // ── SUBMIT (Workstream #3 threshold-gated) ──────────────────────────────
      // Three outcomes:
      //   - 'standard' (≥ threshold)   → non-Draft PR
      //   - 'draft'    (40-threshold)  → Draft PR with low-confidence warning
      //   - 'skip'     (< 40)          → no PR; persist diagnosis only
      //
      // Phase-A install failure is a HARD skip regardless of score — if we
      // couldn't even install deps, the patch is unverifiable in any form
      // (this is how the bare-bump PR #17 on Antarang-Portfolio landed).
      emit({ type: 'phase', phase: 'SUBMIT' })
      let prUrl: string | undefined
      if (!phaseA.success) {
        log('⚠ Skipping PR submission — install failed, patch could not be verified at all')
      } else {
        const thresholdCfg = { threshold: options.confidenceThreshold }
        const submissionMode = chooseSubmissionMode(confidenceScore, thresholdCfg)
        log(`Threshold gate: ${explainSubmissionMode(submissionMode, confidenceScore, thresholdCfg)}`)

        if (submissionMode === 'skip') {
          log('⚠ Skipping PR submission — score below floor (40). Diagnosis persisted for review.')
        } else {
          try {
            const result = await submitDraftPR(
              repoPath,
              owner,
              repo,
              meta.defaultBranch,
              dep,
              breakingChanges,
              diagnosis,
              patches,
              verificationPassed,
              pat,
              log,
              confidenceScore,
              submissionMode,
            )

            prUrl = result.prUrl
            if (!result.skipped) {
              prsOpened++
              emit({ type: 'pr', url: result.prUrl, branch: result.branchName })
            }
          } catch (submitErr) {
            log(`PR submission failed: ${String(submitErr)}`)
          }
        }
      }

      // ── PERSIST ─────────────────────────────────────────────────────────────
      // Store the finding so permalinks + playback (S5/S6/S7) render real data.
      // persistIssueData enforces §5b: confidence framing + Not-Analyzed.
      try {
        await db.issue.create({
          data: persistIssueData({ scanId, dep, breakingChanges, diagnosis, patches, verificationPassed, prUrl, semanticDiff, confidenceScore }),
        })
      } catch (persistErr) {
        log(`Issue persist failed: ${String(persistErr)}`)
      }
    }

    // v1.5 W#6: compute calibration summary from all persisted issues for
    // this scan. Reads the issues we just wrote in the loop above. When
    // none had calibrated data (v1.0 stub-only), `confidenceSummary` stays
    // null and the dashboard renders an empty state (no fabricated zeros).
    let confidenceSummaryJson: string | null = null
    try {
      const scanIssues = await db.issue.findMany({
        where: { scanId },
        select: { confidence: true, verification: true },
      })
      const summary = summarizeScanConfidence(scanIssues)
      if (summary) {
        confidenceSummaryJson = JSON.stringify(summary)
        log(
          `Calibration summary: avg ${summary.avgScore}/100 across ${summary.issuesCalibrated}/${summary.issuesTotal} issues · ` +
            `buckets H${summary.bucketCounts.high}/M${summary.bucketCounts.medium}/L${summary.bucketCounts.low} · ` +
            `verify-fail rate ${Math.round(summary.verificationFailureRate * 100)}%`,
        )
      }
    } catch (summaryErr) {
      log(`Confidence summary computation failed: ${String(summaryErr).slice(0, 120)}`)
    }

    await db.scan.update({
      where: { id: scanId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        issuesFound,
        prsOpened,
        confidenceSummary: confidenceSummaryJson,
      },
    })

    emit({
      type: 'done',
      summary: `Scan complete. ${issuesFound} issue(s) found, ${prsOpened} PR(s) opened.`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const isCancel = message.includes('Scan cancelled')
    log(isCancel ? message : `Fatal: ${message}`)
    emit({ type: 'error', message })
    // Fix #2 (audit-1): persist the failure reason; Fix #4: distinguish cancel.
    await db.scan.update({
      where: { id: scanId },
      data: {
        status: isCancel ? 'cancelled' : 'failed',
        errorMessage: message.slice(0, 1000),
        completedAt: new Date(),
      },
    }).catch(() => {})
  } finally {
    cancelledScans.delete(scanId)
    try {
      rmSync(repoPath, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
    // Keep emitter alive 30s so any late SSE subscribers can drain
    setTimeout(() => scanEmitters.delete(scanId), 30_000)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function depSlug(name: string): string {
  return name.replace(/[@/]/g, '-').replace(/[^a-z0-9-]/gi, '').replace(/-+/g, '-')
}
