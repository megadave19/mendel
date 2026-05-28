/**
 * v1.5 Workstream #12 / PRD F18 / TRD §8.3 — node_modules layered caching.
 *
 * Pure helpers. The executor consults these to:
 *   1. Compute a deterministic cache key from lockfile + runtime fingerprint
 *   2. Map the key to a Docker named volume that holds a populated node_modules
 *   3. Decide whether to skip Phase A install (cache hit) or populate (miss)
 *
 * Cache correctness contract:
 *   The key COMMITS to:
 *     - lockfile bytes (lockfile uniquely determines installed tree)
 *     - Node major version (native modules differ across majors)
 *     - OS family (linux/darwin/etc — sandbox image is alpine-linux but the
 *       host OS doesn't affect node_modules; we still include it for safety)
 *     - CPU arch (arm64 vs x64 — native modules differ)
 *   When ANY of these differ, the key changes → different volume → fresh install.
 *
 * §5b honesty:
 *   - Cache key MUST be deterministic — same inputs → same hex. Tests assert.
 *   - When lockfile is missing or unreadable, key derivation returns null and
 *     the caller proceeds without cache (better to install than to silently
 *     hit a stale cache).
 *
 * v1.5 Push 1 ships the key + volume-name machinery and the executor wiring.
 * LRU eviction (5GB cap per spec) is Push 2 — independent concern, can be a
 * background prune or a manual op without changing the cache-hit semantics.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PackageManager } from './types'

/** The lockfile name per package manager, in priority order matching detect.ts. */
export const LOCKFILE_FOR_PM: Record<PackageManager, string> = {
  pnpm: 'pnpm-lock.yaml',
  yarn: 'yarn.lock',
  npm: 'package-lock.json',
}

export interface CacheKeyInput {
  /** Absolute path to the repo root (where the lockfile lives). */
  repoPath: string
  /** Detected package manager (selects which lockfile to hash). */
  packageManager: PackageManager
  /**
   * Optional overrides — exposed so tests can pin a deterministic fingerprint.
   * Production callers leave undefined; we then read the live values.
   */
  nodeMajor?: number
  osPlatform?: string
  cpuArch?: string
}

/**
 * Compute the cache key from lockfile + runtime fingerprint. Returns null when
 * the lockfile is missing or unreadable — caller proceeds without cache.
 *
 * Hash is sha256 of a canonical JSON envelope (key order pinned) so any change
 * to any field produces a different key.
 */
export function computeCacheKey(input: CacheKeyInput): string | null {
  const lockfileName = LOCKFILE_FOR_PM[input.packageManager]
  const lockfilePath = join(input.repoPath, lockfileName)
  if (!existsSync(lockfilePath)) return null

  let lockfileBytes: Buffer
  try {
    lockfileBytes = readFileSync(lockfilePath)
  } catch {
    return null
  }

  // Canonical envelope. Pin key order so JSON.stringify is deterministic.
  const envelope = JSON.stringify({
    arch: input.cpuArch ?? process.arch,
    lockfileSha256: createHash('sha256').update(lockfileBytes).digest('hex'),
    nodeMajor: input.nodeMajor ?? readNodeMajor(),
    os: input.osPlatform ?? process.platform,
    pm: input.packageManager,
  })
  return createHash('sha256').update(envelope).digest('hex')
}

function readNodeMajor(): number {
  // process.versions.node is "22.4.0"; we keep major only.
  const v = process.versions.node ?? '0.0.0'
  return Number(v.split('.')[0]) || 0
}

/**
 * Map a cache key to its Docker volume name. Truncates to 12 hex chars so
 * the volume name is human-readable in `docker volume ls`, but the keyspace
 * remains 48 bits = 2^48 = enough for any realistic cache size before
 * collisions become likely (~16M entries at 50% collision risk).
 */
export function cacheVolumeName(key: string): string {
  // Defensive: validate input is hex so we can't accidentally inject arbitrary
  // shell chars into a volume name.
  if (!/^[0-9a-f]+$/i.test(key) || key.length < 12) {
    throw new Error('cacheVolumeName: input must be hex string of length ≥ 12')
  }
  return `mendel-nm-cache-${key.slice(0, 12).toLowerCase()}`
}

/** Test-only export. */
export const __testing = { readNodeMajor }
