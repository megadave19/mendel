/**
 * Tests for lib/agent/workspace/detect.ts (v2.1 / F21).
 *
 * Real tmp directories — never mock fs. The whole point of this module is
 * filesystem-shape parsing; mocking the fs primitives would test the wrong
 * thing.
 *
 * Coverage:
 *   - Pure parsers (parsePnpmWorkspacePackages, resolveWorkspaceGlob) — fast.
 *   - End-to-end detectWorkspace across the real-world shapes:
 *       • single-package repo (the v1.5 path)
 *       • pnpm workspace
 *       • npm/yarn workspaces (string[] + {packages:[]} forms)
 *       • lerna.json
 *       • turbo.json / nx.json overlays
 *       • degraded honesty: malformed YAML, broken glob, missing pkg
 *   - Anti-regression: deterministic package ordering (eval bench depends on it)
 *
 * §5b honesty assertions baked in: unresolved patterns are SURFACED, not
 * silently dropped.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  detectWorkspace,
  parsePnpmWorkspacePackages,
  resolveWorkspaceGlob,
} from '@/lib/agent/workspace/detect'

// ── Test scaffolding ──────────────────────────────────────────────────────────

let repo: string

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), 'mendel-ws-'))
})
afterEach(() => {
  try { rmSync(repo, { recursive: true, force: true }) } catch { /* tmp reaper */ }
})

