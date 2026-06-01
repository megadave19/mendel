/**
 * Go adapter (v2.2 / F23b).
 *
 * **Scope of THIS module (v2.2.x foundation, sub-phase 1).** Detection +
 * `go.mod` parsing + proxy.golang.org stale-deps lookup, all pure-ish. The
 * semantic-diff signal shells to `apidiff` inside a Go sandbox image — that
 * integration is sub-phase 2 per V2_PLAN.md §F23b's incremental rule. THIS
 * module's semanticDiff returns an honestly-degraded result naming the
 * gap, so confidence stays capped low/medium until apidiff lands.
 *
 * **No new deps.** `go.mod` parsing is inline — we target the narrow shapes
 * the spec describes (`require <path> <version>` lines, optional `// indirect`
 * marker). Stuff that doesn't parse cleanly is REPORTED honestly via the
 * `unparsedSections` channel (analogous to Python's setup.py handling), not
 * silently dropped (§5b).
 *
 * **§5b honesty knobs baked in:**
 *   - Stale-dep lookup uses a discriminated `LatestLookup` ({ok:true,version}
 *     | {ok:false}) so "lookup failed" never silently maps to "not stale"
 *     (same shape detect.ts and python.ts ship; the rate-limit honesty
 *     lesson transfers verbatim).
 *   - semanticDiff returns analysisTier='ast-only' + a clear unanalyzable
 *     reason ("apidiff Docker integration pending v2.2.x sub-phase 2")
 *     until apidiff lands. The scorer caps confidence per the per-symbol
 *     scoring rules in `score.ts`, which are already language-agnostic.
 *   - `// indirect` deps are EXCLUDED from staleness (they're computed,
 *     not declared — same reason Python dev-deps are excluded). The list
 *     of skipped indirect deps is surfaced honestly so the user knows.
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
  ensureGoSandboxImage,
  goImageExists,
  runApidiff,
  GO_IMAGE_NAME,
} from '@/lib/sandbox/go-executor'

// ── Detection ─────────────────────────────────────────────────────────────────
//
// Go projects are identified by the presence of a `go.mod` file in the
// repo root. Workspaces (`go.work`) are listed as an indicator but the
// adapter operates on the rooted module — workspace-aware enumeration
// can land alongside F21 polyglot monorepo work in a future sub-phase.

const GO_MANIFEST_MARKERS = ['go.mod', 'go.sum', 'go.work'] as const

function detect(repoPath: string): LanguageDetection {
  const indicators: string[] = []
  for (const marker of GO_MANIFEST_MARKERS) {
    if (existsSync(path.join(repoPath, marker))) indicators.push(marker)
  }
  // `go.mod` is the binding indicator — `go.sum` alone (unusual) isn't
  // enough; `go.work` without `go.mod` is also rejected as Mendel's per-
  // package monorepo work isn't Go-aware yet.
  const hasGoMod = indicators.includes('go.mod')
  return { detected: hasGoMod, indicators }
}

// ── go.mod parser ─────────────────────────────────────────────────────────────
//
// The go.mod spec is narrow enough that a regex-and-line-walk implementation
// captures every shape we need: single-line `require`, block `require ( ... )`,
// the `// indirect` annotation. We also recognize `replace` / `exclude` /
// `retract` blocks and surface them in `unparsedSections` for honesty.
//
// Spec: https://go.dev/ref/mod#go-mod-file

export interface GoModParseResult {
  /** modulePath, raw version string. INDIRECT deps are excluded from this map. */
  requires: Map<string, string>
  /** Module paths flagged `// indirect`. Honest disclosure — never silently dropped. */
  indirectRequires: string[]
  /** `replace`/`exclude`/`retract` blocks present — Mendel doesn't act on them yet. */
  unparsedSections: string[]
  /** The module's own path (the `module` directive). Used for self-reference checks. */
  modulePath: string | null
}

const SINGLE_REQUIRE = /^require\s+(\S+)\s+(\S+)(?:\s*\/\/\s*(indirect))?\s*$/
const BLOCK_REQUIRE_ITEM = /^\s*(\S+)\s+(\S+)(?:\s*\/\/\s*(indirect))?\s*$/

/**
 * Parse a `go.mod` file's body. Robust to comments (`// ...`), blank lines,
 * single-line + block `require` directives, and the `// indirect` marker.
 * Anything we can't categorize is recorded in `unparsedSections` rather
 * than silently dropped (§5b).
 */
