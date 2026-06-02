/**
 * v2.3 / F25 sub-phase 1 — worker integration tests.
 *
 * The pure rules live in tests/monitor-scheduler.test.ts. THIS file
 * exercises the worker's orchestration: it patches the runScan function,
 * the DB, and the clock so we can pin:
 *
 *   - startMonitorWorker loads enabled rows + registers ONE task per
 *     repo (plus the PR-poller task)
 *   - A disabled row is NOT registered
 *   - An invalid cron expression is REFUSED (refusal logged, no task
 *     created) — caught by the validation check before reaching
 *     node-cron, so a bad expression in the DB can't crash the worker
 *   - reloadSchedules is idempotent + STOPS prior tasks for rows that
 *     were disabled / deleted (so a UI toggle takes effect)
 *
 * Note we do NOT actually fire cron jobs in unit tests (that'd burn
 * wall-clock seconds). The fire-handler logic itself is exercised
 * indirectly via the scheduler tests — once decideFire says go, the
 * worker just delegates to runScan + writes logs, all of which are
 * mocked here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  createScan: vi.fn(),
  createAgentLog: vi.fn(),
  // node-cron mock — we capture every schedule + stop call.
  schedule: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('node-cron', () => ({
  schedule: mocks.schedule,
}))

vi.mock('@/lib/db', () => ({
  db: {
    monitorSchedule: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    scan: { create: mocks.createScan },
    agentLog: { create: mocks.createAgentLog },
  },
}))

// Mock crypto so the worker import doesn't pull lib/env.ts (which
// fails fast in a test environment without ENCRYPTION_KEY loaded).
// We never actually encrypt/decrypt in these orchestration tests.
vi.mock('@/lib/crypto', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ''),
}))

// Mock the runner so the worker doesn't pull the entire scan pipeline
// (and its env-dependent dependencies) into the test.
vi.mock('@/lib/agent/runner', () => ({
  runScan: vi.fn(),
}))

// Mock the PR-state poller for the same reason.
vi.mock('@/lib/agent/learning/pr-state-poller', () => ({
  pollPrStates: vi.fn(),
}))

import { startMonitorWorker, reloadSchedules, shutdown } from '@/worker/monitor'

beforeEach(() => {
  mocks.findMany.mockReset()
  mocks.findUnique.mockReset()
  mocks.update.mockReset()
  mocks.createScan.mockReset()
  mocks.createAgentLog.mockReset()
  mocks.schedule.mockReset()
  mocks.stop.mockReset()
  // Every schedule() returns a fake task whose stop() goes through our
  // shared mock so we can assert teardown.
  mocks.schedule.mockImplementation(() => ({
    stop: mocks.stop,
    start: () => {},
    now: () => {},
  }))
})

// ── startMonitorWorker ───────────────────────────────────────────────────────

describe('startMonitorWorker', () => {
  it('registers ONE task per enabled row PLUS the PR-state poller', async () => {
    mocks.findMany.mockResolvedValueOnce([
      makeRow('alice/repo-a', '0 */6 * * *'),
      makeRow('bob/repo-b', '0 0 * * *'),
    ])
    await startMonitorWorker({
      runScanImpl: vi.fn() as never,
      pollPrStatesImpl: vi.fn() as never,
      skipSignalHandlers: true,
    })
    // 1 poller + 2 repo schedules = 3 schedule() calls.
    expect(mocks.schedule).toHaveBeenCalledTimes(3)
    // Verify the cron expressions we sent in match what node-cron received.
    const expressions = mocks.schedule.mock.calls.map((c) => c[0] as string)
    expect(expressions).toContain('*/10 * * * *') // PR poller cadence
    expect(expressions).toContain('0 */6 * * *')
    expect(expressions).toContain('0 0 * * *')
    await shutdown()
  })

  it('does NOT register tasks for disabled rows (the SQL findMany filter is the floor; this asserts the contract)', async () => {
    // Even when the DB returns a mix, the worker's findMany call uses
    // where: { enabled: true } — so only enabled rows arrive here.
    mocks.findMany.mockResolvedValueOnce([makeRow('alice/repo-a', '0 */6 * * *')])
    await startMonitorWorker({
      runScanImpl: vi.fn() as never,
      pollPrStatesImpl: vi.fn() as never,
      skipSignalHandlers: true,
    })
    expect(mocks.findMany).toHaveBeenCalledWith({ where: { enabled: true } })
    expect(mocks.schedule).toHaveBeenCalledTimes(2) // 1 poller + 1 repo
    await shutdown()
  })

  it('REFUSES a row with an invalid cron expression (no task registered for it)', async () => {
    mocks.findMany.mockResolvedValueOnce([
      makeRow('alice/repo-a', '0 */6 * * *'), // valid
      makeRow('bob/repo-b', 'BOGUS'), // invalid — must be skipped
    ])
    await startMonitorWorker({
      runScanImpl: vi.fn() as never,
      pollPrStatesImpl: vi.fn() as never,
      skipSignalHandlers: true,
    })
    const expressions = mocks.schedule.mock.calls.map((c) => c[0] as string)
    // BOGUS should not reach node-cron under any circumstances.
    expect(expressions).not.toContain('BOGUS')
    // Valid one + poller still register.
    expect(expressions).toContain('0 */6 * * *')
    expect(expressions).toContain('*/10 * * * *')
    await shutdown()
  })
})

// ── reloadSchedules ──────────────────────────────────────────────────────────

describe('reloadSchedules', () => {
  it('STOPS tasks for rows that were disabled / deleted (idempotent reload)', async () => {
    // First load: two repos enabled.
    mocks.findMany.mockResolvedValueOnce([
      makeRow('alice/repo-a', '0 */6 * * *'),
      makeRow('bob/repo-b', '0 0 * * *'),
    ])
    await startMonitorWorker({
      runScanImpl: vi.fn() as never,
      pollPrStatesImpl: vi.fn() as never,
      skipSignalHandlers: true,
    })
    const firstStopCount = mocks.stop.mock.calls.length

    // Second load: bob has been disabled (or removed). The reload should
    // stop bob's task; alice stays.
    mocks.findMany.mockResolvedValueOnce([makeRow('alice/repo-a', '0 */6 * * *')])
    await reloadSchedules({
      runScanFn: vi.fn() as never,
      nowFn: () => new Date('2026-06-01T12:00:00Z'),
    })

    // At least one stop() was called for bob's removed schedule. We
    // can't directly inspect which task was stopped (the mock is
    // shared) but the count must grow.
    expect(mocks.stop.mock.calls.length).toBeGreaterThan(firstStopCount)
    await shutdown()
  })
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(repoFullName: string, cronExpression: string) {
  return {
    id: `id-${repoFullName}`,
    repoFullName,
    repoUrl: `https://github.com/${repoFullName}`,
    cronExpression,
    enabled: true,
    encryptedPat: 'enc:test', // we never decrypt in these tests
    lastFiredAt: null,
    lastErrorAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId: null,
  }
}
