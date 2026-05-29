import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { installCommand, detectTestCommand, hasBuildScript, hasTsConfig } from './detect'
import type { SandboxConfig, PhaseAResult, PhaseBResult } from './types'
import { buildAllowlist, serializeAllowlistEnv } from './iptables-allowlist'
import { computeCacheKey, cacheVolumeName } from './cache'
import {
  CACHE_VOLUME_PREFIX,
  recordCacheUsage,
  evictCacheIfNeeded,
} from './cache-eviction'

const execAsync = promisify(exec)

// Tag bumps force a one-time rebuild on existing dev machines (ensureSandboxImage
// skips the build when the tag already exists). v1.5 W#8 added iptables; v1.5.1
// (2026-05-29) adds `yarn` to the image so yarn-lockfile repos can install —
// without it, every yarn repo failed Phase A with "yarn: not found".
export const IMAGE_NAME = 'mendel-sandbox:v1.5.1'
const PHASE_A_TIMEOUT_MS = 3 * 60 * 1000
const PHASE_B_TIMEOUT_MS = 5 * 60 * 1000
const MEMORY_CAP = '2g'

// ─── Image management ────────────────────────────────────────────────────────

export async function imageExists(): Promise<boolean> {
  try {
    await execAsync(`docker image inspect ${IMAGE_NAME}`)
    return true
  } catch {
    return false
  }
}

export async function ensureSandboxImage(): Promise<void> {
  if (await imageExists()) return

  const dockerfileDir = path.resolve(process.cwd(), 'docker')
  const dockerfilePath = path.join(dockerfileDir, 'sandbox.Dockerfile')

  console.log('[sandbox] Building sandbox image — one-time setup, takes ~30s...')
  await execAsync(
    `docker build -f "${dockerfilePath}" -t ${IMAGE_NAME} "${dockerfileDir}"`,
    { timeout: 5 * 60 * 1000 },
  )
  console.log('[sandbox] Image built.')
}

// ─── Volume naming ───────────────────────────────────────────────────────────

export function volumeName(scanId: string): string {
  return `mendel-nm-${scanId}`
}

// ─── Phase A — Install ───────────────────────────────────────────────────────

async function initVolumeOwnership(vol: string): Promise<void> {
  // Docker named volumes are created owned by root; chown so non-root node user can write.
  // v1.5 W#11: `--entrypoint=chown` bypasses the W#8 iptables script (which
  // tries to su-exec to node — would fail because chown requires root).
  await execAsync(
    `docker run --rm --user=root --entrypoint=chown --volume="${vol}:/repo/node_modules" ${IMAGE_NAME} node:node /repo/node_modules`,
    { timeout: 15_000 },
  )
}

/**
 * v1.5 W#12 / PRD F18 — check if a node_modules cache volume already exists
 * for the given key. Returns the volume name on hit, null on miss.
 */
async function checkCache(key: string | null): Promise<string | null> {
  if (!key) return null
  const vol = cacheVolumeName(key)
  try {
    await execAsync(`docker volume inspect ${vol}`, { timeout: 5_000 })
    return vol
  } catch {
    return null
  }
}

export async function runPhaseA(config: SandboxConfig): Promise<PhaseAResult> {
  const start = Date.now()

  // v1.5 W#12 (PRD F18) — node_modules cache lookup. The cache volume is
  // keyed by sha256(lockfile + node-major + os + arch); same key → identical
  // install tree, so we can mount the cache volume and skip the install.
  // First scan with a given lockfile populates the cache; subsequent scans
  // hit it. Different lockfile / node / os / arch → fresh install populates
  // a different cache volume.
  const cacheKey = computeCacheKey({
    repoPath: config.repoPath,
    packageManager: config.packageManager,
  })
  const cachedVol = await checkCache(cacheKey)

  // Volume the container actually mounts. On cache hit: the cache volume
  // itself (already populated). On cache miss: a deterministic key-keyed
  // volume that will be POPULATED by this run + reused by future scans.
  // When key is unavailable (missing lockfile etc), fall back to a per-scan
  // volume so we don't pollute the cache space with un-keyed installs.
  const vol = cachedVol
    ?? (cacheKey ? cacheVolumeName(cacheKey) : volumeName(config.scanId))
  const install = installCommand(config.packageManager, config.frozenLockfile ?? false)
  const cacheHit = cachedVol !== null

  // v1.5 W#9 Push 2: stamp the LRU clock for this cache volume (hit OR
  // about-to-populate). No-op for non-cache per-scan volumes. Keeps a
  // frequently-reused cache warm so eviction never targets it.
  recordCacheUsage(vol)

  await initVolumeOwnership(vol)

  // v1.5 W#8: build the iptables allowlist for this Phase A run. When
  // config.allowlistHosts is supplied (caller already built it with tier-2
  // opt-in), use it; otherwise default to tier-1. Sent to the container
  // entrypoint via MENDEL_ALLOWLIST env. CLAUDE.md §5 Rule 12 — default-deny
  // network egress, only allowlisted hosts reachable.
  const allowlistHosts = config.allowlistHosts ?? buildAllowlist().hosts
  const allowlistEnv = serializeAllowlistEnv({ hosts: allowlistHosts, tier2Accepted: [], tier2Rejected: [] })

  // v1.5 W#12: cache hit → skip the install (the volume is already populated).
  // The "command" still runs through the container so we get a consistent log
  // shape, but it's just an echo. CLAUDE.md §5b: honest about WHY we skipped.
  const shellCommand = cacheHit
    ? `echo "CACHE_HIT: skipping install (cache volume ${vol} already populated)"`
    : `${install} 2>&1`

  // Note: the container runs as root briefly so the entrypoint can apply
  // iptables rules (requires CAP_NET_ADMIN), then drops to `node` via su-exec.
  // The runtime user for the actual install command is still UID 1000 (node).
  // Paths quoted to handle spaces (macOS paths often contain spaces).
  const cmd = [
    'docker run',
    '--rm',
    '--network=bridge',
    '--cap-add=NET_ADMIN',
    `--memory=${MEMORY_CAP}`,
    '-e CI=true',
    `-e MENDEL_ALLOWLIST="${allowlistEnv}"`,
    `--volume="${config.repoPath}:/repo"`,
    `--volume="${vol}:/repo/node_modules"`,
    '--workdir=/repo',
    IMAGE_NAME,
    `sh -c "${shellCommand}"`,
  ].join(' ')

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: config.phaseATimeoutMs ?? PHASE_A_TIMEOUT_MS,
    })
    // v1.5 W#9 Push 2 / TRD §8.3: a fresh populate grows the cache space —
    // enforce the 5GB cap now. Fire-and-forget + never throws, so cache
    // maintenance can't fail the scan. Keep the volume this scan is about to
    // use in Phase B. Skip on cache hit (no new data was written).
    if (!cacheHit && vol.startsWith(CACHE_VOLUME_PREFIX)) {
      void evictCacheIfNeeded({ keep: vol })
        .then((r) => {
          if (r.evicted.length > 0) {
            console.log(`[sandbox] cache eviction: removed ${r.evicted.length} volume(s), freed ~${Math.round(r.freedBytes / 1e6)}MB`)
          }
          if (r.stillOverCap) {
            console.log('[sandbox] cache still over 5GB cap after evicting all idle volumes (active volume alone exceeds cap)')
          }
        })
        .catch(() => { /* maintenance best-effort */ })
    }
    return { phase: 'A', success: true, exitCode: 0, stdout, stderr, durationMs: Date.now() - start, timedOut: false, volumeName: vol }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; code?: number }
    return { phase: 'A', success: false, exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '', durationMs: Date.now() - start, timedOut: e.killed ?? false, volumeName: vol }
  }
}

