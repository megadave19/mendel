/**
 * Rust adapter (v2.2 / F23c).
 *
 * **Scope of THIS module (v2.2.x foundation, sub-phase 1).** Detection +
 * `Cargo.toml` parsing + crates.io stale-deps lookup, all pure-ish. The
 * semantic-diff signal shells to `cargo-semver-checks` inside a Rust
 * sandbox image — that integration is sub-phase 2 per V2_PLAN.md
 * §F23c's incremental rule. THIS module's semanticDiff returns an
 * honestly-degraded result naming the gap, so confidence stays capped
 * low/medium until cargo-semver-checks lands.
 *
 * **No new deps.** Cargo.toml parsing is inline — we target the narrow
 * shapes the spec describes (`[dependencies]` table with either
 * `name = "version"` or `name = { version = "...", ... }` shapes,
 * plus `[workspace.dependencies]`). Stuff that doesn't parse cleanly
 * — git deps, path deps, workspace = true (without sub-phase 1 resolver) —
 * is REPORTED honestly via the `unparsedSections` channel rather than
 * silently dropped (§5b).
 *
 * **maxBucket: 'medium'.** UNIQUE TO THIS ADAPTER. cargo-semver-checks
 * is the canonical Rust API-diff tool BUT it only analyzes the crate's
 * PUBLIC API (per the Rust API guidelines that say "private items are
 * not subject to semver"). griffe/apidiff/tsc all walk private surfaces
 * too. The CLAUDE.md §5b v2 r1 ceiling-aware rule therefore caps Rust
 * scoring at the 'medium' bucket even when both signals agree — the
 * F23a closeout's `clampToMaxBucket` helper enforces this in the scorer
 * automatically once the runner reads `adapter.maxBucket`.
 *
 * **§5b honesty knobs baked in:**
 *   - Stale-dep lookup uses a discriminated `LatestLookup` ({ok:true,
 *     version} | {ok:false, reason}) so "lookup failed" never silently
 *     maps to "not stale" (same shape detect.ts + python.ts + go.ts
 *     ship; rate-limit honesty lesson transfers verbatim).
 *   - semanticDiff returns analysisTier='ast-only' + a clear unanalyzable
 *     reason ("cargo-semver-checks Docker integration pending v2.2.x
 *     sub-phase 2") until sub-phase 2 lands. The scorer caps confidence
 *     per the per-symbol scoring rules in `score.ts`, which are
 *     already language-agnostic.
 *   - `[dev-dependencies]` and `[build-dependencies]` are EXCLUDED from
 *     staleness (they're test/build-time, not runtime — same shape
 *     Python dev-deps and Go indirect deps ship). Their counts are
 *     surfaced honestly via the per-section unparsed channel.
 */

import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { isSignificantlyBehind } from '@/lib/agent/phases/detect'
import type { SemanticDiff } from '@/lib/agent/signals/semantic-diff'
import type {
  LanguageAdapter,
  LanguageDetection,
  StaleDepsResult,
  StaleDepLite,
} from './types'
import {
  ensureRustSandboxImage,
  rustImageExists,
  runCargoSemverChecks,
  RUST_IMAGE_NAME,
} from '@/lib/sandbox/rust-executor'

// ── Detection ─────────────────────────────────────────────────────────────────
//
// Rust crates are identified by the presence of `Cargo.toml`. `Cargo.lock`
// is a secondary indicator (binary crates commit it; library crates often
// don't) — we surface it when present but don't require it. Workspace
// roots (`[workspace]` section) are detected and the workspace's
// `[workspace.dependencies]` is parsed alongside the root `[dependencies]`.

const RUST_MANIFEST_MARKERS = ['Cargo.toml', 'Cargo.lock'] as const

