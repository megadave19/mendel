import { existsSync, readFileSync } from 'fs'
import path from 'path'

export type StaleDep = {
  name: string
  currentVersion: string
  latestVersion: string
}

// ─── npm registry ────────────────────────────────────────────────────────────

async function getLatestVersion(packageName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`)
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return data.version ?? null
  } catch {
    return null
  }
}

// ─── Version helpers ─────────────────────────────────────────────────────────

function parseVersion(range: string): string {
  // Strip semver range prefixes: ^, ~, >=, >, <=, <
  return range.replace(/^[^0-9]*/, '').split(/\s/)[0]
}

function isSignificantlyBehind(from: string, to: string): boolean {
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
): Promise<StaleDep[]> {
  const pkgPath = path.join(repoPath, 'package.json')
  if (!existsSync(pkgPath)) return []

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  }

  const stale: StaleDep[] = []

  for (const [name, range] of Object.entries(allDeps)) {
    // Skip @types packages and workspace references
    if (name.startsWith('@types/')) continue
    if (range.startsWith('workspace:') || range === '*' || range === 'latest') continue

    const current = parseVersion(range)
    if (!current) continue

    emit(`Checking ${name}@${current}...`)

    const latest = await getLatestVersion(name)
    if (!latest) continue

    if (isSignificantlyBehind(current, latest)) {
      emit(`  ⚠ ${name}: ${current} → ${latest}`)
      stale.push({ name, currentVersion: current, latestVersion: latest })
    }
  }

  return stale
}
