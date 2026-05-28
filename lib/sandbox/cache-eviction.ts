/**
 * v1.5 Workstream #9 Push 2 / TRD §8.3 — node_modules cache eviction.
 *
 * Push 1 (lib/sandbox/cache.ts) ships the cache key + volume naming + the
 * skip-install-on-hit semantics. This module enforces the 5GB cap TRD §8.3
 * mandates: "Cache eviction: oldest entries when total cache > 5GB".
 *
 * "Oldest" = least-recently-USED, not least-recently-created. A cache volume
 * that keeps getting hit must stay warm — evicting it would force a 60–120s
 * re-install on the very next scan, defeating the cache. Docker only tracks
 * `CreatedAt` (not access), so we keep our own last-used ledger and update it
 * on every cache hit + populate. Volumes with no ledger entry (e.g. created
 * before this module existed) fall back to Docker's `CreatedAt`.
 *
 * Shape of the module (mirrors cache.ts — pure core, thin IO seam):
 *   - parseHumanSize / planEviction   → PURE, fully unit-tested, no Docker
 *   - readLedger / recordCacheUsage    → JSON ledger file (atomic write)
 *   - listCacheVolumes / volumeSizes…  → Docker IO (gated integration test)
 *   - evictCacheIfNeeded               → orchestrator the executor calls
 *
 * Security: all Docker calls use `execFile` (no shell) with arguments passed
 * as an array — volume names can never be interpolated into a shell string,
 * so there's no command-injection surface even though the names come from
 * `docker volume ls` rather than user input.
 *
 * §5b honesty: if the single kept (active-scan) volume alone exceeds the cap,
 * we evict everything else and log that we're still over — we never evict the
 * volume the current scan is about to use in Phase B.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const execFileAsync = promisify(execFile)

/** Only the keyed cache space is subject to eviction — never per-scan or
 *  gate-fixture volumes. Matches cacheVolumeName() output in cache.ts. */
export const CACHE_VOLUME_PREFIX = 'mendel-nm-cache-'

/** 5 GiB cap per TRD §8.3. */
export const CACHE_CAP_BYTES = 5 * 1024 * 1024 * 1024

/** Default ledger location. Overridable per-call so tests stay hermetic. */
export const DEFAULT_LEDGER_PATH = join(process.cwd(), 'logs', 'cache-ledger.json')

export interface CacheVolumeInfo {
  name: string
  sizeBytes: number
  /** epoch ms of last use (ledger), or CreatedAt fallback, or 0 if unknown. */
  lastUsedAt: number
}

export interface EvictionPlan {
  toEvict: string[]
  totalBefore: number
  totalAfter: number
  freedBytes: number
  /** true when even after evicting all candidates we're still over cap
   *  (the kept active volume alone exceeds the cap). */
  stillOverCap: boolean
}

/* ─── PURE: human-size parsing ────────────────────────────────────────────── */

const SIZE_UNIT_MULTIPLIER: Record<string, number> = {
  b: 1,
  kb: 1e3, // Docker `system df` uses base-1000 (units.HumanSize): kB/MB/GB…
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  pb: 1e15,
}

/**
 * Parse a Docker human-readable size ("0B", "590.2MB", "1.481GB") to bytes.
 * Returns 0 for unparseable input — a cache volume we can't size is treated
 * as weightless so it never inflates the total (it'll still be evictable by
 * age once a sizeable volume forces a pass).
 */
export function parseHumanSize(s: string): number {
  const m = /^([\d.]+)\s*([a-zA-Z]*)$/.exec(s.trim())
  if (!m) return 0
  const value = Number(m[1])
  if (!Number.isFinite(value)) return 0
  const unit = (m[2] || 'b').toLowerCase()
  const mult = SIZE_UNIT_MULTIPLIER[unit] ?? (unit === '' ? 1 : 0)
  return Math.round(value * mult)
}

/* ─── PURE: eviction planning ─────────────────────────────────────────────── */

/**
 * Decide which cache volumes to evict so total ≤ capBytes. Evicts
 * least-recently-used first (oldest lastUsedAt). `keep` names are never
 * evicted (the active scan's volume). Deterministic: ties on lastUsedAt
 * break by name so the plan is reproducible.
 */
export function planEviction(
  volumes: CacheVolumeInfo[],
  capBytes: number = CACHE_CAP_BYTES,
  keep: ReadonlySet<string> = new Set(),
): EvictionPlan {
  const totalBefore = volumes.reduce((sum, v) => sum + v.sizeBytes, 0)
  if (totalBefore <= capBytes) {
    return { toEvict: [], totalBefore, totalAfter: totalBefore, freedBytes: 0, stillOverCap: false }
  }

  const candidates = volumes
    .filter((v) => !keep.has(v.name))
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.name.localeCompare(b.name))

  let total = totalBefore
  const toEvict: string[] = []
  for (const c of candidates) {
    if (total <= capBytes) break
    toEvict.push(c.name)
    total -= c.sizeBytes
  }

  return {
    toEvict,
    totalBefore,
    totalAfter: total,
    freedBytes: totalBefore - total,
    stillOverCap: total > capBytes,
  }
}

/* ─── Ledger (JSON file, atomic write) ────────────────────────────────────── */