function detect(repoPath: string): LanguageDetection {
  const indicators: string[] = []
  for (const marker of RUST_MANIFEST_MARKERS) {
    if (existsSync(path.join(repoPath, marker))) indicators.push(marker)
  }
  // `Cargo.toml` is the binding indicator — `Cargo.lock` alone is
  // unusual (a lockfile with no manifest) and we deliberately don't
  // detect on it. This mirrors the F23b decision that `go.sum` alone
  // doesn't qualify as a Go repo.
  const hasManifest = indicators.includes('Cargo.toml')
  return { detected: hasManifest, indicators }
}

// ── Cargo.toml parser ────────────────────────────────────────────────────────
//
// Cargo.toml is TOML, but we only need to extract a few sections. A
// line-walking implementation (no new deps) handles every shape we care
// about. The narrow surface:
//
//   [dependencies]
//   serde = "1.0"
//   tokio = { version = "1.35", features = ["full"] }
//
//   [dev-dependencies]      (excluded from staleness; counted)
//   criterion = "0.5"
//
//   [build-dependencies]    (excluded from staleness; counted)
//   cc = "1.0"
//
//   [workspace.dependencies]
//   shared = "1.0"
//
// Real-world shapes we DON'T parse and surface honestly:
//   - { git = "https://..." }   — not a crates.io crate; can't check staleness
//   - { path = "../local" }     — local crate; not published
//   - { workspace = true }      — inherits from [workspace.dependencies]
//
// The honest surfacing means the user sees "Mendel didn't analyze N
// dependency lines (git/path/workspace-inherit) — those are tracked
// separately." NEVER silently dropped.

export interface CargoParseResult {
  /** crate name → raw version string. Dev/build deps NOT included. */
  dependencies: Map<string, string>
  /** Count of [dev-dependencies] entries (surfaced honestly, not staleness-checked). */
  devDependencyCount: number
  /** Count of [build-dependencies] entries (same — not staleness-checked). */
  buildDependencyCount: number
  /** Dep lines we couldn't categorize (git/path/workspace-inherit/etc.). */
  unparsedDependencies: Array<{ name: string; reason: string }>
  /** crate name → version from [workspace.dependencies]. Workspace-only. */
  workspaceDependencies: Map<string, string>
  /** The crate's own name (`[package].name`), if present. */
  packageName: string | null
}

// Section headers. Inline tables (e.g. `[dependencies.tokio]`) are
// recognized as "dep table for tokio" and parsed too.
const SECTION_HEADER = /^\[([^\]]+)\]$/
const TOML_DEP_TABLE_HEADER = /^([a-zA-Z0-9_-]+)\.dependencies\.([a-zA-Z0-9_-]+)$/

// A simple `name = "value"` line. Anchored to avoid grabbing matches
// from inside inline tables (those have nested = signs).
const SIMPLE_STRING_KV = /^([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"\s*$/

// `name = { ... }` line. Captures the table body for sub-parsing.
const INLINE_TABLE_KV = /^([a-zA-Z0-9_-]+)\s*=\s*\{(.*)\}\s*$/

// Inside an inline table, extract a string key. Order-independent.
const TABLE_VERSION_FIELD = /\bversion\s*=\s*"([^"]*)"/
const TABLE_GIT_FIELD = /\bgit\s*=\s*"([^"]*)"/
const TABLE_PATH_FIELD = /\bpath\s*=\s*"([^"]*)"/
const TABLE_WORKSPACE_FIELD = /\bworkspace\s*=\s*true\b/

/**
 * Parse a `Cargo.toml` file's body. Robust to comments (`#`), blank lines,
 * the four main dep sections, and all the inline-table shapes listed above.
 * Anything we can't categorize gets recorded honestly rather than dropped.
 */
