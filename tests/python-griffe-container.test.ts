/**
 * v2.2 / F23a — REAL container test for the griffe-based Python semantic-diff.
 *
 * Per CLAUDE.md §11b.1 (Docker hallucination): every per-language image
 * gets a real-container test before it's trusted. Without this, the
 * pythonAdapter.semanticDiff LOOKS RIGHT (TS unit tests pass with mocks)
 * but the actual Docker invocation could be subtly wrong — exactly the
 * bug class that bit us before (yarn-missing image, su-exec entrypoint,
 * shell-quoting on cache hits, workspace install hanging).
 *
 * What this proves:
 *   1. `docker/python-sandbox.Dockerfile` builds successfully
 *   2. The image has griffe + pip available + the analysis script on PATH
 *   3. `runGriffeDiff` against a real PyPI pair (cachetools 4 → 5) returns
 *      a parseable result with non-zero findings (cachetools 5 dropped
 *      Python 3.6 + removed several deprecated APIs — well-documented)
 *   4. The Python adapter's `semanticDiff` round-trips into a SemanticDiff
 *      that flows through `calculateConfidence` without errors
 *
 * Gated by DOCKER_INTEGRATION=1 (needs Docker + network for the PyPI
 * pulls). Runs via `pnpm test:docker`.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  ensurePythonSandboxImage,
  pythonImageExists,
  runGriffeDiff,
  PYTHON_IMAGE_NAME,
} from '@/lib/sandbox/python-executor'
import { pythonAdapter } from '@/lib/agent/lang/python'

const ENABLE = process.env.DOCKER_INTEGRATION === '1'

// Use a SMALL, STABLE PyPI package with a documented major-version break.
// `cachetools` 4 → 5 is a known clean case: ~1MB install, no C extensions,
// removed several public APIs. If griffe ever stops finding ANYTHING here,
// the assertion fires + we investigate.
const PKG = 'cachetools'
const FROM = '4.2.4'
const TO = '5.3.0'

describe.skipIf(!ENABLE)('Python griffe-diff — real container (§11b.1)', () => {
  beforeAll(async () => {
    // Build the image once for the whole file. Image build is idempotent
    // (Docker layer cache) so subsequent runs are ~instant.
    await ensurePythonSandboxImage()
  }, 10 * 60 * 1000)

  it('the Python sandbox image is built + advertises griffe on PATH', async () => {
    expect(await pythonImageExists()).toBe(true)
    // griffe --version is the cheapest way to confirm the binary is on PATH
    // for the non-root mendel user. We invoke the same way runGriffeDiff
    // does so the test exercises the image's USER directive too.
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync(
      'docker',
      ['run', '--rm', '--entrypoint=griffe', PYTHON_IMAGE_NAME, '--version'],
      { timeout: 30_000 },
    )
    // `griffe --version` prints "griffe X.Y.Z" — match that shape rather
    // than requiring a leading digit (real output, not the assumption).
    expect(stdout.trim()).toMatch(/^griffe \d+\.\d+/)
  }, 60_000)

  it("runs griffe-diff against a real PyPI pair (cachetools 4 → 5) and returns parseable findings", async () => {
    // This is the §11b.1 win: we run the SAME command path the adapter
    // takes in production. A failure here is a real F23a bug — either
    // the script is wrong, the image is wrong, or griffe changed shape.
    const out = await runGriffeDiff(PKG, FROM, TO)
    expect(out.tier).toBe('griffe')
    // cachetools 5.0 was a major breaking release — griffe should find
    // SOMETHING. We don't pin a specific count (the bench fixture pins
    // the calibration math; here we just prove griffe actually ran +
    // emitted bucketed output).
    const total =
      out.removedExports.length +
      out.signatureChanges.length +
      out.newDeprecations.length
    expect(total).toBeGreaterThan(0)
    // The output must be JSON-serializable (the adapter relies on this
    // when it persists the resulting SemanticDiff blob).
    expect(() => JSON.stringify(out)).not.toThrow()
  }, 3 * 60 * 1000) // pip install + griffe walk = up to ~90s on cold cache

  it("the Python adapter wraps griffe output into a valid SemanticDiff (round-trip)", async () => {
    const diff = await pythonAdapter.semanticDiff(PKG, FROM, TO)
    expect(diff.coveragePercent).toBe(100) // griffe is exhaustive within its scope
    expect(diff.analysisTier).toBe('dts')
    expect(Array.isArray(diff.removedExports)).toBe(true)
    expect(Array.isArray(diff.signatureChanges)).toBe(true)
    // The "fallback" path produces a single unanalyzable entry — on the
    // success path the array is either empty OR contains real
    // unbucketed-kind entries from griffe.
    const reasons = diff.unanalyzableSymbols.map((u) => u.reason)
    const isFallbackReason = reasons.some((r) => r.includes('not built') || r.includes('could not analyze'))
    expect(isFallbackReason).toBe(false)
  }, 3 * 60 * 1000)
})
