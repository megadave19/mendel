/**
 * TypeScript adapter (v2.2 / F23 core).
 *
 * Wraps Mendel's existing TS pipeline behind the LanguageAdapter contract.
 * This module CONTAINS NO NEW LOGIC — every method delegates to the
 * functions the runner has been calling directly since v1.5. The point is
 * the SEAM: future Python/Go/Rust adapters plug into the same interface,
 * and the runner stops importing language-specific functions.
 *
 * **Byte-identical-behavior contract:** a TS scan that hits this adapter
 * should produce the SAME confidence score, issues, and PR body as the
 * pre-F23 runner. The unit tests for this module + the eval bench (which
 * exercises the real scorer pipeline) jointly enforce that.
 */

import { existsSync } from 'fs'
import path from 'path'
import { detectStaleDeps as runnerDetectStaleDeps } from '@/lib/agent/phases/detect'
import {
  parseSemanticDiff,
  type SemanticDiffOptions,
  type SemanticDiff,
} from '@/lib/agent/signals/semantic-diff'
import type {
  LanguageAdapter,
  LanguageDetection,
  StaleDepsResult,
} from './types'
import { IMAGE_NAME as NODE_SANDBOX_IMAGE } from '@/lib/sandbox/executor'

// ── Detection ─────────────────────────────────────────────────────────────────
// A repo is "TypeScript" (or JS, which we treat as the same adapter today —
// the existing pipeline already supports both) iff there's a package.json.
// tsconfig.json is a strong indicator but not required (JS-only repos route
// through the Tier-3 semantic-diff fallback that's already in place).

function detect(repoPath: string): LanguageDetection {
  const indicators: string[] = []
  if (existsSync(path.join(repoPath, 'package.json'))) indicators.push('package.json')
  if (existsSync(path.join(repoPath, 'tsconfig.json'))) indicators.push('tsconfig.json')
  return { detected: indicators.length > 0, indicators }
}

// ── Stale-deps + semantic-diff: pure delegation ───────────────────────────────

async function detectStaleDeps(
  repoPath: string,
  log: (message: string) => void,
): Promise<StaleDepsResult> {
  // The runner-side function already returns the {stale, checked, failed}
  // triple this adapter exposes; we just rename the type.
  const result = await runnerDetectStaleDeps(repoPath, log)
  return { stale: result.stale, checked: result.checked, failed: result.failed }
}

async function semanticDiff(
  packageName: string,
  fromVersion: string,
  toVersion: string,
  opts?: SemanticDiffOptions,
): Promise<SemanticDiff> {
  // No language-specific wrapping — the existing parseSemanticDiff already
  // handles JS-only repos via its Tier-3 fallback.
  return parseSemanticDiff(packageName, fromVersion, toVersion, opts)
}

// ── Exported adapter ──────────────────────────────────────────────────────────

export const typescriptAdapter: LanguageAdapter = {
  id: 'typescript',
  displayName: 'TypeScript / JavaScript',
  manifestFile: 'package.json',
  sandboxImage: NODE_SANDBOX_IMAGE,
  // tsc on .d.ts is the strongest available analyzer in any of our supported
  // languages. high is the max bucket TS can reach.
  maxBucket: 'high',
  detect,
  detectStaleDeps,
  semanticDiff,
  // parseBreakingChanges is intentionally omitted — the default GitHub
  // release-notes walker (`signals/changelog.ts`) is already language-
  // agnostic, and the runner calls it directly. Adapters override only
  // when a better authoritative source exists.
}