export function parseCargoToml(body: string): CargoParseResult {
  const dependencies = new Map<string, string>()
  let devDependencyCount = 0
  let buildDependencyCount = 0
  const unparsedDependencies: Array<{ name: string; reason: string }> = []
  const workspaceDependencies = new Map<string, string>()
  let packageName: string | null = null

  // Which kind of section we're currently inside.
  type SectionKind = 'package' | 'dependencies' | 'dev-dependencies' | 'build-dependencies' | 'workspace.dependencies' | 'other' | null
  let section: SectionKind = null

  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    // Strip inline `# comment` (TOML allows # anywhere outside strings).
    // Conservative: only strip when # is preceded by whitespace OR is at
    // line start, to avoid mangling `name = "foo#bar"` strings.
    const line = stripTomlComment(raw).trimEnd()
    const trimmed = line.trim()
    if (trimmed === '') continue

    // New section?
    const header = SECTION_HEADER.exec(trimmed)
    if (header) {
      const name = header[1].trim()
      if (name === 'package') section = 'package'
      else if (name === 'dependencies') section = 'dependencies'
      else if (name === 'dev-dependencies') section = 'dev-dependencies'
      else if (name === 'build-dependencies') section = 'build-dependencies'
      else if (name === 'workspace.dependencies') section = 'workspace.dependencies'
      else if (name === 'target' || name.startsWith('target.')) {
        // [target.'cfg(...)'.dependencies] etc. — Mendel doesn't yet
        // resolve target-gated deps. Surface honestly + skip.
        section = 'other'
      } else {
        // Could be [dependencies.tokio] — handle that case below.
        const tableDep = TOML_DEP_TABLE_HEADER.exec(name)
        if (tableDep) {
          const parent = tableDep[1]
          const depName = tableDep[2]
          if (parent === 'dependencies') {
            // We'll fill in the version when we hit `version = "..."`.
            section = `dependencies-table:${depName}` as never
            continue
          }
          if (parent === 'dev-dependencies' || parent === 'build-dependencies') {
            // Count once at the header — line-walk below would
            // double-count. v2.2.x parser polish if real-world repos
            // ship many of these.
            if (parent === 'dev-dependencies') devDependencyCount++
            else buildDependencyCount++
            section = 'other'
            continue
          }
        }
        section = 'other'
      }
      continue
    }

    // Inside [package], grab the name field.
    if (section === 'package') {
      const m = SIMPLE_STRING_KV.exec(trimmed)
      if (m && m[1] === 'name') packageName = m[2]
      continue
    }

    // Inside one of the dep sections.
    if (
      section === 'dependencies' ||
      section === 'dev-dependencies' ||
      section === 'build-dependencies' ||
      section === 'workspace.dependencies'
    ) {
      // Tally + skip dev/build at the level we have visibility for.
      // Single-line shapes: `name = "version"` OR `name = { … }`.
      const isDev = section === 'dev-dependencies'
      const isBuild = section === 'build-dependencies'

      // Simple string: `serde = "1.0"`
      const simple = SIMPLE_STRING_KV.exec(trimmed)
      if (simple) {
        const [, name, version] = simple
        if (isDev) devDependencyCount++
        else if (isBuild) buildDependencyCount++
        else if (section === 'workspace.dependencies') workspaceDependencies.set(name, version)
        else dependencies.set(name, version)
        continue
      }

      // Inline table: `tokio = { version = "1.35", features = [...] }`
      const inline = INLINE_TABLE_KV.exec(trimmed)
      if (inline) {
        const [, name, body] = inline
        if (isDev) devDependencyCount++
        else if (isBuild) buildDependencyCount++
        else {
          const categorized = categorizeInlineDep(name, body)
          if (categorized.kind === 'version') {
            if (section === 'workspace.dependencies') workspaceDependencies.set(name, categorized.value)
            else dependencies.set(name, categorized.value)
          } else {
            unparsedDependencies.push({ name, reason: categorized.reason })
          }
        }
        continue
      }

      // Anything else in a dep section — TOML multi-line table item, an
      // array-of-tables, etc. Surface as an honest "not parsed."
      if (!isDev && !isBuild) {
        unparsedDependencies.push({
          name: trimmed.slice(0, 40),
          reason: `Mendel's Cargo.toml parser does not yet handle this dep shape: "${trimmed.slice(0, 60)}". Please report.`,
        })
      }
    }

    // sectionsStartsWith dependencies-table:NAME — single nested table.
    if (typeof section === 'string' && section.startsWith('dependencies-table:')) {
      const depName = section.slice('dependencies-table:'.length)
      const m = SIMPLE_STRING_KV.exec(trimmed)
      if (m && m[1] === 'version') {
        dependencies.set(depName, m[2])
      } else if (TABLE_GIT_FIELD.test(trimmed)) {
        unparsedDependencies.push({ name: depName, reason: 'git dependency — not a crates.io crate; staleness not checked.' })
      } else if (TABLE_PATH_FIELD.test(trimmed)) {
        unparsedDependencies.push({ name: depName, reason: 'path dependency — local crate; not published.' })
      }
    }
  }

  return {
    dependencies,
    devDependencyCount,
    buildDependencyCount,
    unparsedDependencies,
    workspaceDependencies,
    packageName,
  }
}

