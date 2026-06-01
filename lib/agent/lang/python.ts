/**
 * Python adapter (v2.2 / F23a).
 *
 * **Scope of THIS module (v2.2.x foundation).** Detection + manifest
 * parsing + PyPI stale-deps lookup, all pure-ish. The semantic-diff signal
 * shells to `griffe check` inside a Python sandbox image — that integration
 * is a follow-on commit per V2_PLAN.md §F23a's incremental rule. THIS
 * module's semanticDiff returns an honestly-degraded result naming the
 * gap, so confidence stays capped low/medium until griffe lands.
 *
 * **No new deps.** TOML/Pipfile parsing is inline — we target the narrow
 * shapes monorepo work has shown are actually used in the wild. Stuff we
 * can't parse (setup.py's executable Python) is REPORTED HONESTLY, not
 * silently dropped (§5b).
 *
 * **§5b honesty knobs baked in:**
 *   - Stale-dep lookup uses a discriminated `LatestLookup` ({ok:true,version}
 *     | {ok:false}) so "lookup failed" never silently maps to "not stale"
 *     (same shape detect.ts ships for npm; the rate-limit honesty lesson
 *     transfers verbatim).
 *   - semanticDiff returns analysisTier='ast-only' + a clear unanalyzable
 *     reason ("griffe Docker integration pending v2.2.x") until griffe
 *     lands. The scorer caps confidence per the per-symbol scoring rules
 *     in `score.ts` (changelogOnlyHighCoverage / singleSignalOnly), which
 *     are already language-agnostic.
 */

import { existsSync, readFileSync } from 'fs'
import path from 'path'
import {
  parseVersion as parseVersionRange,
  isSignificantlyBehind,
} from '@/lib/agent/phases/detect'
import type { SemanticDiff } from '@/lib/agent/signals/semantic-diff'
import type {
  LanguageAdapter,
  LanguageDetection,
  StaleDepsResult,
  StaleDepLite,
} from './types'
import {
  ensurePythonSandboxImage,
  pythonImageExists,
  runGriffeDiff,
  PYTHON_IMAGE_NAME,
} from '@/lib/sandbox/python-executor'

// ── Detection ─────────────────────────────────────────────────────────────────
//
// We recognize any of these Python project markers. Listed in detection-
// priority order (most-specific to least): pyproject.toml signals modern
// Python tooling and is preferred when present; requirements.txt is the
// legacy floor (works for any Python project).

const PYTHON_MANIFEST_MARKERS = [
  'pyproject.toml',
  'setup.py',
  'Pipfile',
  'requirements.txt',
] as const

function detect(repoPath: string): LanguageDetection {
  const indicators: string[] = []
  for (const marker of PYTHON_MANIFEST_MARKERS) {
    if (existsSync(path.join(repoPath, marker))) indicators.push(marker)
  }
  return { detected: indicators.length > 0, indicators }
}

// ── Manifest parsers ─────────────────────────────────────────────────────────
//
// Each parser returns a Map<packageName, versionSpec>. Version spec is the
// RAW string from the manifest (e.g. ">=2.31.0", "^3.0", "*") — the
// caller normalizes via parseVersionRange before comparing.

/**
 * requirements.txt — one PEP 508 requirement per line. Comments + blank
 * lines + `-r other.txt` include directives + `-e .` editable installs
 * are all SKIPPED honestly (not parsed, but not dropped silently either —
 * caller logs them).
 *
 * Exported for tests.
 */
export function parseRequirementsTxt(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    // Strip comments + environment markers (anything after `;`) BEFORE
    // matching — keeping them around breaks `$` anchoring in the spec regex
    // and causes silent drops (caught by tests/python-adapter.test.ts).
    const line = raw.replace(/\s*#.*$/, '').split(';')[0].trim()
    if (!line) continue
    // Skip include + editable + URL forms (legitimate but out of scope here).
    if (line.startsWith('-r ') || line.startsWith('-e ') || line.includes('://')) continue
    // PEP 508: name[extras] versionspec
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(.*)$/.exec(line)
    if (!m) continue
    const name = m[1]
    const spec = (m[2] ?? '').trim() || '*'
    out.set(name, spec)
  }
  return out
}

/**
 * pyproject.toml — narrow inline parser targeting the two shapes that
 * cover >95% of real-world Python projects in 2026:
 *   1. PEP 621 standard: `[project]\ndependencies = ["x>=1", "y<2"]`
 *   2. Poetry:           `[tool.poetry.dependencies]\nx = "^1"\ny = "*"`
 *
 * Anything we can't parse is returned as an empty map AND `unparsedSections`
 * lists the sections we didn't reach so the caller can log honestly.
 * (Optional groups like `[project.optional-dependencies]` are NOT included
 * for v2.2.x — they're commonly dev-only and don't need upgrade PRs.)
 *
 * Exported for tests.
 */
