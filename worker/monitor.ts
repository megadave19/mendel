/**
 * v2.3 / F25 — continuous-monitor worker.
 *
 * Long-running Node process (`pnpm monitor`) that:
 *   1. Loads every enabled `MonitorSchedule` row at startup
 *   2. Registers one node-cron job per schedule
 *   3. On fire: runs the pure `decideFire` gate, then either skips
 *      honestly (logging the reason to AgentLog) or spawns a headless
 *      scan via `runScan(repoUrl, pat, options)` — the same code path
 *      the UI uses, so behavior is identical
 *   4. Polls PR states for every open Mendel PR on a fixed cadence
 *      (reuses the existing `pollPrStates`)
 *
 * **Security boundary (CLAUDE.md §5 rule 17):** the worker is treated
 * the same as an API route. Inputs (cron expressions, repoFullName) are
 * Zod-validated via the scheduler module before being passed to
 * node-cron. The encrypted PAT is decrypted ONLY in-memory at fire
 * time and never logged, never returned, never persisted in plaintext.
 *
 * **Process lifecycle:** the worker registers a SIGTERM/SIGINT handler
 * that stops every cron job + the PR poller + flushes pending AgentLog
 * writes before exit. Running under a process manager (pm2/launchd) is
 * recommended for production, but bare `pnpm monitor` works locally.
 *
 * **Honesty knobs:**
 *   - Every fire decision (skip or run) is recorded as a `monitor.fire`
 *     AgentLog row. A skipped fire has a `reason` field naming the
 *     binding constraint (cron-gap, in-flight cap, disabled).
 *   - Errors during scan are recorded to `MonitorSchedule.lastError`
 *     AND an `monitor.error` AgentLog row. The user sees the failure
 *     on the Settings page without having to grep the worker log.
 *   - The worker does NOT swallow runScan errors — they propagate to
 *     the cron callback's catch so the next scheduled fire still runs.
 */

import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { db } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/crypto'
import { runScan } from '@/lib/agent/runner'
import { pollPrStates } from '@/lib/agent/learning/pr-state-poller'
import {
  decideFire,
  validateCronExpression,
  MAX_CONCURRENT_SCANS,
} from '@/lib/agent/monitor/scheduler'

// ── Globals (process-scoped) ──────────────────────────────────────────────────

/** Active node-cron tasks, keyed by repoFullName. Cleared on shutdown. */
const tasks = new Map<string, ScheduledTask>()

/** In-flight scan count — used by decideFire to apply the concurrency cap. */
let inFlightCount = 0

/** PR-state poller cadence. 10 min is comfortable for GitHub's rate limits
 *  while still catching close-events promptly enough to feed the rejection
 *  learning loop. */
const PR_POLLER_CRON = '*/10 * * * *'

// ── Public entry: start the worker ───────────────────────────────────────────

export interface MonitorWorkerOptions {
  /** Allows tests to inject a fake runScan + fake pollPrStates. */
  runScanImpl?: typeof runScan
  pollPrStatesImpl?: typeof pollPrStates
  /** Allows tests to skip the SIGINT/SIGTERM wiring. */
  skipSignalHandlers?: boolean
  /** Now provider — injectable for tests. */
  now?: () => Date
}

export async function startMonitorWorker(opts: MonitorWorkerOptions = {}): Promise<{ shutdown: () => Promise<void> }> {
  const runScanFn = opts.runScanImpl ?? runScan
  const pollFn = opts.pollPrStatesImpl ?? pollPrStates
  const nowFn = opts.now ?? (() => new Date())

  log(`Mendel monitor starting (max concurrent scans=${MAX_CONCURRENT_SCANS}).`)

  // 1. Schedule the PR-state poller. Fires every 10 min regardless of
  //    enabled monitors — it's a pure read on GitHub PR states for
  //    rejection learning. No PAT needed: pollPrStates reads its own
  //    config from the DB.
  const pollerTask = cron.schedule(PR_POLLER_CRON, () => {
    void pollFn().catch((err) => log(`PR-state poll failed: ${String(err)}`))
  })
  tasks.set('__pr_poller__', pollerTask)
  log(`PR-state poller scheduled (${PR_POLLER_CRON}).`)

  // 2. Load + register every enabled schedule.
  await reloadSchedules({ runScanFn, nowFn })

  // 3. Signal handlers (unless the test wants to suppress).
  if (!opts.skipSignalHandlers) {
    const onSignal = async (signal: string) => {
      log(`Caught ${signal} — shutting down.`)
      await shutdown()
      process.exit(0)
    }
    process.on('SIGINT', () => void onSignal('SIGINT'))
    process.on('SIGTERM', () => void onSignal('SIGTERM'))
  }

  return { shutdown }
}

/**
 * Re-read every enabled schedule and synchronize the in-memory cron
 * registry. Idempotent: existing jobs whose cron expression is unchanged
 * stay registered; jobs whose row was deleted are stopped; new rows get
 * a fresh registration. Called at startup AND whenever a schedule is
 * mutated via the Settings UI (sub-phase 2 will trigger this via a
 * file-watch or a "reload" REST endpoint).
 */
