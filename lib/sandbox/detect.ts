import { existsSync, readFileSync } from 'fs'
import path from 'path'
import type { PackageManager } from './types'

export function detectPackageManager(repoPath: string): PackageManager {
  if (existsSync(path.join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(repoPath, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

export function installCommand(pm: PackageManager, frozen = false): string {
  switch (pm) {
    case 'pnpm':
      // frozen=true only for initial installs where lockfile is known-good;
      // after patching package.json the lockfile is stale so we must update it
      return frozen
        ? 'pnpm install --frozen-lockfile --store-dir=/tmp/pnpm-store'
        : 'pnpm install --no-frozen-lockfile --store-dir=/tmp/pnpm-store'
    case 'yarn':
      return frozen ? 'yarn install --frozen-lockfile' : 'yarn install'
    case 'npm':
      // npm ci requires lockfile match; npm install updates it
      return frozen ? 'npm ci' : 'npm install'
  }
}

/**
 * Turn a failed-install output blob into a human-readable cause. The install
 * command runs with `2>&1`, so the captured stdout carries the npm/pnpm/yarn
 * error. Previously a Phase-A failure surfaced only "install failed" with the
 * real reason thrown away (it was stored in the SSE 'verify' event but never
 * shown as a log line). §5b: be honest about *what* happened, not just *that*
 * it failed.
 *
 * The most common cause for a dependency upgrade is a peer-dependency conflict
 * (npm ERESOLVE): bumping a package to a major that requires a newer peer than
 * the repo pins — e.g. `@react-three/fiber@9` needs `react@>=19` but the repo
 * is on react@18. That's a genuine "this upgrade can't install without a
 * coordinated migration", not a Mendel defect — so we report it clearly and
 * let the agent skip honestly rather than force `--legacy-peer-deps`.
 *
 * Returns null when no pattern matches (caller still logs the raw output tail).
 */
export function explainInstallFailure(installOutput: string): string | null {
  if (!installOutput) return null

  // npm ERESOLVE — try to name the conflicting peer + the package demanding it.
  if (/ERESOLVE/i.test(installOutput)) {
    const m = installOutput.match(/peer (\S+?)@"([^"]+)" from (\S+?)@(\S+)/)
    if (m) {
      const [, peerName, peerRange, fromPkg, fromVer] = m
      return (
        `peer-dependency conflict — ${fromPkg}@${fromVer} requires ${peerName}@"${peerRange}", ` +
        `which the repo doesn't satisfy. This upgrade can't install without a coordinated bump of ` +
        `${peerName} (npm refuses by default; forcing --legacy-peer-deps would produce an unverified, ` +
        `possibly broken tree).`
      )
    }
    return 'peer-dependency conflict (npm ERESOLVE) — the upgrade is incompatible with a dependency currently pinned in the repo.'
  }

  // pnpm / yarn unmet-peer escalation
  if (/unmet peer dependenc/i.test(installOutput) || /peer dependencies that are not installed/i.test(installOutput)) {
    return 'unmet peer dependency — the upgrade requires a peer version the repo does not currently satisfy.'
  }

  // network / registry — likely the Phase-A allowlist (tier-1) blocking a host
  if (/ETIMEDOUT|ENOTFOUND|ECONNREFUSED|getaddrinfo|EAI_AGAIN/i.test(installOutput)) {
    return 'network error during install — a required host may be outside the sandbox allowlist (Phase A tier-1). If it is a known binary registry, retry with tier-2 opt-in.'
  }

  // disk
  if (/ENOSPC/i.test(installOutput)) {
    return 'out of disk space in the sandbox during install.'
  }

  return null
}

export function detectTestCommand(repoPath: string, pm: PackageManager): string {
  const pkgPath = path.join(repoPath, 'package.json')
  if (!existsSync(pkgPath)) return ''

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
    dependencies?: Record<string, string>
  }

  const scripts = pkg.scripts ?? {}
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
  const runner = pm === 'pnpm' ? 'pnpm' : pm === 'yarn' ? 'yarn' : 'npx'

  if ('vitest' in allDeps) return `${runner} exec vitest run`
  if ('jest' in allDeps && scripts.test) return `${runner} test -- --passWithNoTests`
  if (scripts.test && !scripts.test.includes('no test')) return `${runner} test`

  return ''
}

export function hasBuildScript(repoPath: string): boolean {
  const pkgPath = path.join(repoPath, 'package.json')
  if (!existsSync(pkgPath)) return false
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> }
  return Boolean(pkg.scripts?.build)
}

/**
 * v1.5 W#11 (PRD F17) — detect whether the target repo has a TypeScript
 * project. JS-only repos (no tsconfig.json) are still accepted but skip the
 * Phase B tsc step. The semantic-diff signal already auto-falls-back to AST
 * Tier-3 for these repos; the lower confidence is surfaced naturally.
 *
 * Detection rule: tsconfig.json exists at repo root (the standard location).
 * Repos that use a non-standard tsconfig path are treated as JS-only — the
 * trade-off is "false-negative leaves typecheck off" rather than "false-
 * positive runs tsc with no config and fails," which is the safer default.
 */
export function hasTsConfig(repoPath: string): boolean {
  return existsSync(path.join(repoPath, 'tsconfig.json'))
}

/**
 * v1.5 W#11 — detect the test runner used by the repo. Returns the runner
 * name (for logs + UI) plus the actual shell command from detectTestCommand.
 * Supports vitest, jest, and "package-script-only" (when scripts.test exists
 * but no recognized runner is in deps).
 */
export type TestRunner = 'vitest' | 'jest' | 'script' | 'none'
export function detectTestRunner(repoPath: string): TestRunner {
  const pkgPath = path.join(repoPath, 'package.json')
  if (!existsSync(pkgPath)) return 'none'
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      scripts?: Record<string, string>
      devDependencies?: Record<string, string>
      dependencies?: Record<string, string>
    }
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    if ('vitest' in allDeps) return 'vitest'
    if ('jest' in allDeps) return 'jest'
    if (pkg.scripts?.test && !pkg.scripts.test.includes('no test')) return 'script'
    return 'none'
  } catch {
    return 'none'
  }
}
