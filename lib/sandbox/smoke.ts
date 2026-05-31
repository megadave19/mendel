/**
 * Phase C — Smoke test (v2.0 / F20).
 *
 * After Phase B (typecheck + test) passes, attempt to BOOT the patched app
 * in `--network=none` Docker isolation and confirm it comes up without
 * crashing within a short timeout. This raises the verification ceiling from
 * "tests pass" to "the app still boots" — the hard prereq for v2.3 auto-merge
 * (CLAUDE.md §5c rule 4).
 *
 * Honesty rules (CLAUDE.md §5b):
 *  - `attempted=false` when no boot command can be detected. UI shows amber
 *    "boot not verified", NEVER a fake-green pass.
 *  - `--network=none` is mandatory (CLAUDE.md §5 rule 16). An app that can't
 *    boot offline is reported honestly — never granted egress to fake a green.
 *  - A ready signal is the cleanest "booted=true" — without one, a long-running
 *    process that doesn't crash within the timeout is reported `timed-out`,
 *    NOT silently as "booted".
 */

import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import type {
  PackageManager,
  PhaseCResult,
  SandboxConfig,
  SmokeBootReason,
  SmokeConfig,
} from './types'
import { IMAGE_NAME, shArg } from './executor'

const execAsync = promisify(exec)

// ── Limits (CLAUDE.md §5 rule 16) ────────────────────────────────────────────

/** Default Phase C timeout. Capped — booting OSS code is the riskiest op. */
const DEFAULT_PHASE_C_TIMEOUT_MS = 60_000
/** Hard ceiling — even if a SmokeConfig requests more, we cap here. */
const MAX_PHASE_C_TIMEOUT_MS = 90_000
const MEMORY_CAP = '2g'
const LOG_TAIL_MAX = 2000

// ── Default ready-signal patterns ────────────────────────────────────────────
//
// Conservative set. We match on case-insensitive substring (no regex chars
// blow up). When a fixture/repo has a specific signal, the caller supplies
// `SmokeConfig.readyPattern` and we use that exclusively.
const DEFAULT_READY_PATTERNS: ReadonlyArray<string> = [
  'listening on',
  'listening at',
  'server started',
  'server running',
  'ready on',
  'ready at',
  'compiled successfully',
  'listening on port',
  'app is running',
]

// ── Boot command detection ──────────────────────────────────────────────────

interface PackageJsonLike {
  scripts?: Record<string, string>
  bin?: string | Record<string, string>
  main?: string
}

/**
 * Read `<repoPath>/package.json` and pick the boot command per a priority
 * order that matches the most-common real-world cases. Returns `null` when
 * NOTHING is detectable — caller MUST honor `attempted=false` in that case
 * (don't fake-green).
 */
export function detectBootCommand(
  repoPath: string,
  pm: PackageManager,
): string | null {
  const pkgPath = path.join(repoPath, 'package.json')
  if (!existsSync(pkgPath)) return null

  let pkg: PackageJsonLike
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJsonLike
  } catch {
    return null
  }

  const scripts = pkg.scripts ?? {}

  // Priority: start > serve > dev. `dev` last because many dev scripts open a
  // file watcher that never reaches a stable "ready" state inside our window.
  // We deliberately do NOT pick `test`/`build`/`lint` (those aren't boots).
  for (const name of ['start', 'serve', 'dev']) {
    if (scripts[name]) {
      // Run via the same package manager we used for Phase A/B so the
      // node_modules layout matches (pnpm hoisting etc).
      return `${pm} run ${name}`
    }
  }

  // Fallback: `bin` or `main` as `node <file>`. Useful for small CLIs / one-
  // file servers that have no scripts. String-form bin is "the one binary."
  if (typeof pkg.bin === 'string') return `node ${pkg.bin}`
  if (typeof pkg.bin === 'object') {
    const firstBin = Object.values(pkg.bin)[0]
    if (firstBin) return `node ${firstBin}`
  }
  if (pkg.main) return `node ${pkg.main}`

  return null
}

// ── Ready-signal detection (pure) ────────────────────────────────────────────

/**
 * Did the captured stdout contain any ready signal? Used both with a
 * caller-supplied `readyPattern` and with the default set.
 */
export function detectReadySignal(
  stdout: string,
  readyPattern: string | undefined,
): boolean {
  const haystack = stdout.toLowerCase()
  if (readyPattern && readyPattern.length > 0) {
    return haystack.includes(readyPattern.toLowerCase())
  }
  for (const pat of DEFAULT_READY_PATTERNS) {
    if (haystack.includes(pat)) return true
  }
  return false
}

// ── Reason resolution (pure) ─────────────────────────────────────────────────

