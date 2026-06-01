/**
 * Workspace detection (v2.1 / F21) — finds the workspace root and enumerates
 * member packages so the runner can scan per-package with the existing
 * pipeline. Lifts the v1.x monorepo rejection (CLAUDE.md §11) for v2.
 *
 * **Single-package = special case, not a branch.** Per V2_PLAN.md §F21:
 * `detectWorkspace` ALWAYS returns at least one package — for a plain
 * single-package repo, that's `{ name, dir: '.', manifestPath: 'package.json' }`.
 * The runner loops unconditionally over `packages`; v1.5 behavior is just
 * `packages.length === 1` + `kind === 'single'`.
 *
 * **No new deps.** YAML + glob parsing is inlined for the narrow monorepo
 * patterns actually used in the wild (`packages/*`, `apps/*`). For weirder
 * shapes (deep globs, exclusions) we DEGRADE honestly — log them, scan what
 * we can, and report the rest in "Not Analyzed" rather than fabricate.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * The workspace flavor we detected. Drives reporting + per-package install
 * heuristics in v2.2+ (e.g. yarn workspaces hoist differently than pnpm).
 */
export type WorkspaceKind =
  | 'single'         // not a monorepo — the v1.5 path
  | 'pnpm'           // pnpm-workspace.yaml with `packages:`
  | 'npm'            // package.json `workspaces` (string[] or {packages})
  | 'yarn'           // package.json `workspaces` (yarn-classic + berry — same shape as npm)
  | 'lerna'          // lerna.json `packages` (often combined with npm/yarn)
  | 'nx'             // nx.json present (typically alongside yarn/pnpm)
  | 'turbo'          // turbo.json present (typically alongside pnpm/npm)

/** A single member package within a workspace. */
export interface PackageRef {
  /** From the package's own package.json `name`. Falls back to dir basename. */
  name: string
  /** Path RELATIVE to the workspace root, e.g. `packages/ui` or `.` for root. */
  dir: string
  /** Path to that package's package.json, RELATIVE to the workspace root. */
  manifestPath: string
}

export interface WorkspaceDetection {
  kind: WorkspaceKind
  /**
   * Always non-empty: at minimum the workspace root itself. For monorepos
   * this is the list of member packages with a parseable package.json.
   */
  packages: PackageRef[]
  /** Marker files that drove the detection — useful in logs + reports. */
  indicators: string[]
  /**
   * Glob patterns we resolved + the count of packages each contributed.
   * Surfaced honestly so a glob that matched zero dirs is visible (vs.
   * silently skipped).
   */
  resolvedGlobs: { pattern: string; matched: number }[]
  /**
   * Patterns we COULD NOT resolve (e.g. exclusions, deep `**`, malformed
   * package.json under a matched dir). Reported in "Not Analyzed."
   * §5b: never silently drop a glob.
   */
  unresolvedPatterns: { pattern: string; reason: string }[]
}

// ── YAML: minimal parser for pnpm-workspace.yaml's `packages:` list ──────────

/**
 * Extract the value list under a top-level `packages:` key. The pnpm-
 * workspace.yaml format is fixed (block list of strings); we DON'T need a
 * full YAML parser to read it. If the file uses an unexpected shape (flow
 * sequence, complex YAML), we return an empty list and the caller logs it
 * to `unresolvedPatterns` rather than crash.
 *
 * Exported for tests.
 */
export function parsePnpmWorkspacePackages(yaml: string): string[] {
  // Strip BOM if present, normalize CRLF.
  const text = yaml.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const out: string[] = []
  let inPackagesBlock = false
  for (const raw of lines) {
    // Strip comments + trailing whitespace.
    const line = raw.replace(/#.*$/, '').trimEnd()
    if (!line.trim()) continue

    // Top-level `packages:` opens the block. Anything else at column 0 closes it.
    if (/^packages:\s*$/.test(line)) { inPackagesBlock = true; continue }
    if (/^[A-Za-z_]/.test(line)) { inPackagesBlock = false; continue }

    if (!inPackagesBlock) continue

    // List item: `  - 'packages/*'` or `  - packages/*` or `  - "packages/*"`.
    const m = /^\s+-\s*(.+?)\s*$/.exec(line)
    if (!m) continue
    let val = m[1]
    // Strip matching quotes.
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1)
    }
    if (val) out.push(val)
  }
  return out
}

// ── package.json#workspaces — string[] or { packages: string[] } ─────────────

