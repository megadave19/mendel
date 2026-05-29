/**
 * Tests for stale-dependency detection (2026-05-29 honesty + retry fix).
 *
 * The bug: a failed npm lookup (rate-limit/network) was collapsed to "not
 * stale", so after many scans a repo reported "0 stale — nothing happened"
 * when it had actually checked nothing. Now: lookups retry on 429/5xx, and a
 * failure is COUNTED (`failed`) and distinguished from a genuine 404.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { isSignificantlyBehind, parseVersion } from '@/lib/agent/phases/detect'

describe('parseVersion', () => {
  it('strips range operators', () => {
    expect(parseVersion('^1.2.3')).toBe('1.2.3')
    expect(parseVersion('~2.0.0')).toBe('2.0.0')
    expect(parseVersion('>=3.1.0 <4')).toBe('3.1.0')
    expect(parseVersion('4.5.6')).toBe('4.5.6')
  })
})

describe('isSignificantlyBehind', () => {
  it('flags a major bump', () => {
    expect(isSignificantlyBehind('1.0.0', '2.0.0')).toBe(true)
  })
  it('flags 3+ minor bumps within the same major', () => {
    expect(isSignificantlyBehind('1.2.0', '1.5.0')).toBe(true)
    expect(isSignificantlyBehind('1.2.0', '1.4.0')).toBe(false) // only 2 minors
  })
  it('does not flag a patch or small bump', () => {
    expect(isSignificantlyBehind('1.2.3', '1.2.9')).toBe(false)
    expect(isSignificantlyBehind('2.0.0', '2.0.0')).toBe(false)
  })
  it('returns false on unparseable versions (no false positive)', () => {
    expect(isSignificantlyBehind('next', '2.0.0')).toBe(false)
  })
})

// getLatestVersion is internal; exercise it through a fetch mock to prove the
// honesty + retry behavior. We import the module fresh and stub global fetch.
describe('latest-version lookup honesty (via detectStaleDeps fetch behavior)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('retries on 429 then succeeds (rate-limit resilience)', async () => {
    const { detectStaleDeps } = await import('@/lib/agent/phases/detect')
    // Make a temp package.json with one stale dep
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = await mkdtemp(join(tmpdir(), 'detect-'))
    await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { foo: '^1.0.0' } }))

    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      if (calls === 1) return new Response('', { status: 429 })
      return new Response(JSON.stringify({ version: '3.0.0' }), { status: 200 })
    }))

    const res = await detectStaleDeps(dir, () => {})
    expect(calls).toBeGreaterThanOrEqual(2) // retried
    expect(res.failed).toBe(0)
    expect(res.checked).toBe(1)
    expect(res.stale).toHaveLength(1) // 1.0.0 → 3.0.0 is a major bump
  })

  it('counts a persistent failure as `failed`, NOT as "not stale"', async () => {
    const { detectStaleDeps } = await import('@/lib/agent/phases/detect')
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const dir = await mkdtemp(join(tmpdir(), 'detect-'))
    await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: { foo: '^1.0.0' } }))

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })))

    const res = await detectStaleDeps(dir, () => {})
    expect(res.failed).toBe(1)
    expect(res.checked).toBe(0)
    expect(res.stale).toHaveLength(0) // unknown, not "current"
  })
})
