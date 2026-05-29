/**
 * Unit tests for v1.5 Workstream #11 / PRD F17 — Extended Repo Support.
 *
 * Covers the pure detection helpers in lib/sandbox/detect.ts:
 *   - detectPackageManager: pnpm-lock / yarn.lock / package-lock / default
 *   - installCommand: per-PM install vs frozen variants
 *   - detectTestCommand: vitest / jest / script / nothing
 *   - hasBuildScript: scripts.build present
 *   - hasTsConfig: tsconfig.json present (the F17 keystone)
 *   - detectTestRunner: vitest / jest / script / none
 *
 * Each test writes a minimal fixture repo to a tmp dir + asserts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  detectPackageManager,
  installCommand,
  detectTestCommand,
  hasBuildScript,
  hasTsConfig,
  detectTestRunner,
  explainInstallFailure,
} from '@/lib/sandbox/detect'

let tmpRoot: string

async function makeRepo(label: string, layout: Record<string, string | object>): Promise<string> {
  const repo = join(tmpRoot, label)
  await mkdir(repo, { recursive: true })
  for (const [name, content] of Object.entries(layout)) {
    const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    await writeFile(join(repo, name), body, 'utf8')
  }
  return repo
}

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'mendel-detect-test-'))
})
afterAll(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
})

/* ─── detectPackageManager ────────────────────────────────────────────────── */

describe('detectPackageManager', () => {
  it('pnpm-lock.yaml → pnpm', async () => {
    const repo = await makeRepo('pm-pnpm', { 'pnpm-lock.yaml': '' })
    expect(detectPackageManager(repo)).toBe('pnpm')
  })
  it('yarn.lock → yarn', async () => {
    const repo = await makeRepo('pm-yarn', { 'yarn.lock': '' })
    expect(detectPackageManager(repo)).toBe('yarn')
  })
  it('only package-lock.json → npm (no pnpm/yarn lockfile)', async () => {
    const repo = await makeRepo('pm-npm', { 'package-lock.json': '{}' })
    expect(detectPackageManager(repo)).toBe('npm')
  })
  it('no lockfile at all → npm (safe default)', async () => {
    const repo = await makeRepo('pm-nolock', { 'package.json': '{}' })
    expect(detectPackageManager(repo)).toBe('npm')
  })
  it('pnpm wins over yarn when both lockfiles exist (project consistency)', async () => {
    const repo = await makeRepo('pm-both', { 'pnpm-lock.yaml': '', 'yarn.lock': '' })
    expect(detectPackageManager(repo)).toBe('pnpm')
  })
})

/* ─── installCommand ──────────────────────────────────────────────────────── */

describe('installCommand', () => {
  it('pnpm frozen vs unfrozen', () => {
    expect(installCommand('pnpm', true)).toContain('--frozen-lockfile')
    expect(installCommand('pnpm', false)).toContain('--no-frozen-lockfile')
  })
  it('yarn frozen vs unfrozen', () => {
    expect(installCommand('yarn', true)).toContain('--frozen-lockfile')
    expect(installCommand('yarn', false)).toBe('yarn install')
  })
  it('npm frozen → ci, unfrozen → install', () => {
    expect(installCommand('npm', true)).toBe('npm ci')
    expect(installCommand('npm', false)).toBe('npm install')
  })
})

/* ─── detectTestCommand ───────────────────────────────────────────────────── */

describe('detectTestCommand', () => {
  it('vitest in devDependencies → pnpm exec vitest run (pnpm)', async () => {
    const repo = await makeRepo('test-vitest-pnpm', {
      'package.json': { devDependencies: { vitest: '^1.0.0' }, scripts: { test: 'vitest' } },
    })
    expect(detectTestCommand(repo, 'pnpm')).toBe('pnpm exec vitest run')
  })
  it('vitest with yarn package manager → yarn exec vitest run', async () => {
    const repo = await makeRepo('test-vitest-yarn', {
      'package.json': { devDependencies: { vitest: '^1.0.0' } },
    })
    expect(detectTestCommand(repo, 'yarn')).toBe('yarn exec vitest run')
  })
  it('vitest with npm → npx exec vitest run', async () => {
    const repo = await makeRepo('test-vitest-npm', {
      'package.json': { devDependencies: { vitest: '^1.0.0' } },
    })
    expect(detectTestCommand(repo, 'npm')).toBe('npx exec vitest run')
  })
  it('jest in deps + scripts.test → pm test --passWithNoTests', async () => {
    const repo = await makeRepo('test-jest', {
      'package.json': { devDependencies: { jest: '^29.0.0' }, scripts: { test: 'jest' } },
    })
    expect(detectTestCommand(repo, 'pnpm')).toBe('pnpm test -- --passWithNoTests')
    expect(detectTestCommand(repo, 'yarn')).toBe('yarn test -- --passWithNoTests')
    expect(detectTestCommand(repo, 'npm')).toBe('npx test -- --passWithNoTests')
  })
  it('scripts.test only (no recognized runner) → pm test', async () => {
    const repo = await makeRepo('test-script', {
      'package.json': { scripts: { test: 'echo running tests' } },
    })
    expect(detectTestCommand(repo, 'pnpm')).toBe('pnpm test')
  })
  it('scripts.test == "no test specified" → empty', async () => {
    const repo = await makeRepo('test-notest', {
      'package.json': { scripts: { test: 'echo no test specified' } },
    })
    expect(detectTestCommand(repo, 'pnpm')).toBe('')
  })
  it('no package.json → empty', async () => {
    const repo = await makeRepo('test-nopkg', {})
    expect(detectTestCommand(repo, 'pnpm')).toBe('')
  })
})