type Ledger = Record<string, number>

export function readLedger(path: string = DEFAULT_LEDGER_PATH): Ledger {
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Ledger = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
      }
      return out
    }
    return {}
  } catch {
    return {}
  }
}

function writeLedger(ledger: Ledger, path: string = DEFAULT_LEDGER_PATH): void {
  mkdirSync(dirname(path), { recursive: true })
  // Atomic write: temp + rename so a crash can't leave a half-written ledger
  // that readLedger would discard (losing all access times).
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8')
  renameSync(tmp, path)
}

/**
 * Record that a cache volume was just used (hit or populate). Updates its
 * lastUsedAt so the LRU clock reflects real usage. No-op for non-cache
 * volumes so per-scan volumes never enter the ledger.
 */
export function recordCacheUsage(volumeName: string, path: string = DEFAULT_LEDGER_PATH): void {
  if (!volumeName.startsWith(CACHE_VOLUME_PREFIX)) return
  const ledger = readLedger(path)
  ledger[volumeName] = Date.now()
  writeLedger(ledger, path)
}

/* ─── Docker IO (execFile — no shell, args as array) ──────────────────────── */

/** List existing cache volume names (only the keyed cache space). */
export async function listCacheVolumes(): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'docker',
    ['volume', 'ls', '--quiet', '--filter', `name=${CACHE_VOLUME_PREFIX}`],
    { timeout: 10_000 },
  )
  return stdout.split('\n').map((s) => s.trim()).filter(Boolean)
}

/** Map cache-volume name → size in bytes via `docker system df -v`. */
export async function cacheVolumeSizes(): Promise<Map<string, number>> {
  const { stdout } = await execFileAsync(
    'docker',
    ['system', 'df', '-v', '--format', '{{json .Volumes}}'],
    { timeout: 30_000 },
  )
  const sizes = new Map<string, number>()
  try {
    const arr = JSON.parse(stdout) as Array<{ Name?: string; Size?: string }>
    for (const v of arr) {
      if (v?.Name && v.Name.startsWith(CACHE_VOLUME_PREFIX)) {
        sizes.set(v.Name, parseHumanSize(v.Size ?? '0B'))
      }
    }
  } catch {
    // Unparseable df output → empty map; caller treats all as weightless.
  }
  return sizes
}

/** Docker CreatedAt (epoch ms) for a volume, or 0 if unavailable. */
async function volumeCreatedAt(name: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['volume', 'inspect', name, '--format', '{{.CreatedAt}}'],
      { timeout: 5_000 },
    )
    const t = Date.parse(stdout.trim())
    return Number.isFinite(t) ? t : 0
  } catch {
    return 0
  }
}

export interface EvictionResult {
  evicted: string[]
  freedBytes: number
  totalBefore: number
  totalAfter: number
  stillOverCap: boolean
  /** volumes whose `docker volume rm` failed (e.g. still in use). */
  failed: string[]
}

/**
 * Enforce the cache cap. Lists cache volumes, sizes them, resolves last-used
 * (ledger → CreatedAt fallback), plans LRU eviction keeping the active scan's
 * volume, removes the planned volumes, and prunes their ledger entries.
 *
 * Designed to be fire-and-forget from the executor (errors are captured in
 * the result, never thrown) so cache maintenance can't fail a scan.
 */
export async function evictCacheIfNeeded(opts: {
  keep?: string
  capBytes?: number
  ledgerPath?: string
} = {}): Promise<EvictionResult> {
  const capBytes = opts.capBytes ?? CACHE_CAP_BYTES
  const ledgerPath = opts.ledgerPath ?? DEFAULT_LEDGER_PATH
  const keep = new Set<string>(opts.keep ? [opts.keep] : [])

  const empty: EvictionResult = {
    evicted: [], freedBytes: 0, totalBefore: 0, totalAfter: 0, stillOverCap: false, failed: [],
  }

  let names: string[]
  try {
    names = await listCacheVolumes()
  } catch {
    return empty
  }
  if (names.length === 0) return empty

  const sizes = await cacheVolumeSizes()
  const ledger = readLedger(ledgerPath)

  const volumes: CacheVolumeInfo[] = []
  for (const name of names) {
    const lastUsedAt = ledger[name] ?? (await volumeCreatedAt(name))
    volumes.push({ name, sizeBytes: sizes.get(name) ?? 0, lastUsedAt })
  }

  const plan = planEviction(volumes, capBytes, keep)
  if (plan.toEvict.length === 0) {
    return { ...empty, totalBefore: plan.totalBefore, totalAfter: plan.totalAfter }
  }

  const evicted: string[] = []
  const failed: string[] = []
  const nextLedger = { ...ledger }
  for (const name of plan.toEvict) {
    try {
      await execFileAsync('docker', ['volume', 'rm', name], { timeout: 15_000 })
      evicted.push(name)
      delete nextLedger[name]
    } catch {
      failed.push(name) // likely still in use; leave it + its ledger entry
    }
  }
  writeLedger(nextLedger, ledgerPath)

  return {
    evicted,
    failed,
    freedBytes: plan.freedBytes,
    totalBefore: plan.totalBefore,
    totalAfter: plan.totalAfter,
    stillOverCap: plan.stillOverCap,
  }
}