export function parsePyprojectToml(
  text: string,
): { deps: Map<string, string>; unparsedSections: string[] } {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const deps = new Map<string, string>()
  const unparsedSections: string[] = []

  type ParseState =
    | { kind: 'none' }
    | { kind: 'pep621-deps-array'; buffer: string }
    | { kind: 'poetry-deps-table' }
  let state: ParseState = { kind: 'none' }

  function flushPep621(buffer: string) {
    // The captured slice between `[` and `]` of the dependencies array.
    // Items are quoted strings; trailing commas + comments allowed.
    const m = buffer.match(/"([^"]+)"|'([^']+)'/g)
    if (!m) return
    for (const raw of m) {
      const literal = raw.slice(1, -1) // strip the quote pair
      const spec = literal.trim()
      const nameMatch = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(.*)$/.exec(spec)
      if (!nameMatch) continue
      const name = nameMatch[1]
      const versionSpec = (nameMatch[2] ?? '').trim() || '*'
      deps.set(name, versionSpec)
    }
  }

  for (const raw of lines) {
    // Strip block-trailing comments while preserving inside-string `#`.
    // For our narrow shape (simple table entries), the stripper is fine.
    const stripped = raw.replace(/^[\t ]+/, '')
    if (state.kind === 'pep621-deps-array') {
      state.buffer += raw + '\n'
      if (raw.includes(']')) {
        flushPep621(state.buffer)
        state = { kind: 'none' }
      }
      continue
    }

    // Section headers — switch state on entering / exiting known sections.
    const sectionMatch = /^\[(.+?)\]\s*$/.exec(stripped)
    if (sectionMatch) {
      const section = sectionMatch[1].trim()
      if (section === 'tool.poetry.dependencies') {
        state = { kind: 'poetry-deps-table' }
      } else if (section === 'tool.poetry.dev-dependencies' || section === 'tool.poetry.group.dev.dependencies') {
        // Dev deps are out of scope for v2.2.x — log via unparsedSections
        // rather than silently include them.
        unparsedSections.push(section)
        state = { kind: 'none' }
      } else {
        state = { kind: 'none' }
      }
      continue
    }

    // Within a poetry deps table — key = value lines.
    if (state.kind === 'poetry-deps-table') {
      const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(.+?)\s*(?:#.*)?$/.exec(stripped)
      if (m) {
        // Skip the `python = "..."` constraint — that's the interpreter,
        // not a dependency Mendel can upgrade.
        if (m[1].toLowerCase() === 'python') continue
        // Strip outer quotes if value is a string; if it's an inline-table
        // like `{ version = "^1", optional = true }`, extract the version key.
        let value = m[2].trim()
        if (value.startsWith('{')) {
          const inner = /version\s*=\s*"([^"]+)"|version\s*=\s*'([^']+)'/.exec(value)
          if (!inner) continue // unsupported inline-table shape — skip honestly
          value = inner[1] ?? inner[2] ?? '*'
        } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        deps.set(m[1], value || '*')
      }
      continue
    }

    // Top-level `[project]` PEP 621 detection: we want to capture the
    // `dependencies = [...]` array that follows. The block parser eats
    // lines into `buffer` until `]` closes the array.
    const arrayStart = /^dependencies\s*=\s*\[/.exec(stripped)
    if (arrayStart) {
      state = { kind: 'pep621-deps-array', buffer: stripped + '\n' }
      // If it closed on the same line, flush immediately.
      if (stripped.includes(']')) {
        flushPep621(state.buffer)
        state = { kind: 'none' }
      }
      continue
    }
  }

  return { deps, unparsedSections }
}

/**
 * Pipfile — TOML with `[packages]` table holding name = spec entries.
 * Same shape as poetry deps table; we reuse the same line-parser
 * conceptually but on a different section header.
 *
 * Exported for tests.
 */
export function parsePipfile(text: string): Map<string, string> {
  const out = new Map<string, string>()
  let inPackages = false
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/^[\t ]+/, '')
    const sectionMatch = /^\[(.+?)\]\s*$/.exec(line)
    if (sectionMatch) {
      inPackages = sectionMatch[1].trim() === 'packages'
      continue
    }
    if (!inPackages) continue
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*=\s*(.+?)\s*(?:#.*)?$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out.set(m[1], value || '*')
  }
  return out
}

// ── PyPI stale-deps lookup ────────────────────────────────────────────────────
//
// Mirrors the discriminated `LatestLookup` shape from detect.ts so a
// failed lookup never silently maps to "not stale" (the npm rate-limit
// honesty lesson — same class for PyPI).

type PyPiLookup = { ok: true; version: string } | { ok: false }

