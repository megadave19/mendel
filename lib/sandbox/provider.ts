/**
 * SandboxProvider (v2.0 / V2_PLAN §F19 supporting work) — cloud-readiness seam.
 *
 * v1.x called Docker functions in lib/sandbox/executor.ts directly from the
 * runner. That coupled the agent to one specific runtime. v3 needs to swap in
 * a hosted sandbox (E2B / Fly Machines) without rewriting the agent.
 *
 * This file defines the interface every sandbox implementation must honor and
 * ships the local Docker implementation that wraps today's executor — pure
 * refactor, ZERO behavior change. The full v1.5 test suite must still pass.
 *
 * Cloud-readiness contract (CLAUDE.md §2.1 / V2_PLAN §2.1):
 *   - No method takes a Docker-specific concept (image names, container ids,
 *     volume paths) in its signature. Everything is described in terms of
 *     "install / test / smoke / teardown" + a SandboxConfig.
 *   - Per-method timeout + memory caps live in SandboxConfig (already there) —
 *     a v3 hosted provider can honor the same fields.
 *   - The factory `getSandboxProvider()` is the one chokepoint where v3 will
 *     dispatch by env (LOCAL → Docker, CLOUD → E2B).
 *
 * Phase C / runSmoke (F20) will extend this interface; F20 is the next change.
 */

import type {
  PackageManager,
  PhaseAResult,
  PhaseBResult,
  SandboxConfig,
} from './types'
import {
  checkSandboxReadiness as executorCheckReadiness,
  cleanupVolume as executorCleanup,
  ensureSandboxImage as executorEnsureImage,
  runPhaseA as executorRunPhaseA,
  runPhaseB as executorRunPhaseB,
} from './executor'

// ── The contract ──────────────────────────────────────────────────────────────

/** Result of a pre-flight check against the underlying runtime. */
export type ReadinessResult =
  | { ok: true }
  | { ok: false; reason: string }

export interface SandboxProvider {
  /** Human-readable name for logs/reports. */
  readonly name: string

  /**
   * Ensure the runtime is bootable (e.g., pull/build the local image, warm
   * the hosted pool). Idempotent — calling repeatedly is a no-op when ready.
   */
  ensureReady(): Promise<void>

  /**
   * Pre-flight: can the runtime actually execute THIS repo's toolchain?
   * Returns a reason on failure so the runner can surface a clear message
   * to the user before doing minutes of analysis (CLAUDE.md §11b.1 lesson:
   * delivery pre-flight vs. verification pre-flight are distinct gates).
   */
  checkReadiness(pm: PackageManager): Promise<ReadinessResult>

  /**
   * Phase A — install dependencies. Network access governed by SandboxConfig
   * (allowlist on bridge for local Docker; egress rules on hosted).
   */
  runInstall(config: SandboxConfig): Promise<PhaseAResult>

  /**
   * Phase B — typecheck + test. MUST run with no egress (network=none on
   * Docker; egress=deny on hosted). CLAUDE.md §5 rule 11/16.
   */
  runTest(config: SandboxConfig, installArtifact: string): Promise<PhaseBResult>

  /**
   * Tear down any persistent state created by the run (volumes on local,
   * sessions on hosted). Returns whether the teardown succeeded — never
   * throws, because the runner always tries teardown in `finally`.
   */
  teardown(installArtifact: string): Promise<boolean>
}

// ── LocalDockerProvider — wraps today's executor ──────────────────────────────

/**
 * Delegates every method to the existing executor functions verbatim. This
 * is a pure refactor — no logic moved, just the call shape. The behavior MUST
 * be identical to v1.5 (V2_PLAN gate: full v1.5 test suite passes unchanged).
 */
export class LocalDockerProvider implements SandboxProvider {
  readonly name = 'local-docker'

  async ensureReady(): Promise<void> {
    await executorEnsureImage()
  }

  async checkReadiness(pm: PackageManager): Promise<ReadinessResult> {
    return executorCheckReadiness(pm)
  }

  async runInstall(config: SandboxConfig): Promise<PhaseAResult> {
    return executorRunPhaseA(config)
  }

  async runTest(config: SandboxConfig, vol: string): Promise<PhaseBResult> {
    return executorRunPhaseB(config, vol)
  }

  async teardown(vol: string): Promise<boolean> {
    return executorCleanup(vol)
  }
}

// ── Factory: the v3 swap-point ────────────────────────────────────────────────
//
// v2.x: always returns LocalDockerProvider. v3 will dispatch by env, e.g.
// `MENDEL_SANDBOX=cloud` → HostedE2BProvider. The factory is intentionally a
// function (not a constant) so a future provider can read its own config at
// instantiation without import-order hazards.

let cached: SandboxProvider | null = null

export function getSandboxProvider(): SandboxProvider {
  if (cached) return cached
  cached = new LocalDockerProvider()
  return cached
}

/** Test-only: drop the cache so a fresh provider is built next call. */
export function __resetSandboxProviderForTests(): void {
  cached = null
}