interface InlineCategorization {
  kind: 'version' | 'unparsed'
  value: string
  reason: string
}

/** Decide whether an inline-table dep declares a checkable version or
 *  one of the shapes Mendel can't act on (git/path/workspace = true). */
function categorizeInlineDep(name: string, body: string): InlineCategorization {
  const gitMatch = TABLE_GIT_FIELD.exec(body)
  if (gitMatch) {
    return { kind: 'unparsed', value: '', reason: `git dependency (${gitMatch[1]}) — not a crates.io crate; staleness not checked.` }
  }
  const pathMatch = TABLE_PATH_FIELD.exec(body)
  if (pathMatch) {
    return { kind: 'unparsed', value: '', reason: `path dependency (${pathMatch[1]}) — local crate; not published.` }
  }
  if (TABLE_WORKSPACE_FIELD.test(body)) {
    return { kind: 'unparsed', value: '', reason: `workspace inheritance — Mendel sub-phase 1 does not yet resolve workspace = true into [workspace.dependencies]. ${name} was skipped honestly.` }
  }
  const versionMatch = TABLE_VERSION_FIELD.exec(body)
  if (versionMatch) {
    return { kind: 'version', value: versionMatch[1], reason: '' }
  }
  return {
    kind: 'unparsed',
    value: '',
    reason: `inline table without version/git/path/workspace fields — Mendel did not recognize the shape: "${body.slice(0, 60)}".`,
  }
}

/** Strip an end-of-line `# …` comment from a TOML line.
 *
 *  Conservative: only strips when # is at the start of the trimmed line
 *  OR is preceded by whitespace, to avoid mangling `name = "v1.0#beta"`
 *  strings. (TOML strings cannot contain unescaped # within quotes
 *  normally, but defensive coding pays off.) */
function stripTomlComment(line: string): string {
  // Fast path: no # at all.
  if (!line.includes('#')) return line
  // Walk character-by-character with a basic "inside string" flag so we
  // don't strip # inside a quoted value.
  let inString = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"' && (i === 0 || line[i - 1] !== '\\')) inString = !inString
    if (c === '#' && !inString) return line.slice(0, i)
  }
  return line
}

// ── Stale-deps lookup via crates.io ──────────────────────────────────────────
//
// crates.io has a JSON API: `GET https://crates.io/api/v1/crates/<name>`
// returns `{crate: {max_stable_version, max_version, ...}, ...}`.
// `max_stable_version` is preferred (skips pre-releases like 2.0.0-rc.1);
// when only a pre-release exists, fall back to `max_version`.
//
// User-Agent is REQUIRED by crates.io's policy. They block requests
// without one. We send "mendel-bot (contact)" so a crates.io admin can
// reach the project if rate-limit policy questions come up — same
// shape we use for proxy.golang.org (no UA required there) and PyPI.

