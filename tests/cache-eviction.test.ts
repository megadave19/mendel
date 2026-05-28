/**
 * Unit tests for v1.5 Workstream #9 Push 2 / TRD §8.3 — cache eviction.
 *
 * Pure core (no Docker, no network):
 *   - parseHumanSize: Docker human sizes → bytes
 *   - planEviction: LRU selection, cap enforcement, keep-set, determinism
 *   - readLedger / recordCacheUsage: JSON ledger round-trip (real tmp file)
 *
 * The Docker-touching path (listCacheVolumes / cacheVolumeSizes /
 * evictCacheIfNeeded) is covered by the gated cache-eviction-container test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseHumanSize,
  planEviction,
  readLedger,
  recordCacheUsage,
  CACHE_CAP_BYTES,
  CACHE_VOLUME_PREFIX,
  type CacheVolumeInfo,
} from '@/lib/sandbox/cache-eviction'

let tmpRoot: string

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'mendel-evict-test-'))
})
afterAll(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
})

const GB = 1e9

function vol(name: string, sizeBytes: number, lastUsedAt: number): CacheVolumeInfo {
  return { name: `${CACHE_VOLUME_PREFIX}${name}`, sizeBytes, lastUsedAt }
}

/* ─── parseHumanSize ──────────────────────────────────────────────────────── */

describe('parseHumanSize', () => {
  it('parses Docker base-1000 sizes', () => {
    expect(parseHumanSize('0B')).toBe(0)
    expect(parseHumanSize('512B')).toBe(512)
    expect(parseHumanSize('1kB')).toBe(1_000)
    expect(parseHumanSize('1.5MB')).toBe(1_500_000)
    expect(parseHumanSize('1.481GB')).toBe(1_481_000_000)
    expect(parseHumanSize('2TB')).toBe(2e12)
  })
  it('tolerates whitespace + missing unit (bytes)', () => {
    expect(parseHumanSize('  42 ')).toBe(42)
    expect(parseHumanSize('100 MB')).toBe(1e8)
  })
  it('returns 0 for garbage (weightless — never inflates the total)', () => {
    expect(parseHumanSize('N/A')).toBe(0)
    expect(parseHumanSize('')).toBe(0)
    expect(parseHumanSize('abc')).toBe(0)
  })
})

/* ─── planEviction ────────────────────────────────────────────────────────── */

