import { existsSync, readFileSync } from 'fs'
import path from 'path'
import type { PackageManager } from './types'

export function detectPackageManager(repoPath: string): PackageManager {
  if (existsSync(path.join(repoPath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(repoPath, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

export function installCommand(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm install --frozen-lockfile --store-dir=/tmp/pnpm-store'
    case 'yarn':
      return 'yarn install --frozen-lockfile'
    case 'npm':
      return 'npm ci'
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
