/**
 * Unit tests for the surgical package.json version bump (2026-05-29 fix).
 *
 * The bug: bumpPackageJson did JSON.parse → JSON.stringify(pkg, null, 2), which
 * reformatted the WHOLE file (tabs→spaces, forced 2-space indent) — a 1-line
 * change showed as a 103-line diff on execa and failed its lint. It also
 * hardcoded "^", silently changing pinned deps.
 *
 * patchFile('package.json', …) takes the deterministic path (no LLM), so we can
 * test it directly with a temp repo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { patchFile } from '@/lib/agent/patching/full-file'
import type { StaleDep } from '@/lib/agent/phases/detect'
import type { Diagnosis } from '@/lib/agent/phases/diagnose'

const diagnosis = { summary: 's', impact: 'i', filesToModify: [], patchStrategy: 'x' } as unknown as Diagnosis
const noop = () => {}

// Tab-indented package.json (like execa) with several range styles + a decoy key.
const PKG = [
  '{',
  '\t"name": "demo",',
  '\t"dependencies": {',
  '\t\t"is-in-ci": "^1.0.0",',
  '\t\t"is-in-ci-extra": "^1.0.0",',
  '\t\t"pinned": "1.2.3",',
  '\t\t"tilded": "~1.0.0"',
  '\t}',
  '}',
  '',
].join('\n')

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pkgbump-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function bump(dep: StaleDep): Promise<string> {
  await writeFile(join(dir, 'package.json'), PKG, 'utf-8')
  const patch = await patchFile(dir, 'package.json', dep, [], diagnosis, noop)
  return patch!.patchedContent
}

describe('surgical package.json bump', () => {
  it('bumps only the target version and PRESERVES tabs (no whole-file reformat)', async () => {
    const out = await bump({ name: 'is-in-ci', currentVersion: '1.0.0', latestVersion: '2.0.0' })
    expect(out).toContain('\t\t"is-in-ci": "^2.0.0"') // tab indent + caret preserved
    // Every other line is byte-identical → minimal diff.
    const changed = PKG.split('\n').filter((line, i) => line !== out.split('\n')[i])
    expect(changed).toEqual(['\t\t"is-in-ci": "^1.0.0",'])
  })

  it('exact match — does NOT touch a same-prefix key (is-in-ci-extra)', async () => {
    const out = await bump({ name: 'is-in-ci', currentVersion: '1.0.0', latestVersion: '2.0.0' })
    expect(out).toContain('"is-in-ci-extra": "^1.0.0"') // unchanged
  })

  it('preserves the original range operator — exact pin stays pinned', async () => {
    const out = await bump({ name: 'pinned', currentVersion: '1.2.3', latestVersion: '2.0.0' })
    expect(out).toContain('"pinned": "2.0.0"') // no caret added
  })

  it('preserves a tilde range', async () => {
    const out = await bump({ name: 'tilded', currentVersion: '1.0.0', latestVersion: '2.0.0' })
    expect(out).toContain('"tilded": "~2.0.0"')
  })

  it('dep absent from manifest → file left unchanged, honest explanation', async () => {
    await writeFile(join(dir, 'package.json'), PKG, 'utf-8')
    const patch = await patchFile(dir, 'package.json', { name: 'ghost', currentVersion: '1.0.0', latestVersion: '2.0.0' }, [], diagnosis, noop)
    expect(patch!.patchedContent).toBe(PKG)
    expect(patch!.explanation.toLowerCase()).toContain('no version entry')
  })
})
