/**
 * v2.0 / F20 — REAL container smoke-test verification (Phase C).
 *
 * The unit tests in tests/sandbox-smoke.test.ts prove the pure layer
 * (boot-command detection, ready-signal parsing, the reason truth table).
 * They CANNOT prove the thing that actually matters for security AND
 * honesty: that the docker invocation actually runs --network=none, that
 * the patched app's stdout is captured, that a real crash returns the
 * crash signal, that a real ready signal lands as 'ready-pattern-matched'.
 *
 * This test closes the §11b.1 gap. It:
 *   1. Builds (or reuses) mendel-sandbox:v1.5.2.
 *   2. Creates a real on-disk fixture repo with a real package.json.
 *   3. Creates an empty docker volume (no Phase A required — fixtures use
 *      only the Node stdlib).
 *   4. Runs the actual `runPhaseC` against the real container.
 *   5. Asserts the observed (booted, reason) matches expectation.
 *
 * Three real fixtures:
 *   - BOOT_OK_FIXTURE: prints "Listening on port 3000" then exits 0.
 *     Expect booted=true, reason='ready-pattern-matched'.
 *   - BOOT_CRASH_FIXTURE: throws on require/load → non-zero exit.
 *     Expect booted=false, reason='crashed-non-zero-exit'.
 *   - NO_BOOT_FIXTURE: package.json without start/serve/dev/bin/main.
 *     Expect attempted=false, reason='no-boot-command-detected' (the
 *     fast path that never even touches Docker).
 *
 * Gated by DOCKER_INTEGRATION=1 (needs Docker daemon). Doesn't run on
 * `pnpm test`. Run via:
 *   pnpm test:docker
 *   # or: DOCKER_INTEGRATION=1 pnpm test sandbox-smoke-container
 *
 * CLAUDE.md §11b.1 v2 reinforcement: a Phase-C-class change must boot a
 * real container before being trusted. shipped-but-untested Docker code
 * has bitten us 4 ways already.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runPhaseC } from '@/lib/sandbox/smoke'
import type { SandboxConfig } from '@/lib/sandbox/types'

const execFileAsync = promisify(execFile)
const ENABLE = process.env.DOCKER_INTEGRATION === '1'

// Volume name kept unique per run so concurrent CI doesn't collide.
const VOLUME = `mendel-smoke-test-${Date.now()}`

// Sub-second boots; we cap the test timeout below them.
const FAST_TIMEOUT_MS = 15_000

// ── Real-disk fixture builders ────────────────────────────────────────────────

/** Boot-success fixture: prints a default ready pattern + exits 0. */
function makeBootOkFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mendel-smoke-ok-'))
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'smoke-ok-fx', version: '1.0.0', scripts: { start: 'node server.js' } }),
  )
  // We print and exit. The ready-signal detector will match 'Listening on'.
  writeFileSync(
    path.join(dir, 'server.js'),
    `console.log('Listening on port 3000');\nprocess.exit(0);\n`,
  )
  return dir
}

/** Boot-crash fixture: throws on load → non-zero exit. */
function makeBootCrashFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mendel-smoke-crash-'))
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'smoke-crash-fx', version: '1.0.0', scripts: { start: 'node server.js' } }),
  )
  writeFileSync(
    path.join(dir, 'server.js'),
    `throw new Error('Intentional boot crash — F20 real-container test');\n`,
  )
  return dir
}

/** No-boot fixture: a library-only package.json (no start/serve/dev/bin/main). */
function makeNoBootFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mendel-smoke-nob-'))
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'no-boot-fx', version: '1.0.0', scripts: { test: 'echo "no boot"' } }),
  )
  return dir
}

// ── Suite ─────────────────────────────────────────────────────────────────────

const fixturesToClean: string[] = []

describe.skipIf(!ENABLE)('sandbox smoke (Phase C) — real container', () => {
  beforeAll(async () => {
    const { ensureSandboxImage } = await import('@/lib/sandbox/executor')
    await ensureSandboxImage()
    // Pre-create the volume so the test doesn't depend on docker auto-creating
    // anonymous volumes from a -v flag (behavior differs across Docker Desktop
    // versions). execFile (no shell) per CLAUDE.md §5 rule 18.
    await execFileAsync('docker', ['volume', 'create', VOLUME])
  }, 5 * 60 * 1000)

  afterAll(async () => {
    // Best-effort cleanup — even if a fixture path mkdtemp'd into a path the
    // test process can't unlink, the OS tmp dir gets reaped on its own.
    for (const d of fixturesToClean) {
      try { rmSync(d, { recursive: true, force: true }) } catch { /* tmp reaper */ }
    }
    try { await execFileAsync('docker', ['volume', 'rm', VOLUME]) } catch { /* idempotent */ }
  })

  // The honest happy path.
  it('boots a real ready-signal app and reports booted=true reason=ready-pattern-matched', async () => {
    const repo = makeBootOkFixture()
    fixturesToClean.push(repo)
    const config: SandboxConfig = {
      repoPath: repo,
      scanId: `smoke-ok-${Date.now()}`,
      packageManager: 'pnpm',
      smokeTest: { enabled: true, timeoutMs: 30_000 },
    }
    const result = await runPhaseC(config, VOLUME)
    expect(result.attempted).toBe(true)
    expect(result.booted).toBe(true)
    expect(result.reason).toBe('ready-pattern-matched')
    expect(result.command).toBe('pnpm run start')
    expect(result.logTail).toContain('Listening on')
  }, FAST_TIMEOUT_MS)

  // The "patch broke the boot" case the auto-merge gate exists to catch.
  it('correctly reports booted=false reason=crashed-non-zero-exit on a real crash', async () => {
    const repo = makeBootCrashFixture()
    fixturesToClean.push(repo)
    const config: SandboxConfig = {
      repoPath: repo,
      scanId: `smoke-crash-${Date.now()}`,
      packageManager: 'pnpm',
      smokeTest: { enabled: true, timeoutMs: 30_000 },
    }
    const result = await runPhaseC(config, VOLUME)
    expect(result.attempted).toBe(true)
    expect(result.booted).toBe(false)
    expect(result.reason).toBe('crashed-non-zero-exit')
    expect(result.logTail).toContain('Intentional boot crash')
  }, FAST_TIMEOUT_MS)

  // The honest "not attempted" path — fast (no Docker invocation at all).
  it("reports attempted=false reason=no-boot-command-detected when nothing is detectable (never fake-greens)", async () => {
    const repo = makeNoBootFixture()
    fixturesToClean.push(repo)
    const config: SandboxConfig = {
      repoPath: repo,
      scanId: `smoke-nob-${Date.now()}`,
      packageManager: 'pnpm',
      smokeTest: { enabled: true, timeoutMs: 30_000 },
    }
    const result = await runPhaseC(config, VOLUME)
    expect(result.attempted).toBe(false)
    expect(result.booted).toBe(false)
    expect(result.reason).toBe('no-boot-command-detected')
    expect(result.success).toBe(false) // §5b — not attempted is NOT a pass
  }, FAST_TIMEOUT_MS)
})
