import { existsSync, readFileSync } from 'fs'
import path from 'path'

export type StaleDep = {
  name: string
  currentVersion: string
  latestVersion: string
}

export interface DetectResult {
  stale: StaleDep[]
  /** deps whose latest version was successfully resolved */
  checked: number
  /** deps whose lookup FAILED (rate-limit / network) — staleness unknown for these */
  failed: number
}

/**
 * Result of a single latest-version lookup. The discriminated `ok` is the fix
 * for a silent honesty bug: previously ANY failure (rate-limit, network) was
 * collapsed to `null` and treated as "not stale" — indistinguishable from a
 * genuinely-current dep. After many scans npm rate-limits the lookups, so a
 * whole scan reported "0 stale" ("nothing happened") when it had actually
 * checked nothing. Now `ok:false` = "couldn't check" ≠ `version:null` = 404.
 */
type LatestLookup = { ok: true; version: string | null } | { ok: false }

// ─── npm registry ────────────────────────────────────────────────────────────

const NPM_UA = 'mendel-dependency-agent'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getLatestVersion(packageName: string): Promise<LatestLookup> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`
  // Retry transient failures (429 rate-limit, 5xx, network) with backoff. A
  // User-Agent header materially reduces npm throttling of anonymous requests.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': NPM_UA, Accept: 'application/json' } })
      if (res.status === 429 || res.status >= 500) {
        await sleep(400 * (attempt + 1))
        continue
      }
      if (res.status === 404) return { ok: true, version: null } // genuinely not published
      if (!res.ok) return { ok: false } // other error → "couldn't check"
      const data = (await res.json()) as { version?: string }
      return { ok: true, version: data.version ?? null }
    } catch {
      await sleep(300 * (attempt + 1))
    }
  }
  return { ok: false } // persistent failure — staleness genuinely unknown
}

// ─── Version helpers ─────────────────────────────────────────────────────────

export function parseVersion(range: string): string {
  // Strip semver range prefixes: ^, ~, >=, >, <=, <
  return range.replace(/^[^0-9]*/, '').split(/\s/)[0]
}

export function isSignificantlyBehind(from: string, to: string): boolean {
  const fp = from.split('.').map(Number)
  const tp = to.split('.').map(Number)
  if (isNaN(fp[0]) || isNaN(tp[0])) return false
  if (tp[0] > fp[0]) return true // major bump
  if (tp[0] === fp[0] && (tp[1] ?? 0) > (fp[1] ?? 0) + 2) return true // 3+ minor bumps
  return false
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function detectStaleDeps(
  repoPath: string,
  emit: (msg: string) => void,
): Promise<DetectResult> {
  const pkgPath = path.join(repoPath, 'package.json')
  if (!existsSync(pkgPath)) return { stale: [], checked: 0, failed: 0 }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }

  const stale: StaleDep[] = []
  let checked = 0
  let failed = 0

  for (const [name, range] of Object.entries(allDeps)) {
    // Skip @types packages and workspace references
    if (name.startsWith('@types/')) continue
    if (range.startsWith('workspace:') || range === '*' || range === 'latest') continue

    const current = parseVersion(range)
    if (!current) continue

    emit(`Checking ${name}@${current}...`)

    const lookup = await getLatestVersion(name)
    if (!lookup.ok) {
      // Couldn't check — NOT the same as "current". Counted so the runner can
      // be honest instead of reporting a misleading "0 stale" (§5b).
      failed++
      continue
    }
    checked++
    if (!lookup.version) continue

    if (isSignificantlyBehind(current, lookup.version)) {
      emit(`  ⚠ ${name}: ${current} → ${lookup.version}`)
      stale.push({ name, currentVersion: current, latestVersion: lookup.version })
    }
  }

  if (failed > 0) {
    emit(
      `⚠ ${failed} dependency lookup${failed === 1 ? '' : 's'} failed (npm registry error or rate limit) — ` +
        `staleness is INCOMPLETE for ${failed} dep${failed === 1 ? '' : 's'}. Re-run in a minute.`,
    )
  }
  emit(`Checked ${checked} dependenc${checked === 1 ? 'y' : 'ies'} · ${stale.length} significantly stale${failed ? ` · ${failed} unchecked` : ''}.`)

  return { stale, checked, failed }
}
