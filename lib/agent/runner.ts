import EventEmitter from 'events'
import path from 'path'
import { mkdirSync, rmSync, readFileSync } from 'fs'
import { cloneRepo, detectMonorepo, getRepoMeta } from '@/lib/github'
import { detectStaleDeps } from './phases/detect'
import { parseBreakingChanges } from './signals/changelog'
import { diagnoseIssue } from './phases/diagnose'
import { patchFile } from './patching/full-file'
import { submitDraftPR } from './phases/submit'
import {
  runPhaseA,
  runPhaseB,
  cleanupVolume,
  ensureSandboxImage,
  volumeName,
} from '@/lib/sandbox/executor'
import { detectPackageManager } from '@/lib/sandbox/detect'
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
const globalForEmitters = globalThis as unknown as { __mendelScanEmitters?: Map<string, EventEmitter> }
const scanEmitters: Map<string, EventEmitter> =
  globalForEmitters.__mendelScanEmitters ?? (globalForEmitters.__mendelScanEmitters = new Map())

export function getScanEmitter(scanId: string): EventEmitter | undefined {
  return scanEmitters.get(scanId)
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

const TOKEN_CAP = 250_000
const MAX_DEPS = 3 // max deps to process per scan

export async function runScan(scanId: string, repoUrl: string, pat: string): Promise<void> {
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
      if (tokenEstimate.used > TOKEN_CAP) {
        log(`Token cap reached (${TOKEN_CAP}) — stopping`)
        break
      }

      emit({ type: 'issue', dep: dep.name, currentVersion: dep.currentVersion, latestVersion: dep.latestVersion })
      issuesFound++

      // ── Changelog signal ────────────────────────────────────────────────────
      log(`Fetching changelog for ${dep.name}...`)
      const breakingChanges = await parseBreakingChanges(
        dep.name,
        dep.currentVersion,
        dep.latestVersion,
        pat,
      )
      log(
        breakingChanges.length > 0
          ? `Found ${breakingChanges.length} breaking change(s)`
          : 'No breaking changes in changelog — proceeding with version bump',
      )
      tokenEstimate.used += 4_000

      // ── DIAGNOSE ────────────────────────────────────────────────────────────
      emit({ type: 'phase', phase: 'DIAGNOSE' })
      const diagnosis = await diagnoseIssue(dep, breakingChanges, repoPath, log)
      log(`Diagnosis: ${diagnosis.summary}`)
      tokenEstimate.used += 4_000

      // ── PATCH ───────────────────────────────────────────────────────────────
      emit({ type: 'phase', phase: 'PATCH' })

      // Fix #4: trust real usage sites over LLM file-picking. The LLM only
      // sees ~20 source files in its context and routinely misses where the
      // dep is actually imported (the Antarang case shipped a version-bump-
      // only PR for exactly this reason). Augment with AST findings.
      let filesToModify: string[] = ['package.json']
      try {
        const refIndex = buildReferenceIndex(repoPath)
        const usageFiles = [...new Set(findPackageUsageSites(refIndex, dep.name).map((u) => u.filePath))]
        if (usageFiles.length > 0) {
          log(`AST: ${usageFiles.length} file(s) actually import ${dep.name} — patching the real usage sites`)
        }
        const merged = new Set<string>(filesToModify)
        for (const f of usageFiles) if (merged.size < 3) merged.add(f)
        for (const f of diagnosis.filesToModify) if (merged.size < 3) merged.add(f)
        filesToModify = [...merged]
      } catch (astErr) {
        log(`AST scan failed (${String(astErr).slice(0, 120)}) — falling back to LLM-suggested files`)
        filesToModify = [...new Set(['package.json', ...diagnosis.filesToModify])].slice(0, 3)
      }

      const patches = []
      for (const filePath of filesToModify) {
        const patch = await patchFile(repoPath, filePath, dep, breakingChanges, diagnosis, log)
        if (patch) patches.push(patch)
        tokenEstimate.used += 8_000
      }

      if (patches.length === 0) {
        log('No patches generated — skipping verify and PR for this dep')
        continue
      }

      // ── VERIFY ──────────────────────────────────────────────────────────────
      emit({ type: 'phase', phase: 'VERIFY' })
      const pm = detectPackageManager(repoPath)
      const verifyScanId = `${scanId}-${depSlug(dep.name)}`

      log('Running Phase A — installing dependencies...')
      const phaseA = await runPhaseA({ repoPath, scanId: verifyScanId, packageManager: pm })
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
        log('⚠ Phase A failed — PR will open without verification results')
      }

      // ── SUBMIT ──────────────────────────────────────────────────────────────
      // Fix #3: do NOT open a PR if Phase A install failed — the patch is
      // entirely unverified (install couldn't even run), so shipping a Draft
      // here is the dangerous case (it's how PR #17 on Antarang-Portfolio
      // landed as a bare version bump). Phase B (typecheck) failures still
      // open as draft-with-warning per the v1.0 §5b "medium confidence" intent.
      emit({ type: 'phase', phase: 'SUBMIT' })
      let prUrl: string | undefined
      if (!phaseA.success) {
        log('⚠ Skipping PR submission — install failed, patch could not be verified at all')
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

      // ── PERSIST ─────────────────────────────────────────────────────────────
      // Store the finding so permalinks + playback (S5/S6/S7) render real data.
      // persistIssueData enforces §5b: medium confidence + Not-Analyzed disclosures.
      try {
        await db.issue.create({
          data: persistIssueData({ scanId, dep, breakingChanges, diagnosis, patches, verificationPassed, prUrl }),
        })
      } catch (persistErr) {
        log(`Issue persist failed: ${String(persistErr)}`)
      }
    }

    await db.scan.update({
      where: { id: scanId },
      data: { status: 'completed', completedAt: new Date(), issuesFound, prsOpened },
    })

    emit({
      type: 'done',
      summary: `Scan complete. ${issuesFound} issue(s) found, ${prsOpened} PR(s) opened.`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`Fatal: ${message}`)
    emit({ type: 'error', message })
    // Fix #2: persist the failure reason so post-hoc debugging works (was SSE-only).
    await db.scan.update({
      where: { id: scanId },
      data: { status: 'failed', errorMessage: message.slice(0, 1000), completedAt: new Date() },
    }).catch(() => {})
  } finally {
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