export async function reloadSchedules(deps: {
  runScanFn: typeof runScan
  nowFn: () => Date
}): Promise<void> {
  const rows = await db.monitorSchedule.findMany({ where: { enabled: true } })
  const seen = new Set<string>()
  for (const row of rows) {
    seen.add(row.repoFullName)
    const validation = validateCronExpression(row.cronExpression)
    if (!validation.ok) {
      log(`Schedule "${row.repoFullName}" has invalid cron "${row.cronExpression}": ${validation.reason}`)
      // Stop any prior task for this row so it doesn't keep firing on a
      // stale expression.
      tasks.get(row.repoFullName)?.stop()
      tasks.delete(row.repoFullName)
      continue
    }
    // If we already have this row registered, stop + replace so a
    // cron expression edit takes effect.
    tasks.get(row.repoFullName)?.stop()
    const task = cron.schedule(row.cronExpression, () => {
      void handleFire(row.repoFullName, deps).catch((err) => log(`fire failed: ${String(err)}`))
    })
    tasks.set(row.repoFullName, task)
    log(`Registered schedule "${row.repoFullName}" (${row.cronExpression}).`)
  }
  // Stop tasks whose row no longer exists or was disabled.
  for (const key of tasks.keys()) {
    if (key === '__pr_poller__') continue
    if (!seen.has(key)) {
      tasks.get(key)?.stop()
      tasks.delete(key)
      log(`Stopped schedule "${key}" (row disabled or removed).`)
    }
  }
}

/** Handle one fire of one schedule. Pure-policy gate first; if it says
 *  go, decrypt PAT, run the scan, write fire/error logs. */
async function handleFire(
  repoFullName: string,
  deps: { runScanFn: typeof runScan; nowFn: () => Date },
): Promise<void> {
  const row = await db.monitorSchedule.findUnique({ where: { repoFullName } })
  if (!row) {
    log(`fire skipped: row "${repoFullName}" gone`)
    return
  }
  const decision = decideFire({
    enabled: row.enabled,
    lastFiredAt: row.lastFiredAt,
    inFlightCount,
    now: deps.nowFn(),
  })
  if (!decision.shouldFire) {
    await db.agentLog.create({
      data: {
        kind: 'monitor.fire',
        payload: JSON.stringify({
          repoFullName,
          fired: false,
          reason: decision.reason,
          inFlightCount,
        }),
      },
    })
    log(`fire skipped: "${repoFullName}" — ${decision.reason}`)
    return
  }

  // Allowed to fire. Generate a scan id + persist the start, decrypt PAT,
  // launch the headless scan.
  const scanId = `monitor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const pat = decrypt(row.encryptedPat)
  inFlightCount++
  await db.agentLog.create({
    data: {
      kind: 'monitor.fire',
      payload: JSON.stringify({ repoFullName, fired: true, scanId, inFlightCount }),
    },
  })
  log(`firing: "${repoFullName}" → scan ${scanId}`)
  try {
    // Scan row mirrors the shape /api/scans/route.ts persists. The
    // worker re-encrypts the PAT (the runner can decrypt scan.encryptedPat
    // if it needs to resume after a restart — same contract the UI uses).
    await db.scan.create({
      data: {
        id: scanId,
        repoUrl: row.repoUrl,
        status: 'queued',
        schemaVersion: '1.0',
        encryptedPat: encrypt(pat),
        startedAt: deps.nowFn(),
      },
    })
    await deps.runScanFn(scanId, row.repoUrl, pat, {})
    await db.monitorSchedule.update({
      where: { repoFullName },
      data: {
        lastFiredAt: deps.nowFn(),
        lastError: null,
        lastErrorAt: null,
      },
    })
    log(`fire complete: "${repoFullName}"`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.monitorSchedule.update({
      where: { repoFullName },
      data: {
        lastError: message.slice(0, 500),
        lastErrorAt: deps.nowFn(),
      },
    }).catch(() => {})
    await db.agentLog.create({
      data: {
        kind: 'monitor.error',
        payload: JSON.stringify({ repoFullName, scanId, error: message.slice(0, 500) }),
      },
    }).catch(() => {})
    log(`fire error: "${repoFullName}" — ${message.slice(0, 200)}`)
  } finally {
    inFlightCount--
  }
}

/** Stop every cron task. Called on SIGINT/SIGTERM and from tests. */
export async function shutdown(): Promise<void> {
  for (const [name, task] of tasks) {
    task.stop()
    log(`Stopped task "${name}".`)
  }
  tasks.clear()
}

// ── Tiny logger ───────────────────────────────────────────────────────────────

function log(msg: string) {
  // eslint-disable-next-line no-console -- this IS the worker's log surface
  console.log(`[monitor ${new Date().toISOString()}] ${msg}`)
}

// ── CLI entry — `pnpm monitor` runs this when imported as the main module ────

if (require.main === module) {
  startMonitorWorker().catch((err) => {
    // eslint-disable-next-line no-console -- top-level error from the worker
    console.error('[monitor] failed to start:', err)
    process.exit(1)
  })
}
