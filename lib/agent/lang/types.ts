/**
 * Language abstraction layer (v2.2 / F23 core).
 *
 * Mendel's agent pipeline was TS-specific in v1.x/v2.0/v2.1 — tsc compiler
 * API, @typescript-eslint/parser, package.json/pnpm. F23 generalizes it.
 * The honest engineering reality (V2_PLAN.md §F23): there is NO universal
 * API-diff tool. Each ecosystem has its own (griffe / apidiff /
 * cargo-semver-checks / tsc). The adapter is the seam where Mendel asks
 * "what would THIS language's analyzer do?" and gets back a normalized
 * `SemanticDiff` it can score uniformly.
 *
 * **Architecture rule:** the confidence scorer is already language-
 * agnostic (it operates on signal outputs, not language specifics). All
 * language asymmetry lives BELOW this interface. That's why F23 is
 * doable without re-architecting the scorer.
 *
 * **Honesty rule (§5b v2 rule 1, confidence ceilings are language-aware):**
 * each adapter declares its analyzer's MAXIMUM REACHABLE BUCKET. A
 * stronger analyzer (tsc on .d.ts) can reach 'high'; a weaker one
 * (cargo-semver-checks public-API-only) caps at 'medium' even when its
 * signals agree. Encoded here so it can never silently inflate.
 */

import type { BreakingChange } from '@/lib/agent/signals/changelog'
import type {
  SemanticDiff,
  SemanticDiffOptions,
} from '@/lib/agent/signals/semantic-diff'
import type { ConfidenceBucket } from '@/lib/agent/confidence/score'

// ── Public types ──────────────────────────────────────────────────────────────

/** Identifier the runner persists on Scan.language + Issue.language. */
export type LanguageId = 'typescript' | 'python' | 'go' | 'rust'

/** The shape `detectStaleDeps`-class functions return. */
export interface StaleDepLite {
  name: string
  currentVersion: string
  latestVersion: string
}
export interface StaleDepsResult {
  stale: StaleDepLite[]
  /** How many deps we successfully checked against the registry. */
  checked: number
  /** How many lookups failed (rate-limit / network / etc.). §5b honest. */
  failed: number
}

/**
 * The adapter's "is this me?" verdict. Detection is FILE-BASED and SYNC —
 * we look at marker files, never read the network. The registry calls
 * each registered adapter's `detect` in priority order; first match wins.
 */
export interface LanguageDetection {
  /** True iff this adapter can analyze the repo. */
  detected: boolean
  /** Marker files that matched (e.g. ['package.json', 'tsconfig.json']). */
  indicators: string[]
}

/**
 * The full LanguageAdapter contract. Implementations are pure modules
 * (no global state) — the runner builds one per scan from the registry.
 *
 * Methods that the v2.2.0 core foundation DOESN'T need yet are marked
 * `Optional` so per-language adapters can land incrementally without
 * forcing every method to be implemented up-front.
 */
export interface LanguageAdapter {
  /** Stable id persisted on Scan.language. */
  readonly id: LanguageId

  /** Human-readable display name (used in logs + UI badge tooltips). */
  readonly displayName: string

  /** Manifest file path (relative to repo root) this language operates on. */
  readonly manifestFile: string

  /** Docker image tag this adapter requires for sandbox phases. */
  readonly sandboxImage: string

  /**
   * Highest confidence bucket the language's analyzer can reach UNDER
   * IDEAL CONDITIONS. The scorer post-clamps to this when scoring an
   * issue from this language. Cannot be inflated by the runner per §5b
   * v2 rule 1 ("confidence ceilings are language-aware and disclosed").
   *   - typescript: 'high' (tsc on .d.ts is the strongest signal)
   *   - python:     'high' (griffe is mature; public + private analyzed)
   *   - go:         'high' (apidiff is the gold standard for Go API diff)
   *   - rust:       'medium' (cargo-semver-checks is public-API-only)
   */
  readonly maxBucket: ConfidenceBucket

  /** Detect whether this adapter applies to the given repo. */
  detect(repoPath: string): LanguageDetection

  /** Find stale dependencies for this language's manifest format. */
  detectStaleDeps(
    repoPath: string,
    log: (message: string) => void,
  ): Promise<StaleDepsResult>

  /**
   * Run the language-specific semantic-diff signal. Each adapter
   * normalizes its underlying analyzer's output into the shared
   * `SemanticDiff` shape so the scorer can stay language-agnostic.
   */
  semanticDiff(
    packageName: string,
    fromVersion: string,
    toVersion: string,
    opts?: SemanticDiffOptions,
  ): Promise<SemanticDiff>

  // ── Optional, per-language hooks (foundation can ship without them) ──

  /**
   * Run the changelog signal. Default: the existing GitHub release-notes
   * walker, which is already language-agnostic. Adapters override only
   * when a language has a better-than-GitHub authoritative source.
   */
  parseBreakingChanges?(
    packageName: string,
    fromVersion: string,
    toVersion: string,
    pat: string,
  ): Promise<BreakingChange[]>
}

// ── Default adapter factory pattern (helps adapters share boilerplate) ────────

/** Common shape every concrete adapter exports as its module default. */
export interface AdapterModule {
  adapter: LanguageAdapter
}