/** Pull the workspaces glob list from a parsed package.json object. */
function readPkgJsonWorkspaces(pkg: unknown): string[] {
  if (!pkg || typeof pkg !== 'object') return []
  const ws = (pkg as { workspaces?: unknown }).workspaces
  if (Array.isArray(ws)) return ws.filter((s): s is string => typeof s === 'string')
  if (ws && typeof ws === 'object') {
    const inner = (ws as { packages?: unknown }).packages
    if (Array.isArray(inner)) return inner.filter((s): s is string => typeof s === 'string')
  }
  return []
}

// ── Glob resolution (narrow patterns only — honest fallback otherwise) ────────

/**
 * Resolve a single glob pattern relative to `root` to a list of absolute dirs
 * that contain a package.json. Returns the list + a short reason string when
 * the pattern was unsupported (so the caller can log it honestly).
 *
 * Supported patterns:
 *   - `dirname`         → exact match (the dir if it exists)
 *   - `prefix/*`        → all direct children of `prefix/` containing package.json
 *
 * Unsupported (returned as unresolved, honestly):
 *   - Deep `**` patterns
 *   - Exclusions (`!pattern`)
 *   - Patterns with `?` or character classes
 */
export function resolveWorkspaceGlob(
  root: string,
  pattern: string,
): { matchedDirs: string[]; unresolvedReason?: string } {
  if (pattern.startsWith('!')) {
    return { matchedDirs: [], unresolvedReason: 'exclusion pattern not supported in v2.1' }
  }
  if (pattern.includes('**') || pattern.includes('?') || pattern.includes('[')) {
    return { matchedDirs: [], unresolvedReason: 'deep glob / charclass not supported in v2.1' }
  }

  // `prefix/*` — list immediate children.
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2)
    const dirPath = path.join(root, prefix)
    if (!existsSync(dirPath)) {
      return { matchedDirs: [], unresolvedReason: `prefix "${prefix}" does not exist` }
    }
    let entries: string[]
    try {
      entries = readdirSync(dirPath)
    } catch (err) {
      return { matchedDirs: [], unresolvedReason: `readdir failed: ${(err as Error).message}` }
    }
    const matched: string[] = []
    for (const e of entries) {
      const candidate = path.join(dirPath, e)
      try {
        if (!statSync(candidate).isDirectory()) continue
      } catch { continue }
      if (existsSync(path.join(candidate, 'package.json'))) {
        matched.push(candidate)
      }
    }
    return { matchedDirs: matched }
  }

  // Plain `dirname` — exact match.
  if (!pattern.includes('*')) {
    const dir = path.join(root, pattern)
    if (existsSync(path.join(dir, 'package.json'))) {
      return { matchedDirs: [dir] }
    }
    return { matchedDirs: [], unresolvedReason: `no package.json at "${pattern}"` }
  }

  return { matchedDirs: [], unresolvedReason: 'unsupported glob shape' }
}

// ── Read a package.json's `name` field (best-effort) ─────────────────────────

function readPackageName(manifestAbsPath: string, fallback: string): string {
  try {
    const raw = readFileSync(manifestAbsPath, 'utf-8')
    const pkg = JSON.parse(raw) as { name?: unknown }
    if (typeof pkg.name === 'string' && pkg.name.trim()) return pkg.name.trim()
  } catch { /* fall through */ }
  return fallback
}

// ── Public entry — detectWorkspace ───────────────────────────────────────────

/**
 * Inspect `repoPath` and return the workspace shape. Always returns at least
 * one package — the repo root itself when nothing monorepo-shaped is found.
 *
 * The detection priority is: pnpm-workspace.yaml → package.json workspaces →
 * lerna.json packages. Marker-only files (nx.json, turbo.json) influence
 * `kind` reporting but the package list still comes from the workspace
 * declaration (because nx/turbo always ride on top of a pnpm/yarn workspace).
 */
