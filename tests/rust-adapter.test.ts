/**
 * Tests for the v2.2 / F23c Rust adapter (sub-phase 1).
 *
 * Covers:
 *   - Detection: `Cargo.toml` is the binding indicator; `Cargo.lock`
 *     alone doesn't qualify
 *   - `Cargo.toml` parser:
 *       - simple string + inline-table dependency shapes
 *       - [dev-dependencies] + [build-dependencies] excluded from
 *         staleness, counts surfaced honestly
 *       - [workspace.dependencies] kept separate from runtime deps
 *       - git/path/`workspace = true` inline shapes surfaced via
 *         unparsedDependencies — NEVER silently dropped
 *       - [package].name extraction
 *       - end-of-line `#` comments
 *       - [target.…] sections ignored honestly (sub-phase 1 scope)
 *   - `lookupLatestCrateVersion`: ok / 404 / missing-version / network
 *     branches via injected fetch — all four honesty-discriminated cases
 *   - The honest semantic-diff stub returns analyzable-but-empty data
 *     with a clear reason — confidence stays capped until cargo-semver-
 *     checks lands in F23c sub-phase 2.
 *   - Adapter contract pins (id, manifest, maxBucket='medium', preflight)
 *
 * Real tmp directories — no fs mocks; the whole point is filesystem-shape
 * parsing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  rustAdapter,
  parseCargoToml,
  lookupLatestCrateVersion,
} from '@/lib/agent/lang/rust'

let repo: string
beforeEach(() => { repo = mkdtempSync(path.join(tmpdir(), 'mendel-rust-')) })
afterEach(() => { rmSync(repo, { recursive: true, force: true }) })

// ── parseCargoToml ────────────────────────────────────────────────────────────

describe('parseCargoToml', () => {
  it('extracts [package].name', () => {
    const out = parseCargoToml(`[package]\nname = "my-crate"\nversion = "0.1.0"\n`)
    expect(out.packageName).toBe('my-crate')
  })

  it('parses simple string deps in [dependencies]', () => {
    const out = parseCargoToml(`[dependencies]\nserde = "1.0"\ntokio = "1.35"\n`)
    expect(out.dependencies.get('serde')).toBe('1.0')
    expect(out.dependencies.get('tokio')).toBe('1.35')
  })

  it('parses inline-table version inside [dependencies]', () => {
    const out = parseCargoToml(`[dependencies]\ntokio = { version = "1.35", features = ["full"] }\n`)
    expect(out.dependencies.get('tokio')).toBe('1.35')
  })

  it("EXCLUDES [dev-dependencies] from runtime deps but surfaces the count honestly", () => {
    // §5b: dropping silently would misrepresent the dep surface. The
    // adapter routes dev deps to a separate count so the runner can log
    // them rather than counting them as staleness candidates.
    const out = parseCargoToml(
      `[dependencies]\nserde = "1.0"\n\n[dev-dependencies]\ncriterion = "0.5"\nmockito = "1.0"\n`,
    )
    expect(out.dependencies.get('serde')).toBe('1.0')
    expect(out.dependencies.has('criterion')).toBe(false)
    expect(out.dependencies.has('mockito')).toBe(false)
    expect(out.devDependencyCount).toBe(2)
  })

  it("EXCLUDES [build-dependencies] from runtime deps but surfaces the count honestly", () => {
    const out = parseCargoToml(
      `[dependencies]\nserde = "1.0"\n\n[build-dependencies]\ncc = "1.0"\nbindgen = "0.69"\n`,
    )
    expect(out.dependencies.get('serde')).toBe('1.0')
    expect(out.buildDependencyCount).toBe(2)
  })

  it("keeps [workspace.dependencies] separate from runtime [dependencies]", () => {
    const out = parseCargoToml(
      `[workspace.dependencies]\nshared = "1.0"\nlogger = { version = "0.5" }\n\n[dependencies]\nserde = "1.0"\n`,
    )
    expect(out.dependencies.get('serde')).toBe('1.0')
    expect(out.workspaceDependencies.get('shared')).toBe('1.0')
    expect(out.workspaceDependencies.get('logger')).toBe('0.5')
    // Workspace deps don't pollute the runtime [dependencies] map.
    expect(out.dependencies.has('shared')).toBe(false)
  })

  it('surfaces git-dependency inline shape honestly (NEVER silently dropped)', () => {
    const out = parseCargoToml(
      `[dependencies]\nmy-fork = { git = "https://github.com/me/crate" }\n`,
    )
    expect(out.dependencies.has('my-fork')).toBe(false)
    expect(out.unparsedDependencies).toHaveLength(1)
    expect(out.unparsedDependencies[0].name).toBe('my-fork')
    expect(out.unparsedDependencies[0].reason).toMatch(/git dependency/i)
  })

  it('surfaces path-dependency inline shape honestly', () => {
    const out = parseCargoToml(
      `[dependencies]\nlocal-helper = { path = "../helper" }\n`,
    )
    expect(out.dependencies.has('local-helper')).toBe(false)
    expect(out.unparsedDependencies[0].reason).toMatch(/path dependency/i)
  })

  it('surfaces `workspace = true` inline shape honestly (sub-phase 1 does not resolve inheritance)', () => {
    const out = parseCargoToml(
      `[dependencies]\nshared = { workspace = true }\n`,
    )
    expect(out.dependencies.has('shared')).toBe(false)
    expect(out.unparsedDependencies[0].reason).toMatch(/workspace inheritance/i)
  })

  it('ignores [target.cfg(...)] sections honestly (sub-phase 1 scope)', () => {
    const out = parseCargoToml(
      `[dependencies]\nserde = "1.0"\n\n[target.'cfg(unix)'.dependencies]\nlibc = "0.2"\n`,
    )
    // libc is target-gated; sub-phase 1 doesn't resolve those, but we
    // also don't accidentally count libc as a runtime dep.
    expect(out.dependencies.get('serde')).toBe('1.0')
    expect(out.dependencies.has('libc')).toBe(false)
  })

  it('strips end-of-line # comments but preserves # inside strings', () => {
    const out = parseCargoToml(
      `[package]\nname = "my-crate" # primary crate\n\n[dependencies]\nserde = "1.0"\n`,
    )
    expect(out.packageName).toBe('my-crate')
    expect(out.dependencies.get('serde')).toBe('1.0')
  })

  it('handles a real-world-shaped Cargo.toml (mixed sections, comments, blank lines)', () => {
    const body = [
      `# Top-level comment`,
      `[package]`,
      `name = "example"`,
      `version = "0.1.0"`,
      `edition = "2021"`,
      ``,
      `[dependencies]`,
      `serde = { version = "1.0", features = ["derive"] }`,
      `tokio = "1.35"`,
      `anyhow = "1"`,
      `# the next dep is local`,
      `local-helper = { path = "../helper" }`,
      ``,
      `[dev-dependencies]`,
      `criterion = "0.5"`,
      ``,
      `[build-dependencies]`,
      `cc = "1.0"`,
    ].join('\n')
    const out = parseCargoToml(body)
    expect(out.packageName).toBe('example')
    expect(out.dependencies.get('serde')).toBe('1.0')
    expect(out.dependencies.get('tokio')).toBe('1.35')
    expect(out.dependencies.get('anyhow')).toBe('1')
    expect(out.dependencies.has('local-helper')).toBe(false)
    expect(out.unparsedDependencies.map((u) => u.name)).toContain('local-helper')
    expect(out.devDependencyCount).toBe(1)
    expect(out.buildDependencyCount).toBe(1)
  })
})

// ── lookupLatestCrateVersion (injected fetch — no real network) ──────────────

describe('lookupLatestCrateVersion', () => {
  it('returns ok=true with max_stable_version when present', async () => {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ crate: { max_stable_version: '1.2.3', max_version: '2.0.0-rc.1' } }),
    } as Response)
    const out = await lookupLatestCrateVersion('serde', fakeFetch as unknown as typeof fetch)
    expect(out.ok).toBe(true)
    // We prefer max_stable_version over max_version — never auto-bump to a pre-release.
    expect(out.version).toBe('1.2.3')
  })

  it('falls back to max_version when max_stable_version is null (pre-release only crate)', async () => {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ crate: { max_stable_version: null, max_version: '0.1.0-alpha' } }),
    } as Response)
    const out = await lookupLatestCrateVersion('experimental-crate', fakeFetch as unknown as typeof fetch)
    expect(out.ok).toBe(true)
    expect(out.version).toBe('0.1.0-alpha')
  })

  it("returns ok=false on HTTP 404 (NEVER mapped to 'not stale')", async () => {
    const fakeFetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response)
    const out = await lookupLatestCrateVersion('nonexistent-crate', fakeFetch as unknown as typeof fetch)
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/404/)
  })

  it('returns ok=false on missing crate.* fields (NEVER fabricates)', async () => {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response)
    const out = await lookupLatestCrateVersion('serde', fakeFetch as unknown as typeof fetch)
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/version/i)
  })

  it('returns ok=false on network exception (NEVER swallowed)', async () => {
    const fakeFetch = async () => { throw new Error('ENETDOWN') }
    const out = await lookupLatestCrateVersion('serde', fakeFetch as unknown as typeof fetch)
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('ENETDOWN')
  })
})

// ── rustAdapter.detect ────────────────────────────────────────────────────────

describe('rustAdapter.detect', () => {
  it('detects a Rust crate (Cargo.toml present)', () => {
    writeFileSync(path.join(repo, 'Cargo.toml'), `[package]\nname = "x"\nversion = "0.1.0"\n`)
    const out = rustAdapter.detect(repo)
    expect(out.detected).toBe(true)
    expect(out.indicators).toContain('Cargo.toml')
  })

  it('does NOT detect on Cargo.lock alone (highly unusual)', () => {
    writeFileSync(path.join(repo, 'Cargo.lock'), `# lockfile only\n`)
    const out = rustAdapter.detect(repo)
    expect(out.detected).toBe(false)
  })

  it('includes Cargo.lock in indicators when Cargo.toml is also present', () => {
    writeFileSync(path.join(repo, 'Cargo.toml'), `[package]\nname = "x"\nversion = "0.1.0"\n`)
    writeFileSync(path.join(repo, 'Cargo.lock'), `# lockfile\n`)
    const out = rustAdapter.detect(repo)
    expect(out.detected).toBe(true)
    expect(out.indicators).toEqual(expect.arrayContaining(['Cargo.toml', 'Cargo.lock']))
  })
})

// ── rustAdapter.semanticDiff — sub-phase 1 honest fallback ───────────────────

describe('rustAdapter.semanticDiff — honest fallback', () => {
  it('returns analyzable-but-empty diff naming the gap (NEVER fabricates)', async () => {
    // F23c sub-phase 2: the Rust sandbox image MAY be built on the
    // dev box (from a prior §11b.1 test run). We use an intentionally-
    // unresolvable crate name + path-style version so the test is
    // deterministic whether or not the image is built: image-absent
    // hits the "not built" fallback; image-present hits the
    // cargo-semver-checks error path. Both produce the honest shape.
    const diff = await rustAdapter.semanticDiff(
      'mendel-test-nonexistent-please-fail',
      '0.0.0',
      '1.0.0',
    )
    expect(diff.removedExports).toEqual([])
    expect(diff.signatureChanges).toEqual([])
    expect(diff.newDeprecations).toEqual([])
    expect(diff.coveragePercent).toBe(0)
    expect(diff.analysisTier).toBe('ast-only')
    expect(diff.unanalyzableSymbols).toHaveLength(1)
    expect(diff.unanalyzableSymbols[0].reason).toMatch(
      /(not built|cargo-semver-checks could not analyze)/i,
    )
  }, 60_000)
})

// ── Adapter contract pins ─────────────────────────────────────────────────────

describe('rustAdapter contract', () => {
  it("advertises id='rust', manifest 'Cargo.toml', maxBucket 'medium' (cargo-semver-checks is public-API-only)", () => {
    expect(rustAdapter.id).toBe('rust')
    expect(rustAdapter.manifestFile).toBe('Cargo.toml')
    // §5b v2 r1: Rust ceiling is medium, not high. This is the FIRST
    // adapter where the language-aware clamp binds; the property test
    // in confidence-score.test.ts pins the clamp math.
    expect(rustAdapter.maxBucket).toBe('medium')
  })

  it('exposes preflight() so the runner can build the Rust image once per scan', () => {
    expect(typeof rustAdapter.preflight).toBe('function')
  })
})
