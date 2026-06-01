import EventEmitter from 'events'
import path from 'path'
import { mkdirSync, rmSync, readFileSync } from 'fs'
import simpleGit from 'simple-git'
import { cloneRepo, getRepoMeta, assessSubmitCapability, listOpenIssues } from '@/lib/github'
import { detectWorkspace, type PackageRef, type WorkspaceDetection } from './workspace/detect'
import { selectAdapter } from './lang/registry'
import { pickIssueForDep, formatIssueReference } from './issue-link'
import type { RepoIssue } from '@/lib/github/types'
// v2.2 / F23a — `detectStaleDeps` is routed via `adapter.detectStaleDeps`
// (TS = pure delegation; Python = PyPI walker). The value import is gone;
// the type-only re-import below remains for the StalePackageDep alias.
import type { detectStaleDeps } from './phases/detect'
import { parseBreakingChanges } from './signals/changelog'
// v2.2 / F23a — `parseSemanticDiff` is now routed via `adapter.semanticDiff`
// (TS = pure delegation; Python = griffe-in-Docker). Type import stays.
import type { SemanticDiff } from './signals/semantic-diff'
import { calculateConfidence } from './confidence/score'
import { chooseSubmissionMode, explainSubmissionMode, resolveThreshold } from './confidence/threshold'
import { summarizeScanConfidence } from './confidence/summary'
import { buildAllowlist } from '@/lib/sandbox/iptables-allowlist'
import { diagnoseIssue } from './phases/diagnose'
import { patchFileSmart } from './patching'
import { submitDraftPR } from './phases/submit'
import { assessContributionEligibility, gateSubmission, type EligibilityVerdict } from './eligibility'
import { runAutoMergeFor } from './automerge/runner-glue'
// v2.0: the runner no longer imports executor functions directly — it goes
// through the SandboxProvider interface (cloud-readiness, V2_PLAN §F19
// supporting work). volumeName is a pure helper, kept as a static import.
import { volumeName } from '@/lib/sandbox/executor'
import { getSandboxProvider } from '@/lib/sandbox/provider'
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
  | { type: 'verify'; phase: 'A' | 'B' | 'C'; success: boolean; output: string }
  // `merged` is set ONLY when the §5c auto-merge gate fires and the merge
  // call succeeds (v2.3 / F24). The SSE consumer renders a different chip
  // in that case (e.g. green "auto-merged" badge).
  | { type: 'pr'; url: string; branch: string; merged?: boolean }
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
  /**
   * 2026-05-29 — Contribution Eligibility Gate (CLAUDE.md §5c). For a repo the
   * user does NOT own, Mendel opens a PR only if the user explicitly confirms
   * the repo welcomes dependency PRs (they've read its CONTRIBUTING + CoC).
   * Default false → non-owned repos are analyzed but get NO PR (report only).
   * Owned repos ignore this. Hard-blocked repos (Dependabot/Renovate present,
   * or a CONTRIBUTING "no dependency PRs" policy) get no PR regardless.
   */
  externalContributionAck?: boolean
  /**
   * v2.0 / F20 — Phase C (smoke) opt-in. When `true`, after Phase B passes
   * the runner attempts to BOOT the patched app and captures whether it came
   * up. Result feeds the confidence cap (smoke failure → cap at 50). When
   * `false`/omitted → no smoke, behavior identical to v1.5.
   */
  smokeTest?: boolean
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

    // Capture the clean base commit so each dependency can be patched/verified/
    // PR'd in ISOLATION from it (PR-hygiene fix). Without this, deps are patched
    // sequentially in one working tree, so each PR branch leaks the previous
    // deps' changes (PR #1237 on execa carried ava+c8+is-in-ci) AND each verify
    // runs against the prior deps' (possibly broken) changes — inflating diffs
    // and false Phase-B failures.
    const git = simpleGit(repoPath)
    const baseSha = (await git.revparse(['HEAD'])).trim()

    // v2.1 / F21 — workspace detection + member-package enumeration. v1.x
    // rejected monorepos here; v2.1 enumerates them and scans each member.
    // Single-package = N=1 special case (no branching) per V2_PLAN.md §F21.
    const workspace: WorkspaceDetection = detectWorkspace(repoPath)
    if (workspace.kind !== 'single') {
      log(
        `Workspace detected (${workspace.kind}) — ${workspace.packages.length} member package(s) [${workspace.indicators.join(', ')}]`,
      )
      for (const u of workspace.unresolvedPatterns) {
        log(`(workspace) unresolved pattern "${u.pattern}" — ${u.reason}`)
      }
    }
    // v2.2 / F23 core — select the language adapter for this repo. Today
    // the registry only has TypeScript registered, so a non-JS/TS repo
    // (Python, Go, Rust) will return null until F23a/b/c add their adapters.
    // We FAIL THE SCAN honestly when no adapter matches — refusing to
    // silently default to TS on a repo we can't analyze (§5b).
    const adapter = selectAdapter(repoPath)
    if (!adapter) {
      const msg = `No language adapter available for this repo — Mendel currently supports TypeScript/JavaScript. Python, Go, and Rust are planned in v2.2.x.`
      log(`⚠ ${msg}`)
      emit({ type: 'error', message: msg })
      await db.scan
        .update({ where: { id: scanId }, data: { status: 'failed', errorMessage: msg, completedAt: new Date() } })
        .catch(() => {})
      return
    }
    log(`Language: ${adapter.displayName} (max bucket: ${adapter.maxBucket})`)

    // v2.2 / F23a — adapter pre-flight (Python builds its sandbox image
    // here so a Docker-down failure surfaces ONCE, at the top of the scan,
    // instead of as an opaque "semantic-diff failed" deep in the per-dep
    // loop. Idempotent for every adapter; TS adapter has no preflight.
    if (adapter.preflight) {
      try {
        log(`Pre-flight: building ${adapter.sandboxImage} if needed (one-time, ~60s on first run)...`)
        await adapter.preflight()
        log(`Pre-flight OK`)
      } catch (err) {
        const msg = `Adapter pre-flight failed: ${err instanceof Error ? err.message : String(err)}`
        log(`⚠ ${msg}`)
        emit({ type: 'error', message: msg })
        await db.scan
          .update({ where: { id: scanId }, data: { status: 'failed', errorMessage: msg, completedAt: new Date() } })
          .catch(() => {})
        return
      }
    }

    await db.scan.update({
      where: { id: scanId },
      data: {
        workspaceKind: workspace.kind === 'single' ? null : workspace.kind,
        language: adapter.id,
      },
    })

    // Compute per-package depsCount for ranking + the 3D dep graph. The graph
    // shows the UNION across packages so single-package behavior is unchanged.
    const allDepNames: string[] = []
    const packageDepCount = new Map<string, number>()
    for (const pkg of workspace.packages) {
      try {
        const pkgPath = path.join(repoPath, pkg.manifestPath)
        const raw = readFileSync(pkgPath, 'utf8')
        const parsed = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
        const names = [
          ...Object.keys(parsed.dependencies ?? {}),
          ...Object.keys(parsed.devDependencies ?? {}),
          ...Object.keys(parsed.peerDependencies ?? {}),
        ]
        packageDepCount.set(pkg.dir, names.length)
        for (const n of names) if (!allDepNames.includes(n)) allDepNames.push(n)
      } catch {
        packageDepCount.set(pkg.dir, 0)
      }
    }
    try {
      await db.scan.update({ where: { id: scanId }, data: { deps: JSON.stringify(allDepNames.slice(0, 40)) } })
    } catch { /* non-fatal — graph falls back to a default node set */ }

    // Persist ScanPackage rows up-front. issuesFound is updated as the per-dep
    // loop assigns issues to each package; scanned/skipReason set later if a
    // package is skipped under budget (§5b — never silently drop).
    for (const pkg of workspace.packages) {
      try {
        await db.scanPackage.create({
          data: {
            scanId,
            name: pkg.name,
            dir: pkg.dir,
            manifestPath: pkg.manifestPath,
            depsCount: packageDepCount.get(pkg.dir) ?? 0,
            issuesFound: 0,
            scanned: true,
          },
        })
      } catch (persistErr) {
        log(`(workspace) failed to persist ScanPackage ${pkg.name}: ${String(persistErr).slice(0, 120)}`)
      }
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

    // ── Contribution-eligibility gate (CLAUDE.md §5c, honesty-of-action) ──────
    // Respect the repo's norms + don't spam maintainers. "Owned" = we can push
    // (capability.mode === 'direct'). Non-owned repos are analyzed but only get
    // a PR if the user acknowledged it welcomes them AND the change clears a high
    // bar (gated per-issue at submit). Hard-blocked if the repo already automates
    // deps or its CONTRIBUTING discourages drive-by dependency PRs.
    const ownsRepo = capability.mode === 'direct'
    const eligibility: EligibilityVerdict = assessContributionEligibility(repoPath, {
      ownsRepo,
      externalAck: options.externalContributionAck ?? false,
    })
    log(`Contribution check: ${eligibility.decision.toUpperCase()} — ${eligibility.reason}`)
    if (!ownsRepo && !eligibility.canOpenPRs) {
      log('↳ This scan runs as REPORT-ONLY — diagnosis will be persisted, no PR will be opened.')
    }

    // §5c.2 — fetch the repo's OPEN issues so a PR can link the maintainer's
    // existing request (e.g. a "dependencies" good-first-issue). Read-only;
    // best-effort (failure → PRs simply open without a link). Mendel never
    // CREATES issues on repos it doesn't own — it links existing consent only.
    let openIssues: RepoIssue[] = []
    try {
      openIssues = await listOpenIssues(pat, owner, repo)
    } catch (issueErr) {
      log(`(issue-link) could not list issues (${String(issueErr).slice(0, 80)}) — PRs will open without an issue link`)
    }

    log('Checking dependencies...')

    // v2.1 / F21 — detect stale deps PER package. For single-package
    // (workspace.packages.length === 1, dir === '.') this is identical to
    // v1.5 behavior — one call against the root. For monorepos, each member
    // package gets its own staleness check; results are merged into a single
    // queue tagged with the originating package.
    type StalePackageDep = { pkg: PackageRef; dep: Awaited<ReturnType<typeof detectStaleDeps>>['stale'][number] }
    const stalePackageDeps: StalePackageDep[] = []
    let totalChecked = 0
    let totalFailed = 0
    // Rank packages: most-stale first (depsCount as a cheap proxy for
    // staleness probability — actual stale count fills in after the loop).
    const rankedPackages = [...workspace.packages].sort(
      (a, b) => (packageDepCount.get(b.dir) ?? 0) - (packageDepCount.get(a.dir) ?? 0),
    )
    for (const pkg of rankedPackages) {
      const pkgRoot = path.join(repoPath, pkg.dir)
      const prefix = pkg.dir === '.' ? '' : `[${pkg.name}] `
      // v2.2 / F23a — route through the adapter. TS = pure delegation
      // (byte-identical to pre-F23 behavior); Python uses PyPI + griffe;
      // Go/Rust will plug in here without any runner-side change.
      const { stale, checked, failed } = await adapter.detectStaleDeps(
        pkgRoot,
        (msg) => log(`${prefix}${msg}`),
      )
      totalChecked += checked
      totalFailed += failed
      for (const dep of stale) stalePackageDeps.push({ pkg, dep })
    }

    // Honesty (§5b): if NO dep could be checked across ALL packages (every
    // npm lookup failed — typically rate-limiting after many scans), this
    // is a FAILURE, not a clean "nothing stale".
    if (stalePackageDeps.length === 0 && totalChecked === 0 && totalFailed > 0) {
      const msg = `Couldn't check dependency staleness — all ${totalFailed} npm registry lookups failed (likely rate limit). Re-run in a minute.`
      log(`⚠ ${msg}`)
      emit({ type: 'error', message: msg })
      await db.scan
        .update({ where: { id: scanId }, data: { status: 'failed', errorMessage: msg, completedAt: new Date() } })
        .catch(() => {})
      return
    }

    // Legacy aliases the existing code below still expects. `staleDeps` is
    // the FLAT list of deps without package context (used to count); the
    // outer loop below uses `stalePackageDeps` so each dep carries its
    // package. `failed`/`checked` keep their v1.5 meanings (scan-totals).
    const staleDeps = stalePackageDeps.map((s) => s.dep)
    const failed = totalFailed

    if (staleDeps.length === 0) {
      log(
        failed > 0
          ? `No stale deps among the ${totalChecked} checked — but ${failed} couldn't be checked, so this is incomplete; re-run shortly.`
          : 'No significantly stale dependencies found.',
      )
      await db.scan.update({
        where: { id: scanId },
        data: { status: 'completed', completedAt: new Date() },
      })
      emit({ type: 'done', summary: failed > 0 ? `No stale deps among ${totalChecked} checked (${failed} unchecked).` : 'No stale dependencies detected.' })
      return
    }

    log(`Found ${staleDeps.length} stale dep(s): ${staleDeps.map((d) => d.name).join(', ')}${failed > 0 ? ` (${failed} unchecked — rate limit)` : ''}`)

    // Fix #9: pre-check Docker so a missing daemon throws an actionable error
    // instead of failing cryptically deep inside ensureSandboxImage().
    try {
      await execAsync('docker info', { timeout: 5_000 })
    } catch {
      throw new Error('Docker Desktop is not running. Start Docker and re-run the scan.')
    }

    // v2.0: route every sandbox call through the provider. Today
    // LocalDockerProvider wraps the same executor functions — zero behavior
    // change — but the seam is what lets v3 swap in a hosted backend.
    const sandbox = getSandboxProvider()

    log('Preparing sandbox image...')
    await sandbox.ensureReady()

    // Sandbox-readiness pre-flight (2026-05-29). Verify the image can actually
    // run THIS repo's package manager (+ git/node) BEFORE the per-dep loop —
    // so a tooling gap (e.g. a yarn repo on an image without yarn) fails fast
    // in ~2s with a clear message, instead of failing Phase A per-dep after
    // minutes of wasted analysis (the ta-vivo case). Answers "why did the
    // pre-flight let analysis proceed?" — the earlier pre-flight only checked
    // PR-DELIVERY capability; this checks VERIFICATION capability.
    const readiness = await sandbox.checkReadiness(pmDetected)
    if (!readiness.ok) {
      log(`⚠ Sandbox not ready for this repo — stopping before analysis.`)
      log(readiness.reason)
      emit({ type: 'error', message: readiness.reason })
      await db.scan
        .update({
          where: { id: scanId },
          data: { status: 'failed', errorMessage: readiness.reason.slice(0, 1000), completedAt: new Date() },
        })
        .catch(() => {})
      return
    }
    log(`Sandbox ready ✓ (${pmDetected} · git · node available)`)

    let issuesFound = 0
    let prsOpened = 0
    const tokenEstimate = { used: 0 }

    // v2.1 / F21 — track which packages contributed which issues so we can
    // update ScanPackage.issuesFound after the loop, and per-package skip
    // tallies for budget honesty (§5b — no silent drops).
    const scannedPackageDirs = new Set<string>()
    const issuesPerPackageDir = new Map<string, number>()
    const skippedDepsPerPackageDir = new Map<string, number>()

    for (const { pkg: currentPackage, dep } of stalePackageDeps.slice(0, MAX_DEPS)) {
      throwIfCancelled(scanId)
      // Workspace-relative root for THIS dep's package. For single-package
      // (dir === '.') this equals repoPath, so single-package behavior is
      // exactly v1.5.
      const pkgRoot = path.join(repoPath, currentPackage.dir)
      scannedPackageDirs.add(currentPackage.dir)
      if (tokenEstimate.used > TOKEN_CAP) {
        log(`Token cap reached (${TOKEN_CAP}) — stopping`)
        skippedDepsPerPackageDir.set(
          currentPackage.dir,
          (skippedDepsPerPackageDir.get(currentPackage.dir) ?? 0) + 1,
        )
        break
      }

      // ISOLATION (PR-hygiene fix): reset the working tree to the clean base
      // before each dep so this dep's patch, verification, AND PR contain ONLY
      // its own change — never the previous deps'. Detached checkout of baseSha
      // + clean of untracked (gitignored files like node_modules are preserved).
      try {
        await git.raw(['checkout', '-f', baseSha])
        await git.raw(['clean', '-fd'])
      } catch (resetErr) {
        log(`(isolation) working-tree reset to base failed: ${String(resetErr).slice(0, 120)}`)
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
        // v2.1 / F21 — scope the AST index to THIS package, not the
        // workspace root. For single-package this is identical to v1.5.
        refIndexForSignal = buildReferenceIndex(pkgRoot)
      } catch (err) {
        log(`refIndex build failed (${String(err).slice(0, 80)}) — semantic-diff will report empty affectedSitesInRepo`)
      }

      log(`Fetching changelog + semantic-diff for ${dep.name}...`)
      // v2.2 / F23a — semantic-diff routed through the adapter so Python
      // hits griffe-in-Docker, TS hits parseSemanticDiff (delegation).
      // Changelog adapter override is optional; the default GitHub
      // release-notes walker is already language-agnostic.
      const parseBreakingChangesFn = adapter.parseBreakingChanges ?? parseBreakingChanges
      const [breakingChanges, semanticDiff] = await Promise.all([
        parseBreakingChangesFn(dep.name, dep.currentVersion, dep.latestVersion, pat).catch((err) => {
          log(`changelog signal failed: ${String(err).slice(0, 120)}`)
          return [] as Awaited<ReturnType<typeof parseBreakingChanges>>
        }),
        adapter.semanticDiff(dep.name, dep.currentVersion, dep.latestVersion, { refIndex: refIndexForSignal })
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
        // v2.1 / F21 — AST index scoped to THIS package's dir, so only the
        // member's own source files are ranked + patched. Cross-package
        // shared usage (the workspace's own internal links) is out of scope
        // for v2.1.0 — we patch each package's local sources independently.
        const refIndex = buildReferenceIndex(pkgRoot)
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
        // v2.1 / F21 — patches resolve filePath relative to THIS package's
        // root (so patches land in e.g. packages/ui/src/X.ts, not the
        // workspace root's src/X.ts). Single-package keeps using repoPath
        // because dir === '.'.
        const result = await patchFileSmart(pkgRoot, filePath, dep, breakingChanges, diagnosis, log)
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
      const phaseA = await sandbox.runInstall({
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
      // v2.0 / F20 — Phase C smoke outcome. `null` = not attempted (legacy
      // path or smoke disabled). `true`/`false` = smoke ran with a verdict.
      // calculateConfidence honors `null` by NOT applying the smoke cap —
      // existing scans behave identically to v1.5.
      let smokePassed: boolean | null = null
      // v2.0 fix (2026-05-31, gap caught auditing cmptwjea2…): hoist phaseB
      // outside the if-block so the persist step below can store its stdout
      // when Phase B fails. Previously the verification blob's `output` was
      // empty on Phase B failures → user had no way to see what typecheck
      // broke. Closes the same §11c class as the Phase A capture did.
      let phaseBStdout: string | null = null
      let phaseBStderr: string | null = null

      if (phaseA.success) {
        log('Running Phase B — typecheck in --network=none sandbox...')
        const vol = volumeName(verifyScanId)
        const phaseB = await sandbox.runTest(
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
        phaseBStdout = phaseB.stdout ?? ''
        phaseBStderr = phaseB.stderr ?? ''

        // v2.0 / F20 — Phase C runs ONLY when Phase B passed (no point booting
        // a patch we know fails typecheck) AND smoke is enabled in opts. The
        // post-Phase-A install volume is still valid; we reuse it before
        // teardown. Phase C runs --network=none (CLAUDE.md §5 rule 16) — if
        // an app can't boot offline, we report it honestly, not by opening
        // the network.
        if (verificationPassed && options.smokeTest) {
          log('Running Phase C — smoke-test (boot patched app, --network=none)...')
          const phaseC = await sandbox.runSmoke(
            { repoPath, scanId: verifyScanId, packageManager: pm, smokeTest: { enabled: true } },
            vol,
          )
          emit({
            type: 'verify',
            phase: 'C',
            success: phaseC.booted,
            output: phaseC.logTail.slice(-500),
          })
          if (phaseC.attempted) {
            smokePassed = phaseC.booted
            log(
              `Phase C ${phaseC.booted ? '✓ booted' : '✕ did not boot'} — ${phaseC.reason}` +
                (phaseC.command ? ` (cmd: ${phaseC.command})` : ''),
            )
          } else {
            // attempted=false → not a cap, not a pass. UI shows amber.
            log(`Phase C skipped — ${phaseC.reason}`)
          }
        }

        await sandbox.teardown(vol)

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
        smokePassed,
        // v2.2 / F23a — language-aware ceiling (CLAUDE.md §5b v2 r1). The
        // scorer clamps both bucket + numeric score to the adapter's
        // declared max. No-op for TS (maxBucket='high'); binding for rust.
        maxBucket: adapter.maxBucket,
      })
      // v2.0 / F20 — surface both possible caps. Either alone or together is
      // honest; calculateConfidence already enforces the cap math.
      const capNotes: string[] = []
      if (confidenceScore.verificationCapped) capNotes.push('capped by verification failure')
      if (confidenceScore.smokeCapped) capNotes.push('capped by smoke (boot) failure')
      log(
        `Confidence: ${confidenceScore.overall}/100 (${confidenceScore.bucket})` +
          (capNotes.length > 0 ? ` — ${capNotes.join(' + ')}` : '') +
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

        // Contribution-eligibility gate (CLAUDE.md §5c): combines the threshold
        // result with the repo's contribution norms. Owned repos behave as
        // before; non-owned repos need acknowledgement AND a high bar; blocked
        // repos never get a PR.
        const gate = gateSubmission({ eligibility, submissionMode, verificationPassed })
        if (!gate.allow) {
          log(`⚠ Skipping PR submission — ${gate.reason}`)
        } else {
          // §5c.2 — link the PR to an existing maintainer-opened issue if one
          // matches (consent already exists). Owned → "Closes"; external → "Addresses".
          const linkedIssue = pickIssueForDep(openIssues, dep.name)
          const issueReference = linkedIssue ? formatIssueReference(linkedIssue, ownsRepo) : undefined
          if (linkedIssue) log(`Linking PR to existing issue #${linkedIssue.number}: ${linkedIssue.title}`)
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
              issueReference,
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
        // Capture the output of the phase that FAILED so the verification
        // blob carries the actual cause (closes the §11c "show the user what
        // broke" gap). Concat stdout + stderr because Phase A runs with 2>&1;
        // some exit paths populate one and not the other.
        // Priority: Phase A failure → its output. Phase A ok + Phase B fail
        // → Phase B output (this is what was empty in scan cmptwjea2…). Both
        // ok → no output needed.
        let phaseAOutput: string | undefined
        if (!phaseA.success) {
          phaseAOutput = `${phaseA.stdout ?? ''}\n${phaseA.stderr ?? ''}`.trim()
        } else if (!verificationPassed && (phaseBStdout || phaseBStderr)) {
          phaseAOutput = `${phaseBStdout ?? ''}\n${phaseBStderr ?? ''}`.trim()
        }
        const createdIssue = await db.issue.create({
          data: persistIssueData({ scanId, dep, breakingChanges, diagnosis, patches, verificationPassed, prUrl, semanticDiff, confidenceScore, phaseAOutput, packageDir: currentPackage.dir, language: adapter.id }),
        })

        // ── AUTO-MERGE GATE (v2.3 / F24) ──────────────────────────────────
        // Run the §5c "Honesty-of-Action floor" against this issue. The
        // pure policy + glue both write to AgentLog (every reason logged,
        // even on skip). Default-OFF at the RepoSetting schema layer
        // means this is a no-op for repos that never opted in — the
        // policy returns 'skipped' + r1 immediately.
        //
        // Failures here NEVER cascade into the runner — auto-merge is an
        // additive behavior, so a crash in the gate (DB hiccup, octokit
        // error, etc.) is logged honestly and we continue with the next
        // dep. The PR itself remains open in its original state.
        if (prUrl) {
          const prNumberMatch = prUrl.match(/\/pull\/(\d+)/)
          const prNumber = prNumberMatch ? Number(prNumberMatch[1]) : null
          if (prNumber !== null) {
            try {
              const depChangeType = breakingChanges[0]?.changeType ?? 'version-bump'
              const result = await runAutoMergeFor(
                {
                  scanId,
                  issueId: createdIssue.id,
                  repoFullName: `${owner}/${repo}`,
                  prNumber,
                  prUrl,
                  depName: dep.name,
                  depChangeType,
                  fromVersion: dep.currentVersion,
                  toVersion: dep.latestVersion,
                  breakingChanges,
                  semanticDiff,
                  confidence: confidenceScore,
                  verificationPassed,
                  smokePassed,
                  threshold: resolveThreshold({ threshold: options.confidenceThreshold }),
                  // capability.mode === 'direct' means push access on
                  // upstream — the same permission tier required to merge
                  // (per the GitHub permissions model). Fork-based PRs
                  // can't be merged by the bot.
                  patHasMergeRights: capability.mode === 'direct',
                },
                db,
                pat,
              )
              if (result.outcome.verdict === 'merged') {
                log(`Auto-merged ${dep.name} ${dep.currentVersion} → ${dep.latestVersion} (${result.outcome.mergedCommitSha?.slice(0, 7)})`)
                emit({ type: 'pr', url: prUrl, branch: '', merged: true })
              } else if (result.outcome.verdict === 'failed') {
                log(`Auto-merge attempt failed: ${result.outcome.reasons[0]}`)
              } else {
                // Skipped: log a single-line summary; the full reasons live
                // in AgentLog + Issue.autoMerge for an audit.
                log(`Auto-merge skipped (${result.outcome.reasons.length} §5c reason(s); see AgentLog)`)
              }
            } catch (autoMergeErr) {
              log(`Auto-merge gate errored (non-fatal): ${String(autoMergeErr).slice(0, 160)}`)
            }
          }
        }

        // v2.1 / F21 — bump the in-memory per-package counter; persisted to
        // ScanPackage.issuesFound after the loop so we make one update per
        // package instead of one per issue.
        issuesPerPackageDir.set(
          currentPackage.dir,
          (issuesPerPackageDir.get(currentPackage.dir) ?? 0) + 1,
        )
      } catch (persistErr) {
        log(`Issue persist failed: ${String(persistErr)}`)
      }
    }

    // v2.1 / F21 — write per-package issue counts + honest skip reasons.
    // Packages we never even reached (queue truncated by MAX_DEPS) are
    // marked unscanned with reason='budget' so "Not Analyzed" can name them.
    for (const pkg of workspace.packages) {
      const issuesFound = issuesPerPackageDir.get(pkg.dir) ?? 0
      const skippedDeps = skippedDepsPerPackageDir.get(pkg.dir) ?? 0
      const wasScanned = scannedPackageDirs.has(pkg.dir)
      let skipReason: string | null = null
      if (!wasScanned) {
        skipReason = 'budget — global MAX_DEPS reached before this package was reached'
      } else if (skippedDeps > 0) {
        skipReason = `budget — ${skippedDeps} dep(s) skipped under TOKEN_CAP/MAX_DEPS`
      }
      try {
        await db.scanPackage.updateMany({
          where: { scanId, dir: pkg.dir },
          data: { issuesFound, scanned: wasScanned, skipReason },
        })
      } catch (persistErr) {
        log(`(workspace) failed to update ScanPackage ${pkg.name}: ${String(persistErr).slice(0, 120)}`)
      }
    }
    // Surface a workspace-wide "Not Analyzed" line for budget skips so the
    // dashboard / scan view can render an honest, never-silent message.
    const unscannedPackageNames = workspace.packages
      .filter((pkg) => !scannedPackageDirs.has(pkg.dir))
      .map((pkg) => pkg.name)
    if (unscannedPackageNames.length > 0) {
      log(
        `⚠ packages not analyzed (budget): ${unscannedPackageNames.join(', ')} — re-scan to cover them`,
      )
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