export function parseGoMod(body: string): GoModParseResult {
  const requires = new Map<string, string>()
  const indirectRequires: string[] = []
  const unparsedSections: string[] = []
  let modulePath: string | null = null

  const lines = body.split('\n')
  let inRequireBlock = false
  let inOtherBlock: null | 'replace' | 'exclude' | 'retract' = null

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    // Strip trailing `// comment` BUT preserve `// indirect` annotation —
    // it's a real semantic marker, not a comment we should drop. We
    // handle that distinction in the regex on the require line itself.
    const line = stripFullLineComment(rawLine).trimEnd()
    const trimmed = line.trim()
    if (trimmed === '') continue

    // Block-close
    if (trimmed === ')') {
      if (inRequireBlock) inRequireBlock = false
      else if (inOtherBlock) inOtherBlock = null
      continue
    }

    // `module example.com/foo`
    if (!modulePath && trimmed.startsWith('module ')) {
      modulePath = trimmed.replace(/^module\s+/, '').trim()
      continue
    }

    // `go 1.21` — ignored (not a dep)
    if (/^go\s+\d/.test(trimmed)) continue
    // `toolchain go1.22.0` — ignored (not a dep)
    if (/^toolchain\s+/.test(trimmed)) continue

    // Block-open: `require (`
    if (trimmed === 'require (') {
      inRequireBlock = true
      continue
    }
    // Block-open: `replace (` / `exclude (` / `retract (`
    if (trimmed === 'replace (' || trimmed === 'exclude (' || trimmed === 'retract (') {
      inOtherBlock = trimmed.split(' ')[0] as 'replace' | 'exclude' | 'retract'
      unparsedSections.push(inOtherBlock)
      continue
    }
    // Single-line `replace`/`exclude`/`retract`
    if (/^(replace|exclude|retract)\s+/.test(trimmed)) {
      unparsedSections.push(trimmed.split(/\s+/)[0])
      continue
    }

    // Inside a non-require block — note it once and move on.
    if (inOtherBlock) continue

    // Single-line `require foo v1`
    const single = SINGLE_REQUIRE.exec(trimmed)
    if (single && !inRequireBlock) {
      const [, p, v, indirect] = single
      if (indirect) indirectRequires.push(p)
      else requires.set(p, v)
      continue
    }

    // Block-item `foo v1`
    if (inRequireBlock) {
      const item = BLOCK_REQUIRE_ITEM.exec(trimmed)
      if (item) {
        const [, p, v, indirect] = item
        if (indirect) indirectRequires.push(p)
        else requires.set(p, v)
        continue
      }
    }

    // Anything else — surface honestly. Future-proofs the parser against
    // go.mod additions we don't recognize yet.
    if (!inRequireBlock && !inOtherBlock) {
      unparsedSections.push(`line ${i + 1}: ${trimmed.slice(0, 60)}`)
    }
  }

  return { requires, indirectRequires, unparsedSections, modulePath }
}

/** Strip an end-of-line `// …` comment.
 *
 *  EXCEPTION: `// indirect` is preserved on every line — it's a semantic
 *  marker the require-line regexes need to see. This matters most for
 *  BLOCK require items, which start with the package name (not `require`),
 *  so we can't gate the preservation on the keyword. Conservative + correct.
 *  Caught by the parseGoMod indirect-exclusion test before merge. */
function stripFullLineComment(line: string): string {
  const idx = line.indexOf('//')
  if (idx === -1) return line
  // Preserve `// indirect` annotations everywhere — the require-line regexes
  // depend on seeing them to mark a dep as indirect.
  if (/^\s*indirect\b/.test(line.slice(idx + 2))) return line
  return line.slice(0, idx)
}

// ── Stale-deps lookup via the Go module proxy ────────────────────────────────
//
// proxy.golang.org is the canonical public module proxy used by `go get` by
// default. The `@latest` endpoint returns a small JSON object with the
// `Version` field — exactly what we need for staleness comparison.
//
// Honest failure: an HTTP error is mapped to `{ok:false}` and the caller
// counts it as "couldn't check," NEVER as "not stale."

interface LatestLookup {
  ok: boolean
  version?: string
  reason?: string
}

/**
 * Resolve the latest version of a Go module via proxy.golang.org.
 *
 * Path normalization: per the Go modules spec, capital letters in the
 * module path must be replaced with `!<lowercased>` before sending to the
 * proxy (e.g. `github.com/Foo/Bar` → `github.com/!foo/!bar`). We apply
 * that escape here so heterogeneous module-path casing is correct.
 */
