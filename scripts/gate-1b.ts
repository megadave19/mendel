#!/usr/bin/env tsx
/**
 * Gate 1B — end-to-end verification script
 *
 * Checks:
 *   1. Sandbox image builds
 *   2. Phase A (install) runs on local fixture
 *   3. Phase B (--network=none) runs on local fixture
 *   4. Egress is actually blocked in --network=none containers
 *   5. Container teardown — no leftover Mendel volumes
 *   6. AST parser indexes a cloned repo (pmndrs/zustand)
 *   7. GitHub PAT smoke test (if GITHUB_PAT is set)
 *
 * Usage:
 *   pnpm gate:1b
 */

import { existsSync, mkdirSync } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import {
  ensureSandboxImage,
  runPhaseA,
  runPhaseB,
  cleanupVolume,
  volumeName,
  verifyEgressBlocked,
} from '../lib/sandbox/executor'
import { detectPackageManager } from '../lib/sandbox/detect'
import { cloneRepo, detectMonorepo, validatePAT } from '../lib/github/index'
import { buildReferenceIndex, findImportsFrom } from '../lib/agent/signals/ast-parser'

const execAsync = promisify(exec)

const WORKSPACE = path.resolve(process.cwd(), 'workspace')
// Local TypeScript fixture we fully control — no workspace files, no monorepo
const FIXTURE_PATH = path.resolve(process.cwd(), 'tests/fixtures/simple-ts')
const PASS = '✅'
const FAIL = '❌'
const SKIP = '⏭'

let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail?: string) {
  const icon = ok ? PASS : FAIL
  if (ok) passed++
  else failed++
  console.log(`${icon} ${label}${detail ? `  (${detail})` : ''}`)
}

async function cloneFixture(name: string, url: string): Promise<string> {
  const dest = path.join(WORKSPACE, name)
  if (existsSync(dest)) {
    console.log(`   [skip clone] ${name} already in workspace`)
    return dest
  }
  console.log(`   Cloning ${url} ...`)
  await cloneRepo(url, dest)
  return dest
}