/**
 * Combine the raw run signals (exit code, timeout, captured stdout) into a
 * single (booted, reason) pair. Pure so it's exhaustively testable without
 * Docker. The honesty rules from §5b live here:
 *  - explicit ready signal beats everything
 *  - clean exit (0) within window = booted (handles short-lived CLIs)
 *  - non-zero exit = crash, regardless of stdout
 *  - timeout while still running = timed-out (NOT silent "booted")
 */
export function resolvePhaseCReason(input: {
  timedOut: boolean
  exitCode: number
  stdout: string
  readyPattern: string | undefined
}): { booted: boolean; reason: SmokeBootReason } {
  if (detectReadySignal(input.stdout, input.readyPattern)) {
    return { booted: true, reason: 'ready-pattern-matched' }
  }
  if (input.timedOut) {
    return { booted: false, reason: 'timed-out' }
  }
  if (input.exitCode === 0) {
    return { booted: true, reason: 'clean-exit' }
  }
  return { booted: false, reason: 'crashed-non-zero-exit' }
}

// ── Phase C runner ───────────────────────────────────────────────────────────

/**
 * Build the Docker invocation for Phase C. Pure so the test suite can assert
 * the flags without running Docker. Mirrors the structure of runPhaseA/B —
 * volume mount for the patched repo + the Phase A `node_modules` volume.
 *
 * Key constraints (CLAUDE.md §5 rule 16):
 *   --network=none   (NEVER bridge — egress would invalidate the honesty bar)
 *   --memory=2g      (matches A/B)
 *   --user=node      (non-root)
 *   --read-only on the repo bind would be nice but Phase B already enforces
 *     it via volume semantics + the install volume is dedicated.
 */
export function buildPhaseCDockerCommand(input: {
  repoPath: string
  vol: string
  bootCommand: string
}): string {
  return [
    'docker run',
    '--rm',
    '--network=none',
    `--memory=${MEMORY_CAP}`,
    '--user=node',
    '-e CI=true',
    `--volume="${input.repoPath}:/repo"`,
    `--volume="${input.vol}:/repo/node_modules"`,
    '--workdir=/repo',
    IMAGE_NAME,
    `sh -c ${shArg(input.bootCommand)}`,
  ].join(' ')
}

/** Clamp a caller-supplied timeout to the hard ceiling. */
function resolveTimeoutMs(cfg: SmokeConfig | undefined): number {
  const raw = cfg?.timeoutMs ?? DEFAULT_PHASE_C_TIMEOUT_MS
  return Math.min(Math.max(1_000, raw), MAX_PHASE_C_TIMEOUT_MS)
}

/**
 * Run Phase C — boot the patched app under `--network=none` and decide if it
 * came up. `vol` is the install volume from Phase A so dependencies are
 * already in place.
 */
export async function runPhaseC(
  config: SandboxConfig,
  vol: string,
): Promise<PhaseCResult> {
  const start = Date.now()
  const smoke = config.smokeTest

  // Smoke disabled at the call site — return a clean "not attempted" record.
  if (!smoke || !smoke.enabled) {
    return notAttempted(start, 'smoke-disabled')
  }

  const bootCommand = smoke.command ?? detectBootCommand(config.repoPath, config.packageManager)
  if (!bootCommand) {
    return notAttempted(start, 'no-boot-command-detected')
  }

  const timeoutMs = resolveTimeoutMs(smoke)
  const cmd = buildPhaseCDockerCommand({
    repoPath: config.repoPath,
    vol,
    bootCommand,
  })

  let stdout = ''
  let stderr = ''
  let exitCode = 0
  let timedOut = false

  try {
    const out = await execAsync(cmd, { timeout: timeoutMs })
    stdout = out.stdout
    stderr = out.stderr
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; code?: number }
    stdout = e.stdout ?? ''
    stderr = e.stderr ?? ''
    exitCode = e.code ?? 1
    timedOut = e.killed ?? false
  }

  const { booted, reason } = resolvePhaseCReason({
    timedOut,
    exitCode,
    stdout,
    readyPattern: smoke.readyPattern,
  })

  return {
    phase: 'C',
    success: booted,
    attempted: true,
    booted,
    reason,
    command: bootCommand,
    exitCode,
    stdout,
    stderr,
    logTail: tail(stdout + (stderr ? `\n[stderr]\n${stderr}` : '')),
    durationMs: Date.now() - start,
    timedOut,
  }
}

function notAttempted(start: number, reason: SmokeBootReason): PhaseCResult {
  return {
    phase: 'C',
    success: false, // "not attempted" is NOT a pass — §5b rule 5
    attempted: false,
    booted: false,
    reason,
    command: '',
    exitCode: 0,
    stdout: '',
    stderr: '',
    logTail: '',
    durationMs: Date.now() - start,
    timedOut: false,
  }
}

function tail(s: string): string {
  return s.length <= LOG_TAIL_MAX ? s : s.slice(-LOG_TAIL_MAX)
}