export async function lookupLatestGoVersion(
  modulePath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LatestLookup> {
  const escaped = encodeGoModulePath(modulePath)
  try {
    const res = await fetchImpl(`https://proxy.golang.org/${escaped}/@latest`, {
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) {
      return { ok: false, reason: `proxy.golang.org returned ${res.status}` }
    }
    const data = (await res.json()) as { Version?: string }
    if (!data.Version) return { ok: false, reason: 'response missing Version field' }
    return { ok: true, version: data.Version }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/** Per Go modules spec — uppercase letters in a module path are encoded
 *  as `!<lowercase>` before being sent to the module proxy. */
export function encodeGoModulePath(modulePath: string): string {
  return modulePath.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`)
}

async function detectStaleDeps(
  repoPath: string,
  log: (message: string) => void,
): Promise<StaleDepsResult> {
  const goModPath = path.join(repoPath, 'go.mod')
  if (!existsSync(goModPath)) {
    return { stale: [], checked: 0, failed: 0 }
  }
  const body = readFileSync(goModPath, 'utf-8')
  const parsed = parseGoMod(body)

  if (parsed.indirectRequires.length > 0) {
    log(`Skipping ${parsed.indirectRequires.length} indirect dep(s) — only direct requires are analyzed.`)
  }
  for (const section of parsed.unparsedSections) {
    log(`go.mod note: ${section} (not analyzed by Mendel — surfaced honestly).`)
  }

  const stale: StaleDepLite[] = []
  let checked = 0
  let failed = 0
  for (const [name, currentVersion] of parsed.requires) {
    const latest = await lookupLatestGoVersion(name)
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

// ── Semantic diff (sub-phase 1 stub — sub-phase 2 lands real apidiff) ────────

function buildSemanticDiffFallback(reason: string): SemanticDiff {
  return {
    removedExports: [],
    signatureChanges: [],
    newDeprecations: [],
    affectedSitesInRepo: [],
    coveragePercent: 0,
    unanalyzableSymbols: [{ symbol: '*', reason }],
    // 'ast-only' is the weakest schema tier — honest about the fact that
    // we had NO semantic information to work with. Sub-phase 2 will return
    // the new 'apidiff' tier (an enum extension will land alongside it).
    analysisTier: 'ast-only',
  }
}

/**
 * Run the apidiff-based semantic-diff inside the Go sandbox image, OR
 * return an honest fallback if Docker isn't reachable, the image isn't
 * built, or apidiff itself fails on this pair.
 *
 * Sub-phase 1 (this commit): the image isn't built yet, so this ALWAYS
 * honest-falls-back. The scorer caps confidence per the per-symbol
 * scoring rules (the `singleSignalOnly` / `changelogOnlyHighCoverage`
 * branches in score.ts) — no need to special-case Go in the scorer.
 *
 * Sub-phase 2 will land `docker/go-sandbox.Dockerfile`, the apidiff
 * wrapper script, and the §11b.1 real-container test.
 */
async function semanticDiff(
  modulePath: string,
  fromVersion: string,
  toVersion: string,
): Promise<SemanticDiff> {
  if (!(await goImageExists())) {
    return buildSemanticDiffFallback(
      `Go sandbox image ${GO_IMAGE_NAME} is not built (F23b sub-phase 2 will land it). Until then, Go semantic-diff is unavailable — confidence reflects single-signal (changelog) only.`,
    )
  }
  try {
    const out = await runApidiff(modulePath, fromVersion, toVersion)
    return {
      removedExports: out.removedExports,
      signatureChanges: out.signatureChanges,
      newDeprecations: out.newDeprecations,
      affectedSitesInRepo: [],
      // apidiff walks the entire public API surface, exhaustive within scope.
      coveragePercent: 100,
      unanalyzableSymbols: out.unanalyzableSymbols,
      // v2.2 / F23b sub-phase 2 — schema gained `'apidiff'` as a peer of
      // `'dts'`/`'griffe'`. Same lockstep rule as F23a: scoring math is
      // identical to other declaration-walking analyzers; the distinct
      // value exists so the UI + PR body name the analyzer that actually
      // ran. CLAUDE.md §5b.
      analysisTier: 'apidiff',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildSemanticDiffFallback(`apidiff could not analyze ${modulePath} ${fromVersion} → ${toVersion}: ${msg}`)
  }
}

/**
 * Pre-flight builds the Go sandbox image if missing. Called by the runner
 * after adapter selection. Sub-phase 1: this attempts the build, which
 * will fail cleanly because the Dockerfile doesn't exist yet. The runner's
 * `preflight failed` honest path surfaces that to the user; on a real Go
 * scan today the user sees the message + a pointer to F23b sub-phase 2.
 *
 * Sub-phase 2 will land the Dockerfile so this becomes a real build.
 */
export async function preflightGoSandbox(): Promise<void> {
  await ensureGoSandboxImage()
}

// ── Exported adapter ──────────────────────────────────────────────────────────

export const goAdapter: LanguageAdapter = {
  id: 'go',
  displayName: 'Go',
  manifestFile: 'go.mod',
  sandboxImage: GO_IMAGE_NAME,
  // apidiff is the gold standard for Go API diff — exhaustive over public
  // surface, declarative-driven. Same ceiling as TS. UNTIL the Docker
  // integration lands (sub-phase 2) the per-symbol scoring rules cap
  // confidence honestly because semanticDiff returns coveragePercent=0.
  maxBucket: 'high',
  detect,
  detectStaleDeps,
  semanticDiff,
  // Sub-phase 1: pre-flight will FAIL CLEANLY at the runner's pre-flight
  // gate (Dockerfile doesn't exist), telling the user F23b sub-phase 2
  // is required to scan Go repos. Until then a Go scan never reaches the
  // per-dep loop — the honest "engineering not yet shipped" path is
  // exactly the §5b experience we want.
  preflight: preflightGoSandbox,
}
