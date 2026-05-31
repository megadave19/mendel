/**
 * SandboxProvider contract tests (v2.0 supporting work).
 *
 * V2_PLAN §F19 gate: "SandboxProvider refactor passes the full v1.5 suite
 * unchanged (no behavior drift)." The full suite is the integration check;
 * this file is the unit check: every interface method must delegate to the
 * underlying executor verbatim, AND the factory must return a stable
 * singleton (otherwise the runner would build a new provider per call,
 * defeating the purpose of the seam for cloud providers that warm up).
 *
 * Mock pattern: vi.mock the executor module so we can assert delegations
 * without touching Docker. The provider is pure plumbing — the test bar is
 * "does it call the right executor function with the right args."
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.mock is hoisted above all const decls, so the mock fns must live inside
// vi.hoisted() to be visible to the factory at hoist time.
const mocks = vi.hoisted(() => ({
  mockEnsure: vi.fn(),
  mockCheckReadiness: vi.fn(),
  mockRunPhaseA: vi.fn(),
  mockRunPhaseB: vi.fn(),
  mockCleanup: vi.fn(),
}))
const { mockEnsure, mockCheckReadiness, mockRunPhaseA, mockRunPhaseB, mockCleanup } = mocks

vi.mock('@/lib/sandbox/executor', () => ({
  ensureSandboxImage: mocks.mockEnsure,
  checkSandboxReadiness: mocks.mockCheckReadiness,
  runPhaseA: mocks.mockRunPhaseA,
  runPhaseB: mocks.mockRunPhaseB,
  cleanupVolume: mocks.mockCleanup,
  // The provider doesn't use these but other importers in the bundle do —
  // expose them so the module mock doesn't break unrelated code.
  volumeName: (id: string) => `mendel-nm-${id}`,
  imageExists: vi.fn(),
  IMAGE_NAME: 'mendel-sandbox:test',
  shArg: (s: string) => `'${s}'`,
  verifyEgressBlocked: vi.fn(),
}))

import {
  LocalDockerProvider,
  getSandboxProvider,
  __resetSandboxProviderForTests,
} from '@/lib/sandbox/provider'
import type { SandboxConfig } from '@/lib/sandbox/types'

const SAMPLE_CONFIG: SandboxConfig = {
  repoPath: '/tmp/repo',
  scanId: 'scan-x',
  packageManager: 'pnpm',
}

beforeEach(() => {
  mockEnsure.mockReset()
  mockCheckReadiness.mockReset()
  mockRunPhaseA.mockReset()
  mockRunPhaseB.mockReset()
  mockCleanup.mockReset()
  __resetSandboxProviderForTests()
})

describe('LocalDockerProvider — delegates every method to the executor', () => {
  it("identifies itself as 'local-docker' (for log/report headers)", () => {
    expect(new LocalDockerProvider().name).toBe('local-docker')
  })

  it('ensureReady → ensureSandboxImage()', async () => {
    mockEnsure.mockResolvedValue(undefined)
    await new LocalDockerProvider().ensureReady()
    expect(mockEnsure).toHaveBeenCalledTimes(1)
    expect(mockEnsure).toHaveBeenCalledWith()
  })

  it('checkReadiness(pm) → checkSandboxReadiness(pm), passes the package manager through', async () => {
    mockCheckReadiness.mockResolvedValue({ ok: true })
    const out = await new LocalDockerProvider().checkReadiness('yarn')
    expect(mockCheckReadiness).toHaveBeenCalledWith('yarn')
    expect(out).toEqual({ ok: true })
  })

  it('checkReadiness propagates ok:false reason verbatim', async () => {
    mockCheckReadiness.mockResolvedValue({ ok: false, reason: 'no yarn in image' })
    const out = await new LocalDockerProvider().checkReadiness('yarn')
    expect(out).toEqual({ ok: false, reason: 'no yarn in image' })
  })

  it('runInstall(config) → runPhaseA(config), preserves SandboxConfig shape', async () => {
    const fake = { phase: 'A', success: true, exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, volumeName: 'mendel-nm-scan-x' }
    mockRunPhaseA.mockResolvedValue(fake)
    const out = await new LocalDockerProvider().runInstall(SAMPLE_CONFIG)
    expect(mockRunPhaseA).toHaveBeenCalledWith(SAMPLE_CONFIG)
    expect(out).toBe(fake)
  })

  it('runTest(config, vol) → runPhaseB(config, vol), passes BOTH args', async () => {
    const fake = { phase: 'B', success: true, exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, typecheckPassed: true, testsPassed: true }
    mockRunPhaseB.mockResolvedValue(fake)
    const out = await new LocalDockerProvider().runTest(SAMPLE_CONFIG, 'mendel-nm-scan-x')
    expect(mockRunPhaseB).toHaveBeenCalledWith(SAMPLE_CONFIG, 'mendel-nm-scan-x')
    expect(out).toBe(fake)
  })

  it('teardown(vol) → cleanupVolume(vol), returns the same boolean', async () => {
    mockCleanup.mockResolvedValue(true)
    const out = await new LocalDockerProvider().teardown('mendel-nm-scan-x')
    expect(mockCleanup).toHaveBeenCalledWith('mendel-nm-scan-x')
    expect(out).toBe(true)
  })
})

describe('getSandboxProvider — singleton factory (v3 swap-point)', () => {
  it('returns a LocalDockerProvider in v2', () => {
    const p = getSandboxProvider()
    expect(p.name).toBe('local-docker')
  })

  it('returns the SAME instance across calls (cloud providers may warm up)', () => {
    const a = getSandboxProvider()
    const b = getSandboxProvider()
    expect(a).toBe(b)
  })

  it('__resetSandboxProviderForTests drops the cache → next call builds fresh', () => {
    const a = getSandboxProvider()
    __resetSandboxProviderForTests()
    const b = getSandboxProvider()
    expect(a).not.toBe(b)
  })
})
