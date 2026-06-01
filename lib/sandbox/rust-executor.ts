/**
 * v2.2 / F23c — Rust sandbox executor (foundation).
 *
 * Mirrors lib/sandbox/python-executor.ts + lib/sandbox/go-executor.ts.
 * THIS module ships the image-existence + image-build helpers + the
 * cargo-semver-checks invocation function as a stub that throws "image
 * not built." The real Docker integration (an `mendel-rust-sandbox:v2.2`
 * image built from `rust:1.x-slim` + a precompiled `cargo-semver-checks`
 * binary) lands in the F23c sub-phase 2 commit, gated by the same
 * §11b.1 real-container test pattern that caught the case-sensitive
 * substring bug (F23a) + the apidiff `-m` flag bug (F23b).
 *
 * §11b.1 honored from day one: image-build + every command goes through
 * execFile (no shell — CLAUDE.md §5 rule 18).
 */

import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** Image tag the Rust adapter declares + that this module will build in sub-phase 2. */
export const RUST_IMAGE_NAME = 'mendel-rust-sandbox:v2.2'

/**
 * Hard cap on cargo-semver-checks runtime. Higher than the Python griffe
 * cap (90s) because cargo-semver-checks compiles BOTH versions of the
 * crate as part of its analysis — a full release build is the
 * pessimistic case (~2–3 min for moderately-sized crates with
 * dependencies). The §5b honesty rule applies: if the cap fires, the
 * adapter reports "timed out" with the actual seconds rather than
 * silently returning an empty result.
 */
const SEMVER_CHECKS_TIMEOUT_MS = 240_000
const MEMORY_CAP = '2g'

// ── Image existence + build ───────────────────────────────────────────────────

/** True when the named tag is in the local Docker daemon. */
export async function rustImageExists(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('docker', ['images', '-q', RUST_IMAGE_NAME], { timeout: 10_000 })
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Build the Rust sandbox image if it doesn't already exist. Idempotent.
 *
 * Sub-phase 1 (this commit): the Dockerfile doesn't exist yet, so this
 * function throws cleanly with the path it would build from. The Rust
 * adapter's `semanticDiff` catches that and routes through the same
 * honest-fallback path used when Docker is down — §5b never silently
 * degrades. Sub-phase 2 will land `docker/rust-sandbox.Dockerfile`.
 *
 * Errors are NOT swallowed — the adapter that calls this needs to decide
 * whether to honest-fallback to the stub.
 */
export async function ensureRustSandboxImage(): Promise<void> {
  if (await rustImageExists()) return
  const dockerfileDir = path.resolve(process.cwd(), 'docker')
  const dockerfilePath = path.join(dockerfileDir, 'rust-sandbox.Dockerfile')
  console.log('[rust-sandbox] Building image — one-time setup, takes ~3–5 min on first run (cargo-semver-checks compile)...')
  await execFileAsync(
    'docker',
    ['build', '-f', dockerfilePath, '-t', RUST_IMAGE_NAME, dockerfileDir],
    { timeout: 15 * 60 * 1000 },
  )
  console.log('[rust-sandbox] Image built.')
}

// ── cargo-semver-checks invocation ───────────────────────────────────────────

/**
 * Honest shape returned by the inside-container cargo-semver-checks wrapper.
 *
 * NOTE: cargo-semver-checks is PUBLIC-API ONLY — it walks the crate's
 * exported items per the Rust API guidelines and reports semver violations.
 * It does NOT analyze private items (unlike griffe), which is why the
 * Rust adapter's `maxBucket: 'medium'` clamps the bucket even on a
 * full-confidence agreement (CLAUDE.md §5b v2 r1).
 */
export interface CargoSemverChecksOutput {
  tier: 'cargo-semver-checks'
  removedExports: string[]
  signatureChanges: Array<{ symbol: string; before: string; after: string }>
  newDeprecations: string[]
  unanalyzableSymbols: Array<{ symbol: string; reason: string }>
}

/**
 * Run cargo-semver-checks against (crate, fromVersion, toVersion) inside
 * the Rust sandbox image. Sub-phase 1 throws cleanly with a "not yet
 * implemented" error so the Rust adapter's `semanticDiff` honest-fallback
 * path fires deterministically. Sub-phase 2 will land the real invocation.
 *
 * Network mode: `--network=bridge`. The wrapper needs crates.io access to
 * fetch both versions of the crate. The polyglot-sandbox iptables
 * allowlist parity with Node sandbox is tracked as the v2.2.x follow-on.
 */
export async function runCargoSemverChecks(
  crateName: string,
  fromVersion: string,
  toVersion: string,
): Promise<CargoSemverChecksOutput> {
  if (!(await rustImageExists())) {
    throw new Error(
      `Rust sandbox image ${RUST_IMAGE_NAME} is not built. F23c sub-phase 2 will land the Dockerfile + cargo-semver-checks wrapper. The adapter falls back honestly until then.`,
    )
  }
  const dockerArgs = [
    'run', '--rm',
    '--network=bridge',
    `--memory=${MEMORY_CAP}`,
    RUST_IMAGE_NAME,
    'semver-checks-diff',
    crateName,
    fromVersion,
    toVersion,
  ]
  let stdout: string
  try {
    const out = await execFileAsync('docker', dockerArgs, { timeout: SEMVER_CHECKS_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })
    stdout = out.stdout
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; signal?: string }
    const tail = (e.stderr ?? e.stdout ?? String(err)).slice(-800)
    const reason = e.killed ? `timed out after ${SEMVER_CHECKS_TIMEOUT_MS / 1000}s` : `exited non-zero: ${tail}`
    throw new Error(`cargo-semver-checks failed (${reason})`)
  }
  try {
    return JSON.parse(stdout.trim()) as CargoSemverChecksOutput
  } catch (err) {
    throw new Error(`cargo-semver-checks returned non-JSON output: ${stdout.slice(-400)} (parse error: ${(err as Error).message})`)
  }
}