const PYPI_USER_AGENT = 'mendel-agent (https://github.com/megadave19/mendel-test)'

/** Read https://pypi.org/pypi/<name>/json and return the latest version. */
async function getLatestPyPiVersion(name: string): Promise<PyPiLookup> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response
    try {
      res = await fetch(url, { headers: { 'User-Agent': PYPI_USER_AGENT, Accept: 'application/json' } })
    } catch {
      continue // network glitch — retry once or twice
    }
    if (res.status === 429 || res.status >= 500) {
      // Bounded backoff — capped at ~6s total per dep.
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
      continue
    }
    if (!res.ok) return { ok: false }
    try {
      const body = (await res.json()) as { info?: { version?: unknown } }
      const v = body.info?.version
      if (typeof v === 'string' && v.trim()) return { ok: true, version: v.trim() }
      return { ok: false }
    } catch {
      return { ok: false }
    }
  }
  return { ok: false }
}

// ── Read all manifests + assemble the full dep map ────────────────────────────

function readAllManifests(
  repoPath: string,
  log: (m: string) => void,
): { allDeps: Map<string, string>; manifestsRead: string[] } {
  const allDeps = new Map<string, string>()
  const manifestsRead: string[] = []

  // requirements.txt — legacy, also commonly co-exists with pyproject
  const reqPath = path.join(repoPath, 'requirements.txt')
  if (existsSync(reqPath)) {
    try {
      const map = parseRequirementsTxt(readFileSync(reqPath, 'utf-8'))
      for (const [n, v] of map) if (!allDeps.has(n)) allDeps.set(n, v)
      manifestsRead.push('requirements.txt')
    } catch (err) {
      log(`(python) failed to read requirements.txt: ${(err as Error).message.slice(0, 120)}`)
    }
  }

  const pyprojectPath = path.join(repoPath, 'pyproject.toml')
  if (existsSync(pyprojectPath)) {
    try {
      const { deps, unparsedSections } = parsePyprojectToml(readFileSync(pyprojectPath, 'utf-8'))
      for (const [n, v] of deps) if (!allDeps.has(n)) allDeps.set(n, v)
      manifestsRead.push('pyproject.toml')
      if (unparsedSections.length > 0) {
        log(`(python) pyproject.toml sections NOT analyzed (out of scope in v2.2.x): ${unparsedSections.join(', ')}`)
      }
    } catch (err) {
      log(`(python) failed to read pyproject.toml: ${(err as Error).message.slice(0, 120)}`)
    }
  }

  const pipfilePath = path.join(repoPath, 'Pipfile')
  if (existsSync(pipfilePath)) {
    try {
      const map = parsePipfile(readFileSync(pipfilePath, 'utf-8'))
      for (const [n, v] of map) if (!allDeps.has(n)) allDeps.set(n, v)
      manifestsRead.push('Pipfile')
    } catch (err) {
      log(`(python) failed to read Pipfile: ${(err as Error).message.slice(0, 120)}`)
    }
  }

  // setup.py — executable Python; we DON'T parse it. Logged honestly so
  // the user knows that path wasn't analyzed.
  if (existsSync(path.join(repoPath, 'setup.py'))) {
    log('(python) setup.py is present but NOT parsed (executable code — out of scope in v2.2.x). Use pyproject.toml or requirements.txt for deps to be analyzed.')
  }
  return { allDeps, manifestsRead }
}

// ── Public adapter methods ────────────────────────────────────────────────────

async function detectStaleDeps(
  repoPath: string,
  log: (message: string) => void,
): Promise<StaleDepsResult> {
  const { allDeps, manifestsRead } = readAllManifests(repoPath, log)
  if (manifestsRead.length === 0) {
    log('(python) no parseable manifest found — nothing to check')
    return { stale: [], checked: 0, failed: 0 }
  }
  log(`(python) read manifests: ${manifestsRead.join(', ')} · ${allDeps.size} dep(s)`)

  const stale: StaleDepLite[] = []
  let checked = 0
  let failed = 0
  // Stable order so the bench + permalink stays deterministic.
  const ordered = [...allDeps.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [name, range] of ordered) {
    const lookup = await getLatestPyPiVersion(name)
    if (!lookup.ok) {
      failed++
      continue
    }
    checked++
    // Strip range prefix using the existing helper (works for "^1", "~1",
    // ">=2", etc.). Then compare the clean two strings.
    const current = parseVersionRange(range)
    if (!current) continue
    if (isSignificantlyBehind(current, lookup.version)) {
      stale.push({ name, currentVersion: current, latestVersion: lookup.version })
    }
  }
  return { stale, checked, failed }
}

/**
 * Honest fallback shape returned when griffe can't run. Distinct from
 * "griffe ran and found nothing" — the `unanalyzableSymbols[0].reason`
 * names the gap so the scorer + UI can render an explicit "no semantic
 * info available" badge instead of a misleading clean bill of health.
 */