function file(rel: string, content: string) {
  const abs = path.join(repo, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}
function pkg(rel: string, name: string) {
  file(`${rel}/package.json`, JSON.stringify({ name, version: '0.0.0' }))
}

// ── parsePnpmWorkspacePackages — pure ──────────────────────────────────────────

describe('parsePnpmWorkspacePackages', () => {
  it("reads single-quoted block-list values under packages:", () => {
    expect(parsePnpmWorkspacePackages("packages:\n  - 'apps/*'\n  - 'libs/*'\n")).toEqual(['apps/*', 'libs/*'])
  })
  it('reads double-quoted + unquoted values', () => {
    expect(parsePnpmWorkspacePackages('packages:\n  - "apps/*"\n  - libs/foo\n')).toEqual(['apps/*', 'libs/foo'])
  })
  it('ignores comments + blank lines + trailing whitespace', () => {
    const yaml = '# top comment\npackages:\n  - apps/* # inline\n\n  - libs/*\n'
    expect(parsePnpmWorkspacePackages(yaml)).toEqual(['apps/*', 'libs/*'])
  })
  it('handles a BOM + CRLF line endings (Windows-authored files)', () => {
    const yaml = `﻿packages:\r\n  - 'apps/*'\r\n`
    expect(parsePnpmWorkspacePackages(yaml)).toEqual(['apps/*'])
  })
  it('returns [] when no packages: block exists', () => {
    expect(parsePnpmWorkspacePackages('allowBuilds:\n  - esbuild\n')).toEqual([])
  })
  it('closes the block when another top-level key appears', () => {
    const yaml = 'packages:\n  - apps/*\nallowBuilds:\n  - esbuild\n'
    expect(parsePnpmWorkspacePackages(yaml)).toEqual(['apps/*'])
  })
})

// ── resolveWorkspaceGlob — pure ────────────────────────────────────────────────

describe('resolveWorkspaceGlob', () => {
  it('resolves prefix/* to dirs containing package.json (deterministic)', () => {
    pkg('packages/a', 'a')
    pkg('packages/b', 'b')
    mkdirSync(path.join(repo, 'packages/no-manifest'), { recursive: true })
    const { matchedDirs, unresolvedReason } = resolveWorkspaceGlob(repo, 'packages/*')
    expect(unresolvedReason).toBeUndefined()
    expect(matchedDirs.map((d) => path.basename(d)).sort()).toEqual(['a', 'b'])
  })

  it('resolves an exact dir name when no glob char present', () => {
    pkg('one-package', 'one')
    const { matchedDirs } = resolveWorkspaceGlob(repo, 'one-package')
    expect(matchedDirs).toHaveLength(1)
    expect(path.basename(matchedDirs[0])).toBe('one-package')
  })

  it("flags '**' as unresolved (NEVER silently expanded)", () => {
    const { matchedDirs, unresolvedReason } = resolveWorkspaceGlob(repo, 'packages/**')
    expect(matchedDirs).toHaveLength(0)
    expect(unresolvedReason).toMatch(/deep glob/i)
  })

  it("flags exclusion '!' patterns as unresolved", () => {
    const { unresolvedReason } = resolveWorkspaceGlob(repo, '!packages/private')
    expect(unresolvedReason).toMatch(/exclusion/i)
  })

  it("reports a missing prefix dir honestly (not just 0 matches)", () => {
    const { unresolvedReason } = resolveWorkspaceGlob(repo, 'packages/*')
    expect(unresolvedReason).toMatch(/does not exist/i)
  })

  it('does NOT match a dir that lacks package.json', () => {
    mkdirSync(path.join(repo, 'packages/a'), { recursive: true })
    // packages/a exists but no package.json → not a member
    const { matchedDirs } = resolveWorkspaceGlob(repo, 'packages/*')
    expect(matchedDirs).toHaveLength(0)
  })
})

// ── detectWorkspace — end-to-end across the shapes ─────────────────────────────

describe('detectWorkspace — single package (v1.5 path)', () => {
  it("returns one implicit package = repo root for a plain repo", () => {
    file('package.json', JSON.stringify({ name: 'my-lib', version: '1.0.0' }))
    const d = detectWorkspace(repo)
    expect(d.kind).toBe('single')
    expect(d.packages).toHaveLength(1)
    expect(d.packages[0]).toEqual({ name: 'my-lib', dir: '.', manifestPath: 'package.json' })
    expect(d.indicators).toEqual([])
  })

  it('falls back to dir basename when package.json has no name', () => {
    file('package.json', '{}')
    const d = detectWorkspace(repo)
    expect(d.packages[0].name).toBe(path.basename(repo))
  })

  it("returns kind=single + zero packages when no package.json exists (not a JS repo)", () => {
    const d = detectWorkspace(repo)
    expect(d.kind).toBe('single')
    expect(d.packages).toEqual([])
  })
})

describe('detectWorkspace — pnpm workspace', () => {
  it('enumerates packages from pnpm-workspace.yaml + names them from manifest', () => {
    file('package.json', JSON.stringify({ name: 'root', private: true }))
    file('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n")
    pkg('packages/ui', '@scope/ui')
    pkg('packages/utils', '@scope/utils')
    const d = detectWorkspace(repo)
    expect(d.kind).toBe('pnpm')
    expect(d.indicators).toContain('pnpm-workspace.yaml')
    expect(d.packages.map((p) => p.name).sort()).toEqual(['@scope/ui', '@scope/utils'])
    expect(d.packages.every((p) => p.manifestPath.endsWith('/package.json'))).toBe(true)
  })

  it('records the resolved glob count for honest reporting', () => {
    file('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'libs/*'\n")
    pkg('apps/web', 'web')
    // no libs/* dir at all
    const d = detectWorkspace(repo)
    expect(d.resolvedGlobs).toContainEqual({ pattern: 'apps/*', matched: 1 })
    expect(d.resolvedGlobs).toContainEqual({ pattern: 'libs/*', matched: 0 })
    expect(d.unresolvedPatterns.some((u) => u.pattern === 'libs/*')).toBe(true)
  })

  it("falls back to repo root if all globs resolved to zero packages (honest single)", () => {
    file('package.json', JSON.stringify({ name: 'root' }))
    file('pnpm-workspace.yaml', "packages:\n  - 'libs/*'\n") // libs/ doesn't exist
    const d = detectWorkspace(repo)
    expect(d.packages).toHaveLength(1)
    expect(d.packages[0].dir).toBe('.')
    // Kind STILL reflects the workspace declaration — we didn't pretend it's single.
    expect(d.kind).toBe('pnpm')
  })
})

describe('detectWorkspace — npm/yarn workspaces (package.json)', () => {
  it('reads string[] form', () => {
    file('package.json', JSON.stringify({ name: 'root', workspaces: ['packages/*'] }))
    pkg('packages/a', 'a')
    pkg('packages/b', 'b')
    const d = detectWorkspace(repo)
    expect(d.kind).toBe('yarn') // detection labels both npm + yarn as 'yarn' (could refine on lockfile later)
    expect(d.indicators).toContain('package.json#workspaces')
    expect(d.packages.map((p) => p.name).sort()).toEqual(['a', 'b'])
  })

  it('reads {packages:[]} (yarn-with-nohoist) form', () => {
    file('package.json', JSON.stringify({
      name: 'root',
      workspaces: { packages: ['apps/*'], nohoist: ['**/foo'] },
    }))
    pkg('apps/web', 'web')
    const d = detectWorkspace(repo)
    expect(d.packages.map((p) => p.name)).toEqual(['web'])
  })

  it('handles a malformed root package.json honestly — degrades to []', () => {
    file('package.json', '{not json')
    const d = detectWorkspace(repo)
    expect(d.kind).toBe('single')
    expect(d.packages).toEqual([])
    expect(d.unresolvedPatterns.some((u) => u.pattern === 'package.json')).toBe(true)
  })
})