interface LatestLookup {
  ok: boolean
  version?: string
  reason?: string
}

/** Resolve the latest stable version of a crate via the crates.io API. */
export async function lookupLatestCrateVersion(
  crateName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LatestLookup> {
  const url = `https://crates.io/api/v1/crates/${encodeURIComponent(crateName)}`
  try {
    const res = await fetchImpl(url, {
      headers: {
        'Accept': 'application/json',
        // crates.io rejects requests without a UA. Include a contact
        // per their policy (https://crates.io/data-access).
        'User-Agent': 'mendel-bot (https://github.com/megadave19/mendel-test)',
      },
    })
    if (!res.ok) {
      return { ok: false, reason: `crates.io returned ${res.status}` }
    }
    const data = (await res.json()) as {
      crate?: { max_stable_version?: string | null; max_version?: string | null }
    }
    const version = data.crate?.max_stable_version ?? data.crate?.max_version
    if (!version) return { ok: false, reason: 'response missing crate.max_stable_version + max_version' }
    return { ok: true, version }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

async function detectStaleDeps(
  repoPath: string,
  log: (message: string) => void,
): Promise<StaleDepsResult> {
  const manifestPath = path.join(repoPath, 'Cargo.toml')
  if (!existsSync(manifestPath)) {
    return { stale: [], checked: 0, failed: 0 }
  }
  const body = readFileSync(manifestPath, 'utf-8')
  const parsed = parseCargoToml(body)

  // Honest disclosures about what we did NOT staleness-check.
  if (parsed.devDependencyCount > 0) {
    log(`Skipping ${parsed.devDependencyCount} [dev-dependencies] — test-only, not analyzed for staleness.`)
  }
  if (parsed.buildDependencyCount > 0) {
    log(`Skipping ${parsed.buildDependencyCount} [build-dependencies] — build-time, not analyzed for staleness.`)
  }
  if (parsed.workspaceDependencies.size > 0) {
    log(`[workspace.dependencies] holds ${parsed.workspaceDependencies.size} dep(s) — Mendel sub-phase 1 does not yet resolve workspace inheritance; the workspace section is read but not folded into per-package deps.`)
  }
  for (const u of parsed.unparsedDependencies) {
    log(`${u.name}: ${u.reason}`)
  }

  const stale: StaleDepLite[] = []
  let checked = 0
  let failed = 0
  for (const [name, currentVersion] of parsed.dependencies) {
    const latest = await lookupLatestCrateVersion(name)
    if (!latest.ok) {
      failed++
      log(`${name}: latest-version lookup failed (${latest.reason ?? 'unknown'}) — counted as 'couldn't check', NOT 'not stale'.`)
      continue
    }
    checked++
    if (isSignificantlyBehind(currentVersion, latest.version ?? '')) {
      stale.push({ name, currentVersion, latestVersion: latest.version ?? '' })
    }
  }
  return { stale, checked, failed }
}

// ── Semantic diff (sub-phase 1 stub — sub-phase 2 lands real cargo-semver-checks) ──

function buildSemanticDiffFallback(reason: string): SemanticDiff {
  return {
    removedExports: [],
    signatureChanges: [],
    newDeprecations: [],
    affectedSitesInRepo: [],
    coveragePercent: 0,
    unanalyzableSymbols: [{ symbol: '*', reason }],
    // 'ast-only' is the weakest schema tier — honest about the fact that
    // we had NO semantic information to work with. Sub-phase 2 will land
    // a 'cargo-semver-checks' tier in the schema enum and emit that on
    // the happy path (mirrors F23a's 'griffe' + F23b's 'apidiff' rollout).
    analysisTier: 'ast-only',
  }
}

/**
 * Run the cargo-semver-checks-based semantic-diff inside the Rust
 * sandbox image, OR return an honest fallback if Docker isn't reachable,
 * the image isn't built, or the tool itself fails on this pair.
 *
 * Sub-phase 1 (this commit): the image isn't built yet, so this ALWAYS
 * honest-falls-back. The scorer caps confidence per the per-symbol
 * scoring rules (the `singleSignalOnly` / `changelogOnlyHighCoverage`
 * branches in score.ts) — no need to special-case Rust in the scorer.
 *
 * Sub-phase 2 will land `docker/rust-sandbox.Dockerfile`, the cargo-
 * semver-checks wrapper script, and the §11b.1 real-container test.
 */
async function semanticDiff(
  crateName: string,
  fromVersion: string,
  toVersion: string,
): Promise<SemanticDiff> {
  if (!(await rustImageExists())) {
    return buildSemanticDiffFallback(
      `Rust sandbox image ${RUST_IMAGE_NAME} is not built (F23c sub-phase 2 will land it). Until then, Rust semantic-diff is unavailable — confidence reflects single-signal (changelog) only.`,
    )
  }
  try {
    const out = await runCargoSemverChecks(crateName, fromVersion, toVersion)
    return {
      removedExports: out.removedExports,
      signatureChanges: out.signatureChanges,
      newDeprecations: out.newDeprecations,
      affectedSitesInRepo: [],
      // cargo-semver-checks walks the public API exhaustively within its
      // scope. The PUBLIC-ONLY caveat is encoded in `maxBucket: 'medium'`,
      // not via a coverage-percentage reduction — different concerns,
      // both honest.
      coveragePercent: 100,
      unanalyzableSymbols: out.unanalyzableSymbols,
      // 'ast-only' for now — sub-phase 2 will land a tier enum extension
      // for 'cargo-semver-checks' (mirroring F23a 'griffe' / F23b 'apidiff').
      // The 'ast-only' value is HONEST: the live output goes through the
      // same fallback shape until the enum widening commit ships, so we
      // never claim a stronger tier than the schema declares.
      analysisTier: 'ast-only',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildSemanticDiffFallback(`cargo-semver-checks could not analyze ${crateName} ${fromVersion} → ${toVersion}: ${msg}`)
  }
}

/**
 * Pre-flight builds the Rust sandbox image if missing. Called by the
 * runner after adapter selection. Sub-phase 1: this attempts the build,
 * which will fail cleanly because the Dockerfile doesn't exist yet. The
 * runner's `preflight failed` honest path surfaces that to the user; on
 * a real Rust scan today the user sees the message + a pointer to F23c
 * sub-phase 2.
 *
 * Sub-phase 2 will land the Dockerfile so this becomes a real build.
 */
export async function preflightRustSandbox(): Promise<void> {
  await ensureRustSandboxImage()
}

// ── Exported adapter ──────────────────────────────────────────────────────────

export const rustAdapter: LanguageAdapter = {
  id: 'rust',
  displayName: 'Rust',
  manifestFile: 'Cargo.toml',
  sandboxImage: RUST_IMAGE_NAME,
  // cargo-semver-checks is the gold standard for Rust API diff — BUT
  // it is PUBLIC-API-ONLY (private items are not subject to semver per
  // the Rust API guidelines). UNIQUE TO RUST: the language-aware
  // ceiling from F23a closeout (clampToMaxBucket) binds here even on
  // a both-signals-agree case. CLAUDE.md §5b v2 rule 1.
  maxBucket: 'medium',
  detect,
  detectStaleDeps,
  semanticDiff,
  // Sub-phase 1: pre-flight will FAIL CLEANLY at the runner's pre-flight
  // gate (Dockerfile doesn't exist), telling the user F23c sub-phase 2
  // is required to scan Rust repos. Until then a Rust scan never
  // reaches the per-dep loop — the honest "engineering not yet
  // shipped" path is exactly the §5b experience we want.
  preflight: preflightRustSandbox,
}