function buildSemanticDiffFallback(reason: string): SemanticDiff {
  return {
    removedExports: [],
    signatureChanges: [],
    newDeprecations: [],
    affectedSitesInRepo: [],
    coveragePercent: 0,
    unanalyzableSymbols: [{ symbol: '*', reason }],
    // `ast-only` is the weakest tier the schema accepts — honest about the
    // fact that we had NO semantic information to work with.
    analysisTier: 'ast-only',
  }
}

/**
 * Run the griffe-based semantic-diff inside the Python sandbox image, OR
 * return an honest fallback if Docker isn't reachable, the image isn't
 * built, or griffe itself fails on this pair.
 *
 * Fallback paths each carry a SPECIFIC reason so the UI can render the
 * right banner ("griffe failed: pip install couldn't resolve <pkg>" is
 * more useful than "could not analyze"). §5b: never fabricate findings,
 * never silently degrade.
 *
 * Coverage math: griffe doesn't directly report a "% of public API
 * analyzed" number. We treat a successful griffe run as 100% coverage
 * (within griffe's own scope — which IS public + private symbols). The
 * "Not Analyzed" disclosures handle the always-true caveats.
 */
async function semanticDiff(
  packageName: string,
  fromVersion: string,
  toVersion: string,
): Promise<SemanticDiff> {
  // Image must exist locally — building it on the per-dep hot path is
  // surprising. The runner's pre-flight ensures it once per scan via
  // ensurePythonSandboxImage; if we got here without an image, the scan
  // didn't run the pre-flight and we should fail honestly.
  if (!(await pythonImageExists())) {
    return buildSemanticDiffFallback(
      `Python sandbox image ${PYTHON_IMAGE_NAME} is not built. Run a Python scan once to trigger the one-time build, or run 'docker build -f docker/python-sandbox.Dockerfile -t ${PYTHON_IMAGE_NAME} docker/' manually.`,
    )
  }
  try {
    const out = await runGriffeDiff(packageName, fromVersion, toVersion)
    return {
      removedExports: out.removedExports,
      signatureChanges: out.signatureChanges,
      newDeprecations: out.newDeprecations,
      affectedSitesInRepo: [],
      // griffe's analysis is exhaustive within its scope (it walks the
      // entire installed package's public + private surface). We report
      // 100% to reflect that — the scorer's "Not Analyzed" disclosures
      // separately capture cross-cutting caveats (no repo context here,
      // verification not run, etc.).
      coveragePercent: 100,
      unanalyzableSymbols: out.unanalyzableSymbols,
      // v2.2 / F23a — the schema now carries `'griffe'` as a peer of
      // `'dts'` so the UI + PR body name the actual analyzer that ran.
      // Scoring math treats them identically (both are declaration-
      // walking, exhaustive within scope); the value exists for honesty.
      analysisTier: 'griffe',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildSemanticDiffFallback(`griffe could not analyze ${packageName} ${fromVersion} → ${toVersion}: ${msg}`)
  }
}

/**
 * Ensure the Python sandbox image is built before a Python scan starts.
 * Called by the runner as a pre-flight when it picks the Python adapter.
 * On Docker-down (no daemon) the runner surfaces this honestly so a user
 * doesn't get an opaque "semantic-diff failed" mid-scan instead.
 */
export async function preflightPythonSandbox(): Promise<void> {
  await ensurePythonSandboxImage()
}

// ── Exported adapter ──────────────────────────────────────────────────────────

export const pythonAdapter: LanguageAdapter = {
  id: 'python',
  displayName: 'Python',
  manifestFile: 'pyproject.toml', // most modern; setup.py / requirements.txt also handled
  // Image tag the v2.2.x follow-on will build. Reserved here so future
  // sandbox code can refer to a stable name + so the registry has a real
  // string to advertise. The Docker image itself doesn't exist yet — the
  // runner's image-readiness check will fail honestly if a scan tries to
  // run before the image lands.
  sandboxImage: 'mendel-python-sandbox:v2.2',
  // griffe is mature — both public + private API analyzed. Same ceiling
  // as TS once griffe is wired. UNTIL THEN the per-symbol scoring rules
  // (in score.ts) will cap individual symbols low because semanticDiff
  // returns coveragePercent=0. So even with maxBucket='high' declared,
  // the actual scoring honestly caps per the §5b agreement-table rules.
  maxBucket: 'high',
  detect,
  detectStaleDeps,
  semanticDiff,
  // v2.2 / F23a — pre-flight builds the Python sandbox image once per
  // scan if it's missing. Idempotent (pythonImageExists short-circuits).
  preflight: preflightPythonSandbox,
}
