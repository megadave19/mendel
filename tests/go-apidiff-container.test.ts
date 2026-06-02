/**
 * v2.2 / F23b sub-phase 2 — REAL container test for the apidiff-based
 * Go semantic-diff.
 *
 * Per CLAUDE.md §11b.1 (Docker hallucination): every per-language image
 * gets a real-container test before it's trusted. Without this, the
 * goAdapter.semanticDiff LOOKS RIGHT (TS unit tests pass with mocks)
 * but the actual Docker invocation could be subtly wrong — exactly the
 * bug class that bit us before (yarn-missing image, su-exec entrypoint,
 * shell-quoting on cache hits, workspace install hanging, griffe case-
 * sensitive bucketing).
 *
 * What this proves:
 *   1. `docker/go-sandbox.Dockerfile` builds successfully
 *   2. The image has apidiff + go on PATH for the non-root mendel user
 *   3. `runApidiff` against a real public Go module pair
 *      (github.com/julienschmidt/httprouter v1.0.0 → v1.3.0) returns
 *      a parseable result with non-zero findings (this pair was
 *      verified by hand to produce 2 removed exports + 2 signature
 *      changes — a stable + tiny module pair that gives apidiff
 *      something real to detect)
 *   4. The Go adapter's `semanticDiff` round-trips into a SemanticDiff
 *      that flows through the scorer (analysisTier='apidiff' lands)
 *
 * Bug caught here on first run that would have shipped silently:
 *   - apidiff requires the `-m` flag for module-mode in BOTH the
 *     extraction (-m -w) and the diff (apidiff -m old new); without it
 *     apidiff returned "found no packages for module ..."
 *   - GOPATH /go/pkg/sumdb was root-owned; the non-root user got
 *     "permission denied" on the first `go get`. Fix: chown /go in
 *     the Dockerfile.
 *   - Format-string bug `v%s` + already-prefixed `v1.7.0` →
 *     surfacing `vv1.7.0` in error messages, mis-routing debugging.
 *
 * Gated by DOCKER_INTEGRATION=1 (needs Docker + network for the
 * proxy.golang.org pulls). Runs via `pnpm test:docker`.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  ensureGoSandboxImage,
  goImageExists,
  runApidiff,
  GO_IMAGE_NAME,
} from '@/lib/sandbox/go-executor'
import { goAdapter } from '@/lib/agent/lang/go'

const ENABLE = process.env.DOCKER_INTEGRATION === '1'

// Use a SMALL, STABLE Go module with documented public-API changes.
// `julienschmidt/httprouter` v1.0.0 → v1.3.0 was verified by hand to
// produce 2 removed exports (`NotFound`, `Router.RedirectCaseInsensitive`)
// + 2 signature changes (`Handle`, `Router.NotFound`). Pinned versions
// so the assertion is stable across CI runs.
const MOD = 'github.com/julienschmidt/httprouter'
const FROM = 'v1.0.0'
const TO = 'v1.3.0'

describe.skipIf(!ENABLE)('Go apidiff — real container (§11b.1)', () => {
  beforeAll(async () => {
    // Build the image once for the whole file. Image build is idempotent
    // (Docker layer cache) so subsequent runs are ~instant. The first
    // build pulls golang.org/x/exp + auto-fetches the Go toolchain
    // apidiff needs (~30s of network + compile).
    await ensureGoSandboxImage()
  }, 10 * 60 * 1000)

  it('the Go sandbox image is built + advertises apidiff on PATH', async () => {
    expect(await goImageExists()).toBe(true)
    // apidiff -help exits NON-ZERO and writes its usage banner to
    // STDERR (it's `usage`-style — an unrecognized-flag response).
    // We must combine both streams to read the banner reliably across
    // exit-code paths. First version of this test only read stdout
    // and was empty — caught immediately on first §11b.1 run.
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)
    const result = await execFileAsync(
      'docker',
      ['run', '--rm', '--entrypoint=apidiff', GO_IMAGE_NAME, '-help'],
      { timeout: 30_000 },
    ).catch((err: { stdout?: string; stderr?: string }) => ({
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    }))
    const combined = (result.stdout ?? '') + (result.stderr ?? '')
    // The usage banner is the stable shape apidiff has shipped for
    // many releases. If apidiff changes its CLI substantively, this
    // breaks and we investigate rather than ship a silently-broken
    // wrapper.
    expect(combined).toMatch(/apidiff/i)
    expect(combined).toMatch(/-m\s+compare modules/i)
  }, 60_000)

  it("runs apidiff against a real public Go module pair (httprouter v1.0.0 → v1.3.0) and returns parseable findings", async () => {
    // This is the §11b.1 win: we run the SAME command path the adapter
    // takes in production. A failure here is a real F23b bug — either
    // the wrapper is wrong, the image is wrong, or apidiff changed
    // output shape.
    const out = await runApidiff(MOD, FROM, TO)
    expect(out.tier).toBe('apidiff')

    // httprouter v1.0.0 → v1.3.0 has documented breaking changes — we
    // require at least ONE finding so a regression to silent-empty-
    // output would fail loudly (the same shape Python's griffe test
    // pins via total > 0). The exact counts may drift if apidiff
    // refines its bucketing; the bound below is conservative.
    const total =
      out.removedExports.length +
      out.signatureChanges.length +
      out.newDeprecations.length
    expect(total).toBeGreaterThan(0)

    // At least one removed export must be present — that's the
    // strongest qualitative claim about this version pair (it dropped
    // public symbols). If apidiff stops detecting that, we want to
    // know immediately.
    expect(out.removedExports.length).toBeGreaterThan(0)

    // The output must be JSON-serializable (the adapter relies on this
    // when it persists the resulting SemanticDiff blob).
    expect(() => JSON.stringify(out)).not.toThrow()
  }, 5 * 60 * 1000) // go get + apidiff for two versions = up to ~120s on cold cache

  it("handles a MULTI-PACKAGE Go module (golang.org/x/sync — errgroup/semaphore/singleflight/syncmap) without crashing", async () => {
    // v2.2.x polish — pin multi-package support. apidiff -m walks every
    // sub-package of a module internally (verified: `apidiff -m -w` on
    // x/sync v0.5.0 produces a 6707-byte API artifact that encodes all
    // four sub-packages). The wrapper inherits that natively — it just
    // calls `apidiff -m -w` once per version pair and trusts apidiff to
    // walk packages.
    //
    // x/sync v0.5.0 → v0.10.0 is a stable utility-library bump with no
    // public API changes — so the honest expected output is ZERO
    // findings. The pin asserts: the call succeeds, the tier is right,
    // the wrapper does NOT fall back to honest-error (a non-empty
    // unanalyzableSymbols list would mean apidiff broke on
    // multi-package walking).
    const MULTI_PKG_MOD = 'golang.org/x/sync'
    const out = await runApidiff(MULTI_PKG_MOD, 'v0.5.0', 'v0.10.0')
    expect(out.tier).toBe('apidiff')
    // Honest contract: a stable bump should produce ZERO unanalyzable
    // symbols. A non-empty list would mean apidiff stumbled on a
    // sub-package (the failure shape we'd want to know about).
    expect(out.unanalyzableSymbols).toEqual([])
    // The four arrays all parse — no schema drift.
    expect(Array.isArray(out.removedExports)).toBe(true)
    expect(Array.isArray(out.signatureChanges)).toBe(true)
    expect(Array.isArray(out.newDeprecations)).toBe(true)
  }, 5 * 60 * 1000)

  it("the Go adapter wraps apidiff output into a valid SemanticDiff (round-trip)", async () => {
    const diff = await goAdapter.semanticDiff(MOD, FROM, TO)
    expect(diff.coveragePercent).toBe(100) // apidiff is exhaustive within scope
    // v2.2 / F23b sub-phase 2 — adapter reports the honest analyzer name.
    expect(diff.analysisTier).toBe('apidiff')
    expect(Array.isArray(diff.removedExports)).toBe(true)
    expect(Array.isArray(diff.signatureChanges)).toBe(true)
    // The "fallback" path produces a single unanalyzable entry — on
    // the success path the array is either empty OR contains real
    // unbucketed-line entries from apidiff.
    const reasons = diff.unanalyzableSymbols.map((u) => u.reason)
    const isFallbackReason = reasons.some(
      (r) =>
        r.includes('not built') ||
        r.includes('could not analyze') ||
        r.includes('apidiff failed'),
    )
    expect(isFallbackReason).toBe(false)
  }, 5 * 60 * 1000)
})
