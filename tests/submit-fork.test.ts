/**
 * Unit tests for the fork-aware PR submission path (2026-05-28 fix).
 *
 * The bug: submitDraftPR pushed the fix branch directly to the UPSTREAM repo.
 * For any repo the user can't write to (every repo they don't own — e.g.
 * sindresorhus/execa), the push 403'd and no PR opened. There was no fork path.
 *
 * These tests mock @/lib/github + simple-git so we can prove the dispatch
 * WITHOUT network/git, locking in:
 *   - write access  → push to upstream, PR head = "<branch>" (no fork)
 *   - no write access → fork, push to fork, PR head = "<forkOwner>:<branch>",
 *     and the PR is still created on the UPSTREAM owner/repo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { StaleDep } from '@/lib/agent/phases/detect'
import type { Diagnosis } from '@/lib/agent/phases/diagnose'
import type { FilePatch } from '@/lib/agent/patching/full-file'

vi.mock('simple-git', () => ({
  default: vi.fn(() => ({
    remote: vi.fn().mockResolvedValue(undefined),
    checkoutLocalBranch: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('@/lib/github', () => ({
  findOpenPRsByHeadPattern: vi.fn().mockResolvedValue([]),
  canPushToRepo: vi.fn(),
  ensureFork: vi.fn(),
  createDraftPR: vi.fn().mockResolvedValue('https://github.com/sindresorhus/execa/pull/999'),
}))

import { submitDraftPR } from '@/lib/agent/phases/submit'
import { canPushToRepo, ensureFork, createDraftPR } from '@/lib/github'

const dep: StaleDep = { name: 'execa', currentVersion: '1.0.0', latestVersion: '2.0.0' }
const diagnosis = { summary: 's', impact: 'i', filesToModify: [] } as unknown as Diagnosis
const patches = [{ filePath: 'src/x.ts', explanation: 'e', newContent: '' }] as unknown as FilePatch[]

function run() {
  return submitDraftPR(
    '/tmp/repo', 'sindresorhus', 'execa', 'main',
    dep, [], diagnosis, patches, true, 'tok', () => {}, null, 'draft',
  )
}

beforeEach(() => vi.clearAllMocks())

describe('submitDraftPR — fork-aware submission', () => {
  it('write access → pushes to upstream, head is the bare branch (no fork)', async () => {
    vi.mocked(canPushToRepo).mockResolvedValue(true)
    await run()
    expect(ensureFork).not.toHaveBeenCalled()
    const opts = vi.mocked(createDraftPR).mock.calls[0][3]
    expect(opts.head).not.toContain(':')
    expect(opts.head).toContain('mendel/deps/execa')
    // PR opened on the upstream repo
    expect(vi.mocked(createDraftPR).mock.calls[0][1]).toBe('sindresorhus')
    expect(vi.mocked(createDraftPR).mock.calls[0][2]).toBe('execa')
  })

  it('no write access → forks, head is "forkOwner:branch", PR still on upstream', async () => {
    vi.mocked(canPushToRepo).mockResolvedValue(false)
    vi.mocked(ensureFork).mockResolvedValue({ owner: 'megadave19', repo: 'execa' })
    await run()
    expect(ensureFork).toHaveBeenCalledWith('tok', 'sindresorhus', 'execa')
    const opts = vi.mocked(createDraftPR).mock.calls[0][3]
    expect(opts.head).toBe(`megadave19:${(opts.head as string).split(':')[1]}`)
    expect(opts.head.startsWith('megadave19:mendel/deps/execa')).toBe(true)
    // PR is created on the UPSTREAM repo, not the fork
    expect(vi.mocked(createDraftPR).mock.calls[0][1]).toBe('sindresorhus')
    expect(vi.mocked(createDraftPR).mock.calls[0][2]).toBe('execa')
  })

  it('existing Mendel PR → dedup short-circuits before any push/fork', async () => {
    const { findOpenPRsByHeadPattern } = await import('@/lib/github')
    vi.mocked(findOpenPRsByHeadPattern).mockResolvedValueOnce([
      { number: 7, title: 't', url: 'https://github.com/sindresorhus/execa/pull/7', headRef: 'mendel/deps/execa-x', draft: true },
    ])
    vi.mocked(canPushToRepo).mockResolvedValue(true)
    const result = await run()
    expect(result.skipped).toBe(true)
    expect(canPushToRepo).not.toHaveBeenCalled()
    expect(createDraftPR).not.toHaveBeenCalled()
  })
})
