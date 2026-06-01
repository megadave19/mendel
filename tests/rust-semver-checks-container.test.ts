/**
 * v2.2 / F23c sub-phase 2 — REAL container test for the cargo-semver-
 * checks-based Rust semantic-diff.
 *
 * Per CLAUDE.md §11b.1 (Docker hallucination): every per-language image
 * gets a real-container test before it's trusted. Without this, the
 * rustAdapter.semanticDiff LOOKS RIGHT (TS unit tests pass with mocks)
 * but the actual Docker invocation could be subtly wrong — exactly the
 * bug class that bit us before (yarn-missing image, su-exec entrypoint,
 * shell-quoting on cache hits, griffe case-sensitive bucketing,
 * apidiff -m flag missing).
 *
 * What this proves:
 *   1. `docker/rust-sandbox.Dockerfile` builds successfully
 *   2. The image has cargo + cargo-semver-checks + the wrapper binary
 *      on PATH for the non-root mendel user
 *   3. `runCargoSemverChecks` against a real crates.io pair
 *      (semver 0.11.0 → 1.0.0) returns parseable findings — verified
 *      by hand to produce 15 removed exports (enums, methods, derive
 *      bounds, features) on a documented major API redesign
 *   4. The Rust adapter's `semanticDiff` round-trips into a SemanticDiff
 *      with analysisTier='cargo-semver-checks'
 *
 * Bugs caught here on first run that would have shipped silently:
 *   - cargo-semver-checks v0.36 (the original pin) can't parse rustdoc
 *     JSON v57 produced by current Rust toolchain. Fix: float to
 *     `cargo install --locked cargo-semver-checks` (no version pin).
 *   - `-p <name>` selects WORKSPACE MEMBERS, not deps. The throwaway-
 *     crate approach returned "no crates with library targets selected,
 *     nothing to semver-check". Fix: download the TO_VERSION's source
 *     from crates.io and run cargo-semver-checks from inside it.
 *   - cargo-semver-checks SKIPS all 253 lints by default when the bump
 *     is already a major-version increment. Mendel needs breakage
 *     detection regardless of bump kind, so the wrapper passes
 *     `--release-type=patch` to make every lint runnable.
 *   - The first-cut parser counted ALL leading-whitespace lines as
 *     symbols, slurping cargo's "    Building semver v1.0.0 (current)"
 *     progress lines into removedExports. Fix: the "Failed in:" block
 *     entries use EXACTLY 2-space indent; cargo progress uses 4+.
 *
 * Gated by DOCKER_INTEGRATION=1 (needs Docker + network for the
 * crates.io fetches). Runs via `pnpm test:docker`.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  ensureRustSandboxImage,
  rustImageExists,
  runCargoSemverChecks,
  RUST_IMAGE_NAME,
} from '@/lib/sandbox/rust-executor'
import { rustAdapter } from '@/lib/agent/lang/rust'

const ENABLE = process.env.DOCKER_INTEGRATION === '1'

// Use a SMALL, STABLE crate with a verified major API redesign.
// `semver` 0.11.0 → 1.0.0 was the canonical "major API rewrite" pair
// and was verified by hand to produce 15 removed exports (3 enums,
// 8 methods, 2 derive bounds, 2 features). Pinned versions so the
// assertion is stable across CI runs even as cargo-semver-checks
// refines its bucketing.
const CRATE = 'semver'
const FROM = '0.11.0'
const TO = '1.0.0'

describe.skipIf(!ENABLE)('Rust cargo-semver-checks — real container (§11b.1)', () => {
  beforeAll(async () => {
    // Build the image once for the whole file. Image build is
    // idempotent (Docker layer cache) so subsequent runs are
    // ~instant. The first build runs `cargo install` which compiles
    // cargo-semver-checks + its considerable dep tree from source
    // (~3–4 min on cold cache).
    await ensureRustSandboxImage()
  }, 15 * 60 * 1000)

  it('the Rust sandbox image is built + advertises cargo-semver-checks on PATH', async () => {
    expect(await rustImageExists()).toBe(true)
    // `cargo semver-checks --version` is the cheapest way to confirm
    // both the subcommand binary AND cargo's resolution path work
    // for the non-root mendel user. Combines stdout + stderr because
    // cargo prints status to stderr.
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)
    const result = await execFileAsync(
      'docker',
      ['run', '--rm', '--entrypoint=cargo', RUST_IMAGE_NAME, 'semver-checks', '--version'],
      { timeout: 30_000 },
    ).catch((err: { stdout?: string; stderr?: string }) => ({
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    }))
    const combined = (result.stdout ?? '') + (result.stderr ?? '')
    // The version banner has a stable shape: "cargo-semver-checks <semver>".
    expect(combined).toMatch(/cargo-semver-checks\s+\d+\.\d+/)
  }, 60_000)

  it("runs cargo-semver-checks against a real crates.io pair (semver 0.11.0 → 1.0.0) and returns parseable findings", async () => {
    // This is the §11b.1 win: we run the SAME command path the
    // adapter takes in production. A failure here is a real F23c
    // bug — wrapper wrong, image wrong, or cargo-semver-checks
    // output shape changed.
    const out = await runCargoSemverChecks(CRATE, FROM, TO)
    expect(out.tier).toBe('cargo-semver-checks')

    // semver 0.11 → 1.0 is a documented major API rewrite — we
    // require at least ONE finding so a regression to silent-empty
    // output would fail loudly (the same shape Python's griffe + Go's
    // apidiff tests pin via total > 0).
    const total =
      out.removedExports.length +
      out.signatureChanges.length +
      out.newDeprecations.length
    expect(total).toBeGreaterThan(0)

    // At least one removed export must be present — that's the
    // strongest qualitative claim about this version pair (it dropped
    // public symbols). If cargo-semver-checks stops detecting that,
    // we want to know immediately.
    expect(out.removedExports.length).toBeGreaterThan(0)

    // The output must be JSON-serializable.
    expect(() => JSON.stringify(out)).not.toThrow()
  }, 5 * 60 * 1000) // crates.io fetch + cargo build for two versions = up to ~120s

  it("the Rust adapter wraps cargo-semver-checks output into a valid SemanticDiff (round-trip)", async () => {
    const diff = await rustAdapter.semanticDiff(CRATE, FROM, TO)
    expect(diff.coveragePercent).toBe(100) // exhaustive within public-API scope
    // v2.2 / F23c sub-phase 2 — adapter reports the honest analyzer name.
    expect(diff.analysisTier).toBe('cargo-semver-checks')
    expect(Array.isArray(diff.removedExports)).toBe(true)
    expect(Array.isArray(diff.signatureChanges)).toBe(true)
    // The "fallback" path produces a single unanalyzable entry — on
    // the success path the array is either empty OR contains real
    // unbucketed-lint entries from cargo-semver-checks.
    const reasons = diff.unanalyzableSymbols.map((u) => u.reason)
    const isFallbackReason = reasons.some(
      (r) =>
        r.includes('not built') ||
        r.includes('could not analyze') ||
        r.includes('cargo-semver-checks failed'),
    )
    expect(isFallbackReason).toBe(false)
  }, 5 * 60 * 1000)
})
