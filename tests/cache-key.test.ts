/**
 * Unit tests for v1.5 Workstream #12 / PRD F18 — node_modules caching.
 *
 * Pure module — no docker, no FS writes outside tmpRoot.
 *
 * Covers:
 *   - computeCacheKey: deterministic, lockfile-driven, returns null on missing
 *   - cacheVolumeName: hex validation, length, lowercase, prefix
 *   - Key changes when lockfile bytes / PM / node-major / OS / arch differ
 *   - Per-PM lockfile selection (pnpm-lock.yaml / yarn.lock / package-lock.json)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  computeCacheKey,
  cacheVolumeName,
  LOCKFILE_FOR_PM,
} from '@/lib/sandbox/cache'

let tmpRoot: string

async function makeRepo(label: string, lockfileName: string | null, content = 'lock-bytes'): Promise<string> {
  const repo = join(tmpRoot, label)
  await mkdir(repo, { recursive: true })
  if (lockfileName) {
    await writeFile(join(repo, lockfileName), content, 'utf8')
  }
  return repo
}

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'mendel-cache-test-'))
})
afterAll(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
})

/* ─── LOCKFILE_FOR_PM mapping ─────────────────────────────────────────────── */

describe('LOCKFILE_FOR_PM', () => {
  it('maps each package manager to its canonical lockfile name', () => {
    expect(LOCKFILE_FOR_PM.pnpm).toBe('pnpm-lock.yaml')
    expect(LOCKFILE_FOR_PM.yarn).toBe('yarn.lock')
    expect(LOCKFILE_FOR_PM.npm).toBe('package-lock.json')
  })
})

/* ─── computeCacheKey: nominal ────────────────────────────────────────────── */

describe('computeCacheKey', () => {
  it('returns a 64-char sha256 hex when lockfile exists', async () => {
    const repo = await makeRepo('basic', 'pnpm-lock.yaml')
    const key = computeCacheKey({ repoPath: repo, packageManager: 'pnpm' })
    expect(key).toBeTruthy()
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns null when lockfile is missing', async () => {
    const repo = await makeRepo('nolock', null)
    expect(computeCacheKey({ repoPath: repo, packageManager: 'pnpm' })).toBeNull()
  })

  it('reads the PM-specific lockfile (yarn → yarn.lock, npm → package-lock.json)', async () => {
    const yarnRepo = await makeRepo('y', 'yarn.lock')
    expect(computeCacheKey({ repoPath: yarnRepo, packageManager: 'yarn' })).toMatch(/^[0-9a-f]{64}$/)
    expect(computeCacheKey({ repoPath: yarnRepo, packageManager: 'pnpm' })).toBeNull() // wrong PM = no lockfile

    const npmRepo = await makeRepo('n', 'package-lock.json')
    expect(computeCacheKey({ repoPath: npmRepo, packageManager: 'npm' })).toMatch(/^[0-9a-f]{64}$/)
    expect(computeCacheKey({ repoPath: npmRepo, packageManager: 'pnpm' })).toBeNull()
  })
})

/* ─── computeCacheKey: determinism + sensitivity ──────────────────────────── */

describe('computeCacheKey — determinism + sensitivity to inputs', () => {
  it('same lockfile bytes + same env → same key (determinism)', async () => {
    const repo = await makeRepo('det', 'pnpm-lock.yaml', 'identical-bytes')
    const overrides = { nodeMajor: 22, osPlatform: 'linux', cpuArch: 'x64' }
    const a = computeCacheKey({ repoPath: repo, packageManager: 'pnpm', ...overrides })
    const b = computeCacheKey({ repoPath: repo, packageManager: 'pnpm', ...overrides })
    expect(a).toBe(b)
  })

  it('different lockfile bytes → different key', async () => {
    const repoA = await makeRepo('lf-a', 'pnpm-lock.yaml', 'bytes-A')
    const repoB = await makeRepo('lf-b', 'pnpm-lock.yaml', 'bytes-B')
    const overrides = { nodeMajor: 22, osPlatform: 'linux', cpuArch: 'x64' }
    const a = computeCacheKey({ repoPath: repoA, packageManager: 'pnpm', ...overrides })
    const b = computeCacheKey({ repoPath: repoB, packageManager: 'pnpm', ...overrides })
    expect(a).not.toBe(b)
  })

  it('different node major → different key', async () => {
    const repo = await makeRepo('node-major', 'pnpm-lock.yaml', 'same')
    const k22 = computeCacheKey({ repoPath: repo, packageManager: 'pnpm', nodeMajor: 22, osPlatform: 'linux', cpuArch: 'x64' })
    const k20 = computeCacheKey({ repoPath: repo, packageManager: 'pnpm', nodeMajor: 20, osPlatform: 'linux', cpuArch: 'x64' })
    expect(k22).not.toBe(k20)
  })

  it('different OS → different key (native modules differ)', async () => {
    const repo = await makeRepo('os', 'pnpm-lock.yaml', 'same')
    const linux = computeCacheKey({ repoPath: repo, packageManager: 'pnpm', nodeMajor: 22, osPlatform: 'linux', cpuArch: 'x64' })
    const darwin = computeCacheKey({ repoPath: repo, packageManager: 'pnpm', nodeMajor: 22, osPlatform: 'darwin', cpuArch: 'x64' })
    expect(linux).not.toBe(darwin)
  })

  it('different arch → different key (arm64 vs x64 native modules)', async () => {
    const repo = await makeRepo('arch', 'pnpm-lock.yaml', 'same')
    const x64 = computeCacheKey({ repoPath: repo, packageManager: 'pnpm', nodeMajor: 22, osPlatform: 'linux', cpuArch: 'x64' })
    const arm = computeCacheKey({ repoPath: repo, packageManager: 'pnpm', nodeMajor: 22, osPlatform: 'linux', cpuArch: 'arm64' })
    expect(x64).not.toBe(arm)
  })

  it('different PM → different key even with same lockfile bytes', async () => {
    // Same bytes in two different lockfile names — keys must still differ
    // because the install tree depends on which PM read it.
    const repoP = await makeRepo('pm-p', 'pnpm-lock.yaml', 'same')
    const repoY = await makeRepo('pm-y', 'yarn.lock', 'same')
    const overrides = { nodeMajor: 22, osPlatform: 'linux', cpuArch: 'x64' }
    const kP = computeCacheKey({ repoPath: repoP, packageManager: 'pnpm', ...overrides })
    const kY = computeCacheKey({ repoPath: repoY, packageManager: 'yarn', ...overrides })
    expect(kP).not.toBe(kY)
  })
})

/* ─── cacheVolumeName ─────────────────────────────────────────────────────── */

describe('cacheVolumeName', () => {
  it('produces a deterministic, predictable volume name from a key', () => {
    const key = 'a'.repeat(64)
    expect(cacheVolumeName(key)).toBe('mendel-nm-cache-aaaaaaaaaaaa')
  })

  it('truncates to 12 hex chars + lowercases', () => {
    const key = 'ABCDEF0123456789' + 'F'.repeat(48)
    const name = cacheVolumeName(key)
    expect(name).toBe('mendel-nm-cache-abcdef012345')
  })

  it('rejects non-hex input (shell-injection guard)', () => {
    expect(() => cacheVolumeName('not-hex; rm -rf /')).toThrow()
    expect(() => cacheVolumeName('aabb; whoami')).toThrow()
    expect(() => cacheVolumeName('')).toThrow()
  })

  it('rejects too-short input (< 12 chars)', () => {
    expect(() => cacheVolumeName('abcdef')).toThrow()
  })
})