describe('planEviction', () => {
  it('evicts nothing when total ≤ cap', () => {
    const plan = planEviction([vol('a', 2 * GB, 1), vol('b', 2 * GB, 2)], 5 * GB)
    expect(plan.toEvict).toEqual([])
    expect(plan.freedBytes).toBe(0)
    expect(plan.stillOverCap).toBe(false)
  })

  it('evicts least-recently-used first until under cap', () => {
    // 3×2GB = 6GB > 5GB cap. Evict the single oldest (lastUsedAt=1) → 4GB ≤ 5GB.
    const plan = planEviction(
      [vol('new', 2 * GB, 300), vol('old', 2 * GB, 1), vol('mid', 2 * GB, 200)],
      5 * GB,
    )
    expect(plan.toEvict).toEqual([`${CACHE_VOLUME_PREFIX}old`])
    expect(plan.totalBefore).toBe(6 * GB)
    expect(plan.totalAfter).toBe(4 * GB)
    expect(plan.freedBytes).toBe(2 * GB)
  })

  it('evicts multiple oldest when one is not enough', () => {
    // 4×2GB = 8GB. Need ≤ 5GB → evict 2 oldest (4GB) → 4GB.
    const plan = planEviction(
      [vol('a', 2 * GB, 1), vol('b', 2 * GB, 2), vol('c', 2 * GB, 3), vol('d', 2 * GB, 4)],
      5 * GB,
    )
    expect(plan.toEvict).toEqual([`${CACHE_VOLUME_PREFIX}a`, `${CACHE_VOLUME_PREFIX}b`])
    expect(plan.totalAfter).toBe(4 * GB)
  })

  it('never evicts a kept (active-scan) volume', () => {
    // 3×2GB=6GB. The oldest is "old" but it's kept → evict next-oldest "mid".
    const keep = new Set([`${CACHE_VOLUME_PREFIX}old`])
    const plan = planEviction(
      [vol('old', 2 * GB, 1), vol('mid', 2 * GB, 2), vol('new', 2 * GB, 3)],
      5 * GB,
      keep,
    )
    expect(plan.toEvict).toEqual([`${CACHE_VOLUME_PREFIX}mid`])
    expect(plan.toEvict).not.toContain(`${CACHE_VOLUME_PREFIX}old`)
  })

  it('flags stillOverCap when the kept volume alone exceeds the cap', () => {
    const keep = new Set([`${CACHE_VOLUME_PREFIX}huge`])
    const plan = planEviction(
      [vol('huge', 7 * GB, 5), vol('small', 1 * GB, 1)],
      5 * GB,
      keep,
    )
    // small is evicted; huge can't be → still over cap, surfaced honestly.
    expect(plan.toEvict).toEqual([`${CACHE_VOLUME_PREFIX}small`])
    expect(plan.stillOverCap).toBe(true)
  })

  it('is deterministic: equal lastUsedAt ties break by name', () => {
    const plan = planEviction(
      [vol('zzz', 3 * GB, 100), vol('aaa', 3 * GB, 100)],
      5 * GB,
    )
    // 6GB > 5GB → evict one. Tie on time → "aaa" (lower name) goes first.
    expect(plan.toEvict).toEqual([`${CACHE_VOLUME_PREFIX}aaa`])
  })

  it('defaults to the 5GB cap', () => {
    const justUnder = planEviction([vol('a', CACHE_CAP_BYTES, 1)])
    expect(justUnder.toEvict).toEqual([])
    const over = planEviction([vol('a', CACHE_CAP_BYTES, 1), vol('b', 1, 2)])
    expect(over.toEvict).toEqual([`${CACHE_VOLUME_PREFIX}a`])
  })
})

/* ─── ledger round-trip ───────────────────────────────────────────────────── */

describe('cache-usage ledger', () => {
  it('records a cache volume + reads it back', () => {
    const path = join(tmpRoot, 'ledger-1.json')
    const name = `${CACHE_VOLUME_PREFIX}abc123abc123`
    const before = Date.now()
    recordCacheUsage(name, path)
    const ledger = readLedger(path)
    expect(ledger[name]).toBeGreaterThanOrEqual(before)
  })

  it('ignores non-cache volume names (per-scan volumes never enter the ledger)', () => {
    const path = join(tmpRoot, 'ledger-2.json')
    recordCacheUsage('mendel-nm-somescanid', path)
    expect(readLedger(path)).toEqual({})
  })

  it('returns {} for a missing ledger file', () => {
    expect(readLedger(join(tmpRoot, 'does-not-exist.json'))).toEqual({})
  })

  it('returns {} for corrupt JSON (never throws)', async () => {
    const path = join(tmpRoot, 'ledger-corrupt.json')
    await (await import('node:fs/promises')).writeFile(path, 'not-json{', 'utf8')
    expect(readLedger(path)).toEqual({})
  })

  it('persists multiple entries + drops non-numeric values', async () => {
    const path = join(tmpRoot, 'ledger-multi.json')
    recordCacheUsage(`${CACHE_VOLUME_PREFIX}aaaaaaaaaaaa`, path)
    recordCacheUsage(`${CACHE_VOLUME_PREFIX}bbbbbbbbbbbb`, path)
    const onDisk = JSON.parse(await readFile(path, 'utf8'))
    expect(Object.keys(onDisk)).toHaveLength(2)
    // Inject a bad value + confirm readLedger sanitizes it out.
    onDisk[`${CACHE_VOLUME_PREFIX}cccccccccccc`] = 'oops'
    await (await import('node:fs/promises')).writeFile(path, JSON.stringify(onDisk), 'utf8')
    const cleaned = readLedger(path)
    expect(Object.keys(cleaned)).toHaveLength(2)
    expect(cleaned[`${CACHE_VOLUME_PREFIX}cccccccccccc`]).toBeUndefined()
  })
})
