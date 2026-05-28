/**
 * Unit tests for v1.5 Workstream #7 — patching dispatcher (`patchFileSmart`).
 *
 * Mocks the two underlying patchers (`patchFile`, `patchFileViaBlocks`) so we
 * can prove the dispatch logic without touching the LLM or filesystem.
 *
 * What we verify:
 *   1. Missing file → strategyUsed='not-found', no patcher invoked
 *   2. package.json → always full-file regardless of size
 *   3. Small file (< 150 lines) → full-file
 *   4. Large file (≥ 150 lines) → search-replace tried first
 *   5. search-replace success → strategyUsed='search-replace', no fallback
 *   6. search-replace failure → strategyUsed='fallback-full-file', full-file called
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('@/lib/agent/patching/full-file', () => ({
  patchFile: vi.fn(),
}))
vi.mock('@/lib/agent/patching/search-replace-patcher', () => ({
  patchFileViaBlocks: vi.fn(),
}))

import { patchFileSmart } from '@/lib/agent/patching'
import { patchFile } from '@/lib/agent/patching/full-file'
import { patchFileViaBlocks } from '@/lib/agent/patching/search-replace-patcher'

const mockedFullFile = vi.mocked(patchFile)
const mockedBlocks = vi.mocked(patchFileViaBlocks)

const dep = { name: 'axios', currentVersion: '0.24.0', latestVersion: '0.27.2' } as never
const diagnosis = { summary: 's', impact: 'i', filesToModify: [], patchStrategy: 'targeted' } as never
const breakingChanges = [] as never

const fakePatch = {
  filePath: 'src/x.ts',
  originalContent: 'old',
  patchedContent: 'new',
  explanation: 'changed',
}

let tmpRoot: string
const emit = () => {} // no-op

beforeEach(async () => {
  vi.clearAllMocks()
  tmpRoot = await mkdtemp(join(tmpdir(), 'mendel-dispatch-test-'))
})
afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
})

async function writeFileAt(rel: string, lines: number): Promise<void> {
  const full = join(tmpRoot, rel)
  await mkdir(join(full, '..'), { recursive: true })
  const content = Array.from({ length: lines }, (_, i) => `// line ${i + 1}`).join('\n') + '\n'
  await writeFile(full, content, 'utf8')
}

describe('patchFileSmart — dispatcher', () => {
  it('returns not-found when file does not exist + invokes no patcher', async () => {
    const result = await patchFileSmart(tmpRoot, 'no/such/file.ts', dep, breakingChanges, diagnosis, emit)
    expect(result.strategyUsed).toBe('not-found')
    expect(result.patch).toBeNull()
    expect(mockedFullFile).not.toHaveBeenCalled()
    expect(mockedBlocks).not.toHaveBeenCalled()
  })

  it('package.json → always full-file (deterministic bumper)', async () => {
    await writeFileAt('package.json', 5)
    mockedFullFile.mockResolvedValue(fakePatch)
    const result = await patchFileSmart(tmpRoot, 'package.json', dep, breakingChanges, diagnosis, emit)
    expect(result.strategyUsed).toBe('full-file')
    expect(mockedFullFile).toHaveBeenCalledTimes(1)
    expect(mockedBlocks).not.toHaveBeenCalled()
  })

  it('small file (< 150 lines) → full-file', async () => {
    await writeFileAt('src/small.ts', 50)
    mockedFullFile.mockResolvedValue(fakePatch)
    const result = await patchFileSmart(tmpRoot, 'src/small.ts', dep, breakingChanges, diagnosis, emit)
    expect(result.strategyUsed).toBe('full-file')
    expect(result.lineCount).toBe(50)
    expect(mockedFullFile).toHaveBeenCalledTimes(1)
    expect(mockedBlocks).not.toHaveBeenCalled()
  })

  it('boundary: exactly 149 lines → still full-file', async () => {
    await writeFileAt('src/edge.ts', 149)
    mockedFullFile.mockResolvedValue(fakePatch)
    const result = await patchFileSmart(tmpRoot, 'src/edge.ts', dep, breakingChanges, diagnosis, emit)
    expect(result.strategyUsed).toBe('full-file')
  })

  it('boundary: exactly 150 lines → search-replace path', async () => {
    await writeFileAt('src/mid.ts', 150)
    mockedBlocks.mockResolvedValue({ patch: fakePatch, ok: true, failures: [], attempts: 1 })
    const result = await patchFileSmart(tmpRoot, 'src/mid.ts', dep, breakingChanges, diagnosis, emit)
    expect(result.strategyUsed).toBe('search-replace')
    expect(mockedBlocks).toHaveBeenCalledTimes(1)
    expect(mockedFullFile).not.toHaveBeenCalled()
  })

  it('large file (> 500 lines) → search-replace path', async () => {
    await writeFileAt('src/huge.ts', 800)
    mockedBlocks.mockResolvedValue({ patch: fakePatch, ok: true, failures: [], attempts: 1 })
    const result = await patchFileSmart(tmpRoot, 'src/huge.ts', dep, breakingChanges, diagnosis, emit)
    expect(result.strategyUsed).toBe('search-replace')
    expect(result.lineCount).toBe(800)
  })

  it('search-replace failure → falls back to full-file (strategyUsed=fallback-full-file)', async () => {
    await writeFileAt('src/large.ts', 300)
    mockedBlocks.mockResolvedValue({ patch: null, ok: false, failures: [], attempts: 2 })
    mockedFullFile.mockResolvedValue(fakePatch)
    const result = await patchFileSmart(tmpRoot, 'src/large.ts', dep, breakingChanges, diagnosis, emit)
    expect(result.strategyUsed).toBe('fallback-full-file')
    expect(mockedBlocks).toHaveBeenCalledTimes(1)
    expect(mockedFullFile).toHaveBeenCalledTimes(1)
    expect(result.patch).toEqual(fakePatch)
  })

  it('search-replace fallback that ALSO fails → returns null patch + fallback-full-file', async () => {
    await writeFileAt('src/large.ts', 300)
    mockedBlocks.mockResolvedValue({ patch: null, ok: false, failures: [], attempts: 2 })
    mockedFullFile.mockResolvedValue(null)
    const result = await patchFileSmart(tmpRoot, 'src/large.ts', dep, breakingChanges, diagnosis, emit)
    expect(result.strategyUsed).toBe('fallback-full-file')
    expect(result.patch).toBeNull()
  })
})
