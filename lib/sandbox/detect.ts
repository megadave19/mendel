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