/* ─── hasBuildScript ──────────────────────────────────────────────────────── */

describe('hasBuildScript', () => {
  it('scripts.build present → true', async () => {
    const repo = await makeRepo('build-yes', { 'package.json': { scripts: { build: 'tsc' } } })
    expect(hasBuildScript(repo)).toBe(true)
  })
  it('scripts.build missing → false', async () => {
    const repo = await makeRepo('build-no', { 'package.json': { scripts: { test: 'vitest' } } })
    expect(hasBuildScript(repo)).toBe(false)
  })
  it('no package.json → false', async () => {
    const repo = await makeRepo('build-nopkg', {})
    expect(hasBuildScript(repo)).toBe(false)
  })
})

/* ─── hasTsConfig (F17 keystone) ──────────────────────────────────────────── */

describe('hasTsConfig — JS-only repo detection (F17 keystone)', () => {
  it('tsconfig.json present → true', async () => {
    const repo = await makeRepo('ts-yes', { 'tsconfig.json': '{}' })
    expect(hasTsConfig(repo)).toBe(true)
  })
  it('tsconfig.json absent → false (treated as JS-only)', async () => {
    const repo = await makeRepo('ts-no', { 'package.json': '{}' })
    expect(hasTsConfig(repo)).toBe(false)
  })
  it('non-standard tsconfig path → false (conservative default)', async () => {
    const repo = await makeRepo('ts-nonstd', {
      'package.json': '{}',
      // tsconfig.build.json — not the canonical location
      'tsconfig.build.json': '{}',
    })
    expect(hasTsConfig(repo)).toBe(false)
  })
})

/* ─── detectTestRunner ────────────────────────────────────────────────────── */

describe('detectTestRunner', () => {
  it('vitest wins when present', async () => {
    const repo = await makeRepo('tr-vitest', { 'package.json': { devDependencies: { vitest: '^1' } } })
    expect(detectTestRunner(repo)).toBe('vitest')
  })
  it('jest detected when present', async () => {
    const repo = await makeRepo('tr-jest', { 'package.json': { devDependencies: { jest: '^29' } } })
    expect(detectTestRunner(repo)).toBe('jest')
  })
  it('vitest beats jest when BOTH listed (vitest is the modern default)', async () => {
    const repo = await makeRepo('tr-both', {
      'package.json': { devDependencies: { vitest: '^1', jest: '^29' } },
    })
    expect(detectTestRunner(repo)).toBe('vitest')
  })
  it('scripts.test only → script', async () => {
    const repo = await makeRepo('tr-script', { 'package.json': { scripts: { test: 'mocha' } } })
    expect(detectTestRunner(repo)).toBe('script')
  })
  it('nothing test-related → none', async () => {
    const repo = await makeRepo('tr-none', { 'package.json': '{}' })
    expect(detectTestRunner(repo)).toBe('none')
  })
  it('no package.json → none', async () => {
    const repo = await makeRepo('tr-nopkg', {})
    expect(detectTestRunner(repo)).toBe('none')
  })
  it('malformed package.json → none (no throw)', async () => {
    const repo = await makeRepo('tr-bad', { 'package.json': 'not-json' })
    expect(detectTestRunner(repo)).toBe('none')
  })
})

describe('explainInstallFailure', () => {
  // The real ERESOLVE output reproduced from megadave19/Antarang-Portfolio when
  // bumping @react-three/fiber 8→9 (which requires react@>=19) on a react@18 repo.
  const eresolve = `npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error While resolving: antarang-portfolio@1.0.0
npm error Found: react@18.3.1
npm error Could not resolve dependency:
npm error peer react@">=19 <19.3" from @react-three/fiber@9.6.1
npm error node_modules/@react-three/fiber
npm error Fix the upstream dependency conflict, or retry this command with --force or --legacy-peer-deps`

  it('extracts the conflicting peer + the package demanding it (the Antarang case)', () => {
    const msg = explainInstallFailure(eresolve)
    expect(msg).toContain('peer-dependency conflict')
    expect(msg).toContain('@react-three/fiber@9.6.1')
    expect(msg).toContain('react')
    expect(msg).toContain('>=19 <19.3')
  })

  it('falls back to a generic ERESOLVE message when the peer line is absent', () => {
    const msg = explainInstallFailure('npm error code ERESOLVE\nnpm error unable to resolve dependency tree')
    expect(msg).toContain('ERESOLVE')
  })

  it('recognizes network/registry failures (allowlist hint)', () => {
    expect(explainInstallFailure('npm error network getaddrinfo ENOTFOUND registry.npmjs.org')).toMatch(/network|allowlist/i)
  })

  it('recognizes ENOSPC (disk)', () => {
    expect(explainInstallFailure('npm error nospc ENOSPC: no space left on device')).toMatch(/disk/i)
  })

  it('recognizes a missing package-manager binary (the yarn-not-in-image bug)', () => {
    expect(explainInstallFailure('/bin/sh: yarn: not found')).toMatch(/sandbox image|Mendel sandbox/i)
    expect(explainInstallFailure('sh: 1: yarn: command not found')).toMatch(/sandbox image|Mendel sandbox/i)
  })

  it('returns null for unrecognized / empty output (caller logs the raw tail)', () => {
    expect(explainInstallFailure('some unrelated build noise')).toBeNull()
    expect(explainInstallFailure('')).toBeNull()
  })
})