export function detectWorkspace(repoPath: string): WorkspaceDetection {
  const indicators: string[] = []
  const resolvedGlobs: WorkspaceDetection['resolvedGlobs'] = []
  const unresolvedPatterns: WorkspaceDetection['unresolvedPatterns'] = []
  const dirsSeen = new Set<string>()
  const packages: PackageRef[] = []

  // 1. pnpm-workspace.yaml
  let pnpmGlobs: string[] = []
  const pnpmWs = path.join(repoPath, 'pnpm-workspace.yaml')
  if (existsSync(pnpmWs)) {
    try {
      pnpmGlobs = parsePnpmWorkspacePackages(readFileSync(pnpmWs, 'utf-8'))
      if (pnpmGlobs.length > 0) indicators.push('pnpm-workspace.yaml')
    } catch (err) {
      unresolvedPatterns.push({
        pattern: 'pnpm-workspace.yaml',
        reason: `read/parse failed: ${(err as Error).message}`,
      })
    }
  }

  // 2. package.json workspaces (npm/yarn)
  let pkgJsonGlobs: string[] = []
  const rootPkgPath = path.join(repoPath, 'package.json')
  let rootPkg: { name?: string; workspaces?: unknown } | null = null
  if (existsSync(rootPkgPath)) {
    try {
      rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'))
      pkgJsonGlobs = readPkgJsonWorkspaces(rootPkg)
      if (pkgJsonGlobs.length > 0) indicators.push('package.json#workspaces')
    } catch (err) {
      // Root package.json malformed — log + degrade to single-package shape.
      unresolvedPatterns.push({
        pattern: 'package.json',
        reason: `parse failed: ${(err as Error).message}`,
      })
    }
  }

  // 3. lerna.json packages (rarely the only signal but support it)
  let lernaGlobs: string[] = []
  const lernaPath = path.join(repoPath, 'lerna.json')
  if (existsSync(lernaPath)) {
    indicators.push('lerna.json')
    try {
      const lerna = JSON.parse(readFileSync(lernaPath, 'utf-8')) as { packages?: unknown }
      if (Array.isArray(lerna.packages)) {
        lernaGlobs = lerna.packages.filter((s): s is string => typeof s === 'string')
      }
    } catch (err) {
      unresolvedPatterns.push({
        pattern: 'lerna.json',
        reason: `parse failed: ${(err as Error).message}`,
      })
    }
  }

  // 4. nx.json / turbo.json — kind-only indicators (they ride on top).
  if (existsSync(path.join(repoPath, 'nx.json'))) indicators.push('nx.json')
  if (existsSync(path.join(repoPath, 'turbo.json'))) indicators.push('turbo.json')

  // Pick the dominant glob source. Priority: pnpm > package.json > lerna.
  // (pnpm-workspace.yaml is the modern source of truth when it's there.)
  const globs = pnpmGlobs.length > 0
    ? pnpmGlobs
    : pkgJsonGlobs.length > 0
      ? pkgJsonGlobs
      : lernaGlobs

  for (const pattern of globs) {
    const { matchedDirs, unresolvedReason } = resolveWorkspaceGlob(repoPath, pattern)
    if (unresolvedReason) {
      unresolvedPatterns.push({ pattern, reason: unresolvedReason })
    }
    resolvedGlobs.push({ pattern, matched: matchedDirs.length })
    for (const absDir of matchedDirs) {
      if (dirsSeen.has(absDir)) continue
      dirsSeen.add(absDir)
      const relDir = path.relative(repoPath, absDir) || '.'
      const manifestRel = path.join(relDir, 'package.json')
      const name = readPackageName(path.join(absDir, 'package.json'), relDir)
      packages.push({ name, dir: relDir, manifestPath: manifestRel })
    }
  }

  // Decide the kind from INDICATORS, not from packages.length. A workspace
  // that declared globs which happened to resolve to zero member packages
  // is STILL a workspace — we shouldn't pretend it's a single-package repo
  // just because the directories are empty (the user told us the shape).
  // Single = no workspace markers at all.
  let kind: WorkspaceKind = 'single'
  if (indicators.includes('pnpm-workspace.yaml'))           kind = 'pnpm'
  else if (indicators.includes('lerna.json'))                kind = 'lerna'
  else if (indicators.includes('package.json#workspaces'))   kind = 'yarn' // could be npm or yarn — caller can refine on lockfile
  // Overlay markers win for reporting precision (nx/turbo ride on top).
  if (indicators.includes('turbo.json')) kind = 'turbo'
  if (indicators.includes('nx.json'))    kind = 'nx'

  // **Always return at least one package.** For a single-package repo (no
  // workspace declaration) OR a workspace where the globs resolved to zero
  // valid packages, fall back to the repo root if it has a package.json.
  // V2_PLAN.md §F21: "Single-package repos take the exact v1.5 path —
  // detectWorkspace returns one implicit package = repo root."
  if (packages.length === 0 && rootPkg && existsSync(rootPkgPath)) {
    packages.push({
      name: typeof rootPkg.name === 'string' && rootPkg.name.trim()
        ? rootPkg.name.trim()
        : path.basename(repoPath),
      dir: '.',
      manifestPath: 'package.json',
    })
  }

  // Deterministic order so the same repo always reports the same package list
  // (eval bench + tests depend on stable ordering across runs).
  packages.sort((a, b) => a.dir.localeCompare(b.dir))

  return { kind, packages, indicators, resolvedGlobs, unresolvedPatterns }
}