describe('detectWorkspace — overlays (nx / turbo / lerna)', () => {
  it('labels kind=turbo when turbo.json overlays a pnpm workspace', () => {
    file('package.json', JSON.stringify({ name: 'root' }))
    file('pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n")
    file('turbo.json', '{}')
    pkg('apps/web', 'web')
    const d = detectWorkspace(repo)
    expect(d.kind).toBe('turbo')
    expect(d.indicators).toContain('turbo.json')
    expect(d.indicators).toContain('pnpm-workspace.yaml')
  })

  it("labels kind=nx when nx.json present (preferred over turbo if both)", () => {
    file('package.json', JSON.stringify({ name: 'root', workspaces: ['apps/*'] }))
    file('nx.json', '{}')
    pkg('apps/web', 'web')
    const d = detectWorkspace(repo)
    expect(d.kind).toBe('nx')
  })

  it('reads packages from lerna.json when workspaces field is absent', () => {
    file('package.json', JSON.stringify({ name: 'root' }))
    file('lerna.json', JSON.stringify({ packages: ['libs/*'] }))
    pkg('libs/a', 'a')
    const d = detectWorkspace(repo)
    expect(d.kind).toBe('lerna')
    expect(d.packages.map((p) => p.name)).toEqual(['a'])
  })
})

describe('detectWorkspace — invariants', () => {
  it("packages are sorted by dir (deterministic across runs — eval bench requires this)", () => {
    file('package.json', JSON.stringify({ name: 'root' }))
    file('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n")
    pkg('packages/z', 'z')
    pkg('packages/a', 'a')
    pkg('packages/m', 'm')
    const dirs = detectWorkspace(repo).packages.map((p) => p.dir)
    expect(dirs).toEqual(['packages/a', 'packages/m', 'packages/z'])
  })

  it('dedupes a dir that two globs would both match', () => {
    file('package.json', JSON.stringify({ name: 'root' }))
    file('pnpm-workspace.yaml', "packages:\n  - 'packages/*'\n  - 'packages/ui'\n")
    pkg('packages/ui', 'ui')
    const d = detectWorkspace(repo)
    expect(d.packages.map((p) => p.dir)).toEqual(['packages/ui'])
  })

  it('NEVER silently drops an unsupported glob — surfaces it in unresolvedPatterns', () => {
    file('package.json', JSON.stringify({ name: 'root', workspaces: ['packages/**', '!packages/private'] }))
    const d = detectWorkspace(repo)
    const reasons = d.unresolvedPatterns.map((u) => u.pattern)
    expect(reasons).toContain('packages/**')
    expect(reasons).toContain('!packages/private')
  })
})
