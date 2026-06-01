/**
 * Tests for the v2.2 / F23 core language abstraction layer.
 *
 * Covers:
 *   - typescriptAdapter.detect against real tmp directories (no fs mocks —
 *     the whole point of detect is filesystem shape)
 *   - registry: selectAdapter returns the TS adapter for a JS/TS repo,
 *     returns NULL for a plain Python repo (proves we don't silently
 *     default to TS — the §5b honesty rule)
 *   - the adapter advertises the right max bucket + image + manifest
 *     (cheap pin against accidental drift)
 *
 * §5b assertions baked in: a non-matching repo gets `null`, not "TS as
 * fallback." That keeps the runner honest when adapters are missing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { typescriptAdapter } from '@/lib/agent/lang/typescript'
import { selectAdapter, registeredAdapters } from '@/lib/agent/lang/registry'

let repo: string
beforeEach(() => { repo = mkdtempSync(path.join(tmpdir(), 'mendel-lang-')) })
afterEach(() => { try { rmSync(repo, { recursive: true, force: true }) } catch { /* tmp reaper */ } })

function file(rel: string, content: string) {
  const abs = path.join(repo, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

// ── typescriptAdapter.detect ──────────────────────────────────────────────────

describe('typescriptAdapter.detect', () => {
  it('matches a plain JS repo with only package.json', () => {
    file('package.json', '{}')
    const d = typescriptAdapter.detect(repo)
    expect(d.detected).toBe(true)
    expect(d.indicators).toEqual(['package.json'])
  })

  it('matches a TS repo with package.json + tsconfig.json', () => {
    file('package.json', '{}')
    file('tsconfig.json', '{}')
    const d = typescriptAdapter.detect(repo)
    expect(d.detected).toBe(true)
    expect(d.indicators).toEqual(['package.json', 'tsconfig.json'])
  })

  it('does NOT match a Python-only repo (no package.json)', () => {
    file('pyproject.toml', '[project]\nname = "x"\n')
    file('src/x.py', 'print(1)\n')
    const d = typescriptAdapter.detect(repo)
    expect(d.detected).toBe(false)
    expect(d.indicators).toEqual([])
  })

  it('does NOT match an empty repo', () => {
    expect(typescriptAdapter.detect(repo).detected).toBe(false)
  })
})

// ── selectAdapter (registry) ──────────────────────────────────────────────────

describe('selectAdapter', () => {
  it('returns the TypeScript adapter for a JS/TS repo', () => {
    file('package.json', JSON.stringify({ name: 'x' }))
    const a = selectAdapter(repo)
    expect(a).not.toBeNull()
    expect(a?.id).toBe('typescript')
  })

  it('returns the Python adapter for a Python-only repo (F23a landed)', () => {
    // F23 core (v2.2.0) returned null here — F23a (v2.2.x) registered the
    // Python adapter ahead of TypeScript. This test flipped to assert the
    // honest, capability-aware return.
    file('pyproject.toml', '[project]\nname = "x"\n')
    file('src/x.py', 'print(1)\n')
    const a = selectAdapter(repo)
    expect(a).not.toBeNull()
    expect(a?.id).toBe('python')
  })

  it('routes a polyglot repo (Python + JS) to Python — more-specific wins', () => {
    // V2_PLAN §F23 registry priority: Python before TypeScript so a repo
    // with BOTH manifests routes to Python.
    file('pyproject.toml', '[project]\nname = "x"\n')
    file('package.json', JSON.stringify({ name: 'tooling' }))
    expect(selectAdapter(repo)?.id).toBe('python')
  })

  it('returns null for an empty repo (no manifest at all)', () => {
    expect(selectAdapter(repo)).toBeNull()
  })
})

// ── Adapter contract pins (cheap, prevents accidental drift) ──────────────────

describe('typescriptAdapter contract', () => {
  it('declares the correct max bucket — high (tsc on .d.ts is the strongest signal)', () => {
    expect(typescriptAdapter.maxBucket).toBe('high')
  })
  it('declares the correct manifest file', () => {
    expect(typescriptAdapter.manifestFile).toBe('package.json')
  })
  it('declares a sandboxImage tag matching the existing node image', () => {
    // Pinned to whatever IMAGE_NAME the executor exports — a drift here
    // would break the existing test:docker suite.
    expect(typescriptAdapter.sandboxImage).toMatch(/^mendel-sandbox:/)
  })
})

describe('registeredAdapters', () => {
  it('exposes the registered list (v2.2.x ships TS + Python)', () => {
    const ids = registeredAdapters().map((a) => a.id)
    expect(ids).toEqual(['python', 'typescript'])
  })
})
