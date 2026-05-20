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