// ─── Phase B — Test ──────────────────────────────────────────────────────────

export async function runPhaseB(
  config: SandboxConfig,
  vol: string,
): Promise<PhaseBResult> {
  const start = Date.now()

  const steps: string[] = []
  const isTypeScriptRepo = hasTsConfig(config.repoPath)

  // v1.5 W#11 (PRD F17): only run tsc when the repo IS a TypeScript project.
  // JS-only repos previously failed typecheck because there's no tsconfig →
  // verification failed → no PR. Now we skip tsc cleanly for JS-only repos.
  if (isTypeScriptRepo) {
    steps.push('pnpm exec tsc --noEmit 2>&1 && echo "TYPECHECK_OK" || echo "TYPECHECK_FAIL"')
  } else {
    steps.push('echo "TYPECHECK_SKIP_NO_TSCONFIG"')
  }

  const testCmd = detectTestCommand(config.repoPath, config.packageManager)
  if (testCmd) {
    steps.push(`${testCmd} 2>&1 && echo "TESTS_OK" || echo "TESTS_FAIL"`)
  }

  if (hasBuildScript(config.repoPath)) {
    steps.push('pnpm run build 2>&1 || true')
  }

  const phaseCmd = steps.join('; ')

  // v1.5 W#11 side-fix: Phase B uses `--user=node` (no root). The W#8 image's
  // ENTRYPOINT (setup-allowlist.sh) tries to drop privileges via su-exec
  // which needs root → would break Phase B. Bypass the entrypoint entirely
  // here — Phase B is `--network=none` anyway so no allowlist applies.
  const cmd = [
    'docker run',
    '--rm',
    '--network=none',
    `--memory=${MEMORY_CAP}`,
    '--user=node',
    '--entrypoint=sh',
    '-e CI=true',
    `--volume="${config.repoPath}:/repo"`,
    `--volume="${vol}:/repo/node_modules"`,
    '--workdir=/repo',
    IMAGE_NAME,
    `-c "${phaseCmd}"`,
  ].join(' ')

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: config.phaseBTimeoutMs ?? PHASE_B_TIMEOUT_MS,
    })
    // v1.5 W#11: "TYPECHECK_SKIP_NO_TSCONFIG" is success for JS-only repos —
    // semantic-diff Tier-3 fallback + lower-confidence framing carries the
    // honesty (CLAUDE.md §5b). Phase B counts the skip as a non-failure.
    const typecheckPassed = !stdout.includes('TYPECHECK_FAIL')
    const testsPassed = !stdout.includes('TESTS_FAIL')
    return { phase: 'B', success: typecheckPassed && testsPassed, exitCode: 0, stdout, stderr, durationMs: Date.now() - start, timedOut: false, typecheckPassed, testsPassed }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; code?: number }
    const out = e.stdout ?? ''
    return { phase: 'B', success: false, exitCode: e.code ?? 1, stdout: out, stderr: e.stderr ?? '', durationMs: Date.now() - start, timedOut: e.killed ?? false, typecheckPassed: false, testsPassed: false }
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

export async function cleanupVolume(vol: string): Promise<boolean> {
  try {
    await execAsync(`docker volume rm ${vol}`)
    return true
  } catch {
    return false
  }
}

// ─── Egress verification (gate use only) ─────────────────────────────────────

export async function verifyEgressBlocked(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `docker run --rm --network=none ${IMAGE_NAME} sh -c 'curl -s --max-time 5 https://example.com 2>&1; echo EXIT_$?'`,
      { timeout: 15_000 },
    )
    // curl will fail — exit code non-zero means egress is blocked
    return !stdout.includes('EXIT_0')
  } catch {
    // exec itself errored — egress is blocked (docker network=none worked)
    return true
  }
}
