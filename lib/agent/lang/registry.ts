/**
 * Language adapter registry (v2.2 / F23 core).
 *
 * One function: `selectAdapter(repoPath) → LanguageAdapter`. The runner
 * stops importing language-specific functions and asks the registry
 * instead. Each registered adapter declares its own `detect` predicate;
 * the registry calls them in priority order and returns the first match.
 *
 * v2.2.0 ships with ONLY the TypeScript adapter — Python/Go/Rust are
 * added in F23a/b/c. When no adapter matches we return a NULL-RESULT
 * (kept as `null`) so the runner can surface an honest "no analyzer
 * for this repo type" message rather than silently defaulting to TS.
 *
 * **Priority rationale:** the marker files are mostly disjoint
 * (package.json vs pyproject.toml vs go.mod vs Cargo.toml), so ordering
 * rarely matters. We list TS last DELIBERATELY so a hypothetical repo
 * with both a package.json (e.g. JS tooling) AND a pyproject.toml gets
 * routed to Python — the user's intent for a polyglot repo is almost
 * always "the more specific language is primary."
 */

import { typescriptAdapter } from './typescript'
import { pythonAdapter } from './python'
import type { LanguageAdapter } from './types'

// ── Registry ─────────────────────────────────────────────────────────────────
//
// Order matters: highest priority first. Adapters added in F23a/b/c slot in
// ahead of TypeScript so a polyglot repo's more-specific language wins.
//
// v2.2 / F23a — Python adapter registered AHEAD of TypeScript so a
// polyglot repo with both pyproject.toml AND package.json routes to
// Python (the user's intent for a polyglot repo is almost always "the
// more specific language is primary"). The Python adapter's
// `semanticDiff` is honestly degraded until v2.2.x wires griffe via
// Docker (per V2_PLAN.md §F23a's incremental rule); detection +
// stale-deps DO work today against real Python repos.
// (Future) const GO_ADAPTER   = ... (F23b)
// (Future) const RUST_ADAPTER = ... (F23c)
const REGISTERED: ReadonlyArray<LanguageAdapter> = [
  pythonAdapter,
  typescriptAdapter,
]

/**
 * Pick the adapter that owns this repo, or null when none matches.
 * Pure (no IO beyond the adapters' own `detect` calls), deterministic
 * (registration order is stable), and exported alongside `selectAdapter`
 * so tests can introspect what's registered.
 */
export function selectAdapter(repoPath: string): LanguageAdapter | null {
  for (const adapter of REGISTERED) {
    if (adapter.detect(repoPath).detected) return adapter
  }
  return null
}

/**
 * Returns the registered list — useful for tests + a future `/api/health`
 * surface that wants to report "Mendel supports: TS, …".
 */
export function registeredAdapters(): ReadonlyArray<LanguageAdapter> {
  return REGISTERED
}