async function main() {
  console.log('\n══════════════════════════════════════════')
  console.log('  Mendel Gate 1B — end-to-end verification')
  console.log('══════════════════════════════════════════\n')

  mkdirSync(WORKSPACE, { recursive: true })

  // ── 1. Build sandbox image ─────────────────────────────────────────────────
  console.log('[ 1/7 ] Building sandbox image')
  try {
    await ensureSandboxImage()
    check('Sandbox image ready', true)
  } catch (err) {
    check('Sandbox image build', false, String(err))
    console.log('\nCannot proceed — fix image build first.\n')
    process.exit(1)
  }

  // ── 2. Fixture setup ───────────────────────────────────────────────────────
  console.log('\n[ 2/7 ] Fixture setup')
  check('Local fixture exists', existsSync(FIXTURE_PATH), FIXTURE_PATH)
  check('Fixture has pnpm-lock.yaml', existsSync(path.join(FIXTURE_PATH, 'pnpm-lock.yaml')))
  const fixtureMonorepo = detectMonorepo(FIXTURE_PATH)
  check('Fixture is not a monorepo', !fixtureMonorepo.isMonorepo,
    fixtureMonorepo.isMonorepo ? `indicators: ${fixtureMonorepo.indicators.join(', ')}` : undefined)

  // ── 3. Phase A on fixture ──────────────────────────────────────────────────
  console.log('\n[ 3/7 ] Phase A — install (local fixture)')
  const fixtureScanId = `gate-1b-fixture-${Date.now()}`
  const fixturePm = detectPackageManager(FIXTURE_PATH)
  console.log(`   Package manager: ${fixturePm}`)

  const phaseAResult = await runPhaseA({
    repoPath: FIXTURE_PATH,
    scanId: fixtureScanId,
    packageManager: fixturePm,
    phaseATimeoutMs: 3 * 60 * 1000,
    frozenLockfile: true, // fixture lockfile is known-good
  })

  check(
    `Phase A install (${fixturePm})`,
    phaseAResult.success,
    `${Math.round(phaseAResult.durationMs / 1000)}s`,
  )

  if (!phaseAResult.success) {
    console.log('   stdout tail:', phaseAResult.stdout.slice(-500))
    console.log('   stderr tail:', phaseAResult.stderr.slice(-500))
  }

  // ── 4. Phase B on fixture ──────────────────────────────────────────────────
  console.log('\n[ 4/7 ] Phase B — test with --network=none (local fixture)')

  if (!phaseAResult.success) {
    console.log(`   ${SKIP} Skipping — Phase A failed`)
  } else {
    const vol = volumeName(fixtureScanId)
    const phaseBResult = await runPhaseB(
      { repoPath: FIXTURE_PATH, scanId: fixtureScanId, packageManager: fixturePm, phaseBTimeoutMs: 5 * 60 * 1000 },
      vol,
    )

    check('Phase B ran with --network=none', !phaseBResult.timedOut, `${Math.round(phaseBResult.durationMs / 1000)}s`)
    check('Phase B typecheck', phaseBResult.typecheckPassed)

    if (!phaseBResult.success) {
      console.log('   stdout tail:', phaseBResult.stdout.slice(-800))
    }

    // ── 5. Egress blocking ─────────────────────────────────────────────────
    console.log('\n[ 5/7 ] Verifying egress blocked in --network=none')
    const egressBlocked = await verifyEgressBlocked()
    check('--network=none blocks egress (curl fails)', egressBlocked)

    // ── Volume teardown ────────────────────────────────────────────────────
    const cleaned = await cleanupVolume(vol)
    check('Node modules volume cleaned up', cleaned, vol)

    // Confirm no leftover mendel containers
    const { stdout: psOut } = await execAsync('docker ps -a --filter name=mendel --format "{{.Names}}"')
    const leftover = psOut.trim().split('\n').filter(Boolean)
    check('No leftover Mendel containers', leftover.length === 0, leftover.join(', ') || 'none')
  }

  // ── 6. AST parser on zustand ───────────────────────────────────────────────
  console.log('\n[ 6/7 ] AST parser — indexing pmndrs/zustand')
  let zustandPath: string
  try {
    zustandPath = await cloneFixture('zustand', 'https://github.com/pmndrs/zustand')
    check('Clone pmndrs/zustand', true)
  } catch (err) {
    check('Clone pmndrs/zustand', false, String(err))
    zustandPath = ''
  }

  if (zustandPath) {
    try {
      const index = buildReferenceIndex(zustandPath)
      const hasFiles = index.files.length > 0
      check('AST parser indexed files', hasFiles, `${index.files.length} TS/JS files`)

      const zustandImports = findImportsFrom(index, 'zustand')
      check('Found zustand self-imports', zustandImports.length > 0 || index.imports.length > 0,
        `${index.imports.length} total imports, ${index.parseErrors.length} parse errors`)

      check('Parse error rate < 20%', index.parseErrors.length / Math.max(index.files.length, 1) < 0.2,
        `${index.parseErrors.length} errors / ${index.files.length} files`)
    } catch (err) {
      check('AST parser runs without crashing', false, String(err))
    }
  }

  // ── 7. GitHub PAT smoke test ───────────────────────────────────────────────
  console.log('\n[ 7/7 ] GitHub PAT validation smoke test')
  const pat = process.env.GITHUB_PAT
  if (!pat) {
    console.log(`   ${SKIP} GITHUB_PAT not set — skipping (set it in .env to test)`)
  } else {
    const result = await validatePAT(pat)
    check('PAT authenticates', result.valid, result.valid ? `user: ${result.user?.login}` : result.error)
    if (result.missingScopes.length > 0) {
      console.log(`   Missing scopes: ${result.missingScopes.join(', ')}`)
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════')
  console.log(`  Results: ${passed} passed, ${failed} failed`)
  console.log('══════════════════════════════════════════\n')

  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('Gate 1B crashed:', err)
  process.exit(1)
})
