/**
 * Tests for the v2.2 / F23b Go adapter (sub-phase 1).
 *
 * Covers:
 *   - Detection: `go.mod` is the binding indicator; `go.sum`/`go.work`
 *     alone don't qualify
 *   - `go.mod` parser: single-line + block `require` directives, the
 *     `// indirect` annotation (excluded honestly), `replace`/`exclude`/
 *     `retract` blocks (surfaced as unparsedSections, NOT silently dropped)
 *   - `encodeGoModulePath`: uppercase-letter escape per Go modules spec
 *   - `lookupLatestGoVersion`: ok / not-ok branches via injected fetch
 *   - The honest semantic-diff stub returns analyzable-but-empty data
 *     with a clear reason — confidence stays capped until apidiff lands
 *     in F23b sub-phase 2.
 *
 * Real tmp directories — no fs mocks; the whole point is filesystem-shape
 * parsing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  goAdapter,
  parseGoMod,
  encodeGoModulePath,
  lookupLatestGoVersion,
} from '@/lib/agent/lang/go'

let repo: string
beforeEach(() => { repo = mkdtempSync(path.join(tmpdir(), 'mendel-go-')) })
afterEach(() => { rmSync(repo, { recursive: true, force: true }) })

// ── parseGoMod ────────────────────────────────────────────────────────────────

describe('parseGoMod', () => {
  it('reads the module directive', () => {
    const out = parseGoMod(`module example.com/widget\n\ngo 1.21\n`)
    expect(out.modulePath).toBe('example.com/widget')
  })

  it('parses a single-line require', () => {
    const out = parseGoMod(`module x\n\nrequire github.com/foo/bar v1.2.3\n`)
    expect(out.requires.get('github.com/foo/bar')).toBe('v1.2.3')
  })

  it('parses a block require', () => {
    const out = parseGoMod(
      `module x\n\nrequire (\n  github.com/foo/bar v1.2.3\n  golang.org/x/sync v0.5.0\n)\n`,
    )
    expect(out.requires.get('github.com/foo/bar')).toBe('v1.2.3')
    expect(out.requires.get('golang.org/x/sync')).toBe('v0.5.0')
  })

  it('EXCLUDES `// indirect` requires (they are computed, not declared) and surfaces them honestly', () => {
    // §5b: dropping silently would misrepresent the dep surface. The
    // adapter routes indirect deps to a separate field so the runner can
    // log them rather than counting them as direct staleness candidates.
    const out = parseGoMod(
      `module x\n\nrequire (\n  github.com/foo/bar v1.2.3\n  github.com/baz/qux v0.1.0 // indirect\n)\n`,
    )
    expect(out.requires.get('github.com/foo/bar')).toBe('v1.2.3')
    expect(out.requires.has('github.com/baz/qux')).toBe(false)
    expect(out.indirectRequires).toContain('github.com/baz/qux')
  })

  it("surfaces `replace`/`exclude`/`retract` blocks as unparsedSections (NEVER silently dropped)", () => {
    const out = parseGoMod(
      `module x\n\nrequire github.com/foo/bar v1.2.3\n\nreplace (\n  github.com/foo/bar => ../local-fork\n)\n\nexclude github.com/baz v0.0.1\n`,
    )
    expect(out.unparsedSections).toContain('replace')
    expect(out.unparsedSections).toContain('exclude')
  })

  it('ignores `go` + `toolchain` directives (not deps)', () => {
    const out = parseGoMod(`module x\n\ngo 1.21\ntoolchain go1.22.0\n\nrequire github.com/a/b v1.0.0\n`)
    expect(out.requires.size).toBe(1)
    expect(out.unparsedSections).toEqual([])
  })

  it('handles end-of-line comments on non-require lines', () => {
    const out = parseGoMod(`module example.com/x // primary module\n\nrequire github.com/a/b v1.0.0\n`)
    expect(out.modulePath).toBe('example.com/x')
    expect(out.requires.get('github.com/a/b')).toBe('v1.0.0')
  })
})

// ── encodeGoModulePath ────────────────────────────────────────────────────────

describe('encodeGoModulePath (Go modules spec — uppercase escape)', () => {
  it('escapes capital letters as !lower', () => {
    expect(encodeGoModulePath('github.com/Foo/Bar')).toBe('github.com/!foo/!bar')
  })

  it('leaves lowercase paths untouched', () => {
    expect(encodeGoModulePath('github.com/foo/bar')).toBe('github.com/foo/bar')
  })

  it('handles mixed-case identifiers', () => {
    expect(encodeGoModulePath('example.com/MyOrg/MyMod')).toBe('example.com/!my!org/!my!mod')
  })
})

// ── lookupLatestGoVersion (injected fetch — no real network) ──────────────────

describe('lookupLatestGoVersion', () => {
  it('returns ok=true with the Version field on success', async () => {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ Version: 'v2.5.1', Time: '2026-01-01' }),
    } as Response)
    const out = await lookupLatestGoVersion('github.com/foo/bar', fakeFetch as unknown as typeof fetch)
    expect(out.ok).toBe(true)
    expect(out.version).toBe('v2.5.1')
  })

  it('returns ok=false on HTTP non-200 (NEVER mapped to not-stale)', async () => {
    const fakeFetch = async () => ({
      ok: false,
      status: 410,
      json: async () => ({}),
    } as Response)
    const out = await lookupLatestGoVersion('github.com/foo/bar', fakeFetch as unknown as typeof fetch)
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/410/)
  })

  it('returns ok=false on missing Version field (NEVER fabricates)', async () => {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response)
    const out = await lookupLatestGoVersion('github.com/foo/bar', fakeFetch as unknown as typeof fetch)
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/version/i)
  })

  it('returns ok=false on network exception (NEVER swallowed)', async () => {
    const fakeFetch = async () => { throw new Error('ENETDOWN') }
    const out = await lookupLatestGoVersion('github.com/foo/bar', fakeFetch as unknown as typeof fetch)
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('ENETDOWN')
  })
})

// ── goAdapter.detect ──────────────────────────────────────────────────────────

describe('goAdapter.detect', () => {
  it('detects a Go module (go.mod present)', () => {
    writeFileSync(path.join(repo, 'go.mod'), `module example.com/x\n`)
    const out = goAdapter.detect(repo)
    expect(out.detected).toBe(true)
    expect(out.indicators).toContain('go.mod')
  })

  it('does NOT detect on go.sum alone (highly unusual)', () => {
    writeFileSync(path.join(repo, 'go.sum'), `dummy v1.0.0/go.mod h1:abc=\n`)
    const out = goAdapter.detect(repo)
    expect(out.detected).toBe(false)
  })

  it('does NOT detect on go.work alone (multi-module workspaces are tracked separately)', () => {
    writeFileSync(path.join(repo, 'go.work'), `go 1.21\n\nuse ./module-a\n`)
    const out = goAdapter.detect(repo)
    expect(out.detected).toBe(false)
  })

  it('includes go.sum + go.work in indicators when go.mod is also present', () => {
    writeFileSync(path.join(repo, 'go.mod'), `module example.com/x\n`)
    writeFileSync(path.join(repo, 'go.sum'), `dummy v1.0.0/go.mod h1:abc=\n`)
    writeFileSync(path.join(repo, 'go.work'), `go 1.21\n`)
    const out = goAdapter.detect(repo)
    expect(out.detected).toBe(true)
    expect(out.indicators).toEqual(expect.arrayContaining(['go.mod', 'go.sum', 'go.work']))
  })
})

// ── goAdapter.semanticDiff — sub-phase 1 honest fallback ──────────────────────

describe('goAdapter.semanticDiff — honest fallback', () => {
  it('returns analyzable-but-empty diff naming the gap (NEVER fabricates)', async () => {
    // F23b sub-phase 2: the Go sandbox image MAY be built on the dev
    // box (from a prior §11b.1 test run). We use an intentionally-
    // unresolvable module path so the test is deterministic whether
    // or not the image is built: if the image is absent we hit
    // goImageExists=false → "not built" fallback; if the image is
    // present we hit the `go get` failure path → "apidiff failed"
    // fallback. Both branches produce the honest shape below. The
    // §11b.1 test in tests/go-apidiff-container.test.ts asserts the
    // happy path against live Docker; this unit test pins the
    // fallback contract.
    const diff = await goAdapter.semanticDiff(
      'example.com/mendel/test/nonexistent-please-fail',
      'v1.0.0',
      'v2.0.0',
    )
    expect(diff.removedExports).toEqual([])
    expect(diff.signatureChanges).toEqual([])
    expect(diff.newDeprecations).toEqual([])
    expect(diff.coveragePercent).toBe(0)
    expect(diff.analysisTier).toBe('ast-only')
    expect(diff.unanalyzableSymbols).toHaveLength(1)
    expect(diff.unanalyzableSymbols[0].reason).toMatch(
      /(not built|apidiff could not analyze)/i,
    )
  }, 60_000) // Docker go-get round-trip = up to ~30s on cold cache
})

// ── Adapter contract pins ─────────────────────────────────────────────────────

describe('goAdapter contract', () => {
  it("advertises id='go', manifest 'go.mod', maxBucket 'high' (apidiff is gold standard)", () => {
    expect(goAdapter.id).toBe('go')
    expect(goAdapter.manifestFile).toBe('go.mod')
    expect(goAdapter.maxBucket).toBe('high')
  })

  it('exposes preflight() so the runner can build the Go image once per scan', () => {
    expect(typeof goAdapter.preflight).toBe('function')
  })
})
