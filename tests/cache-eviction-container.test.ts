/**
 * v1.5 Workstream #9 Push 2 — REAL Docker cache-eviction integration test.
 *
 * The pure tests in cache-eviction.test.ts prove the planner + ledger. They
 * CANNOT prove the Docker seam: that listCacheVolumes actually finds our
 * volumes, cacheVolumeSizes reads real on-disk sizes, and evictCacheIfNeeded
 * removes the right volume while keeping the active one.
 *
 * This test:
 *   1. Creates two real cache-namespaced volumes (old + active)
 *   2. Writes ~3MB into each via a throwaway alpine container (real size)
 *   3. Seeds the ledger so "old" is least-recently-used
 *   4. Runs evictCacheIfNeeded with a 1MB cap, keeping "active"
 *   5. Asserts: "old" is gone, "active" survives, ledger pruned
 *   6. Cleans up
 *
 * Gated by DOCKER_INTEGRATION=1. Run via:
 *   DOCKER_INTEGRATION=1 pnpm test cache-eviction-container
 *
 * CLAUDE.md §11b.1: Docker orchestration verified against real containers.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const execFileAsync = promisify(execFile)
const ENABLE = process.env.DOCKER_INTEGRATION === '1'

// Unique suffix so parallel/re-runs don't collide. 12 hex chars after prefix
// so they look exactly like real cacheVolumeName() output.
const SUFFIX = Date.now().toString(16).slice(-12).padStart(12, '0')
const OLD_VOL = `mendel-nm-cache-old${SUFFIX}`.slice(0, 27)
const NEW_VOL = `mendel-nm-cache-new${SUFFIX}`.slice(0, 27)

async function createVolumeWithData(name: string, megabytes: number) {
  await execFileAsync('docker', ['volume', 'create', name], { timeout: 15_000 })
  // Write real bytes so `docker system df -v` reports a nonzero size.
  await execFileAsync(
    'docker',
    ['run', '--rm', '-v', `${name}:/d`, 'node:22-alpine',
      'dd', 'if=/dev/zero', 'of=/d/blob', 'bs=1M', `count=${megabytes}`],
    { timeout: 60_000 },
  )
}

async function volumeExists(name: string): Promise<boolean> {
  try {
    await execFileAsync('docker', ['volume', 'inspect', name], { timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!ENABLE)('cache eviction — real Docker volumes', () => {
  afterAll(async () => {
    // Best-effort cleanup regardless of assertion outcome.
    for (const v of [OLD_VOL, NEW_VOL]) {
      await execFileAsync('docker', ['volume', 'rm', '-f', v], { timeout: 15_000 }).catch(() => {})
    }
  })

  it('evicts the LRU volume over a tiny cap, keeps the active one, prunes the ledger', async () => {
    const { recordCacheUsage, readLedger, evictCacheIfNeeded } = await import('@/lib/sandbox/cache-eviction')

    const tmp = await mkdtemp(join(tmpdir(), 'mendel-evict-it-'))
    const ledgerPath = join(tmp, 'ledger.json')

    try {
      await createVolumeWithData(OLD_VOL, 3)
      await createVolumeWithData(NEW_VOL, 3)

      // Seed ledger: OLD used long ago, NEW just now.
      recordCacheUsage(NEW_VOL, ledgerPath)
      // Force OLD to be older by writing an explicit earlier timestamp.
      const { writeFileSync } = await import('node:fs')
      const led = readLedger(ledgerPath)
      led[OLD_VOL] = 1 // epoch ms = ancient
      writeFileSync(ledgerPath, JSON.stringify(led), 'utf8')

      // ~6MB total, cap 1MB → must evict. Keep NEW (the active scan's volume).
      const result = await evictCacheIfNeeded({ keep: NEW_VOL, capBytes: 1_000_000, ledgerPath })

      expect(result.evicted).toContain(OLD_VOL)
      expect(result.evicted).not.toContain(NEW_VOL)
      expect(result.totalBefore).toBeGreaterThan(1_000_000)

      // Real Docker state matches the plan.
      expect(await volumeExists(OLD_VOL)).toBe(false)
      expect(await volumeExists(NEW_VOL)).toBe(true)

      // Ledger entry for the evicted volume is pruned; the kept one remains.
      const after = readLedger(ledgerPath)
      expect(after[OLD_VOL]).toBeUndefined()
      expect(after[NEW_VOL]).toBeDefined()
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }, 180_000)
})
