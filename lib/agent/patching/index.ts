/**
 * v1.5 Workstream #7 (runner integration) — patch strategy dispatcher.
 *
 * Single entry point the runner calls. Picks full-file vs search-replace per
 * TRD §7.2 line-count thresholds, dispatches, falls back full-file on
 * search-replace failure (so a malformed LLM response never blocks a scan).
 *
 * Re-exports `FilePatch` so callers don't need to know which strategy ran.
 */

import { existsSync, readFileSync } from 'fs'
import path from 'path'
import type { BreakingChange } from '@/lib/agent/signals/changelog'
import type { Diagnosis } from '@/lib/agent/phases/diagnose'
import type { StaleDep } from '@/lib/agent/phases/detect'
import { patchFile, type FilePatch } from './full-file'
import { patchFileViaBlocks } from './search-replace-patcher'
import { chooseFilePatchStrategy, countLines, explainPatchStrategy } from './strategy'

export type { FilePatch } from './full-file'

export interface PatchFileSmartResult {
  patch: FilePatch | null
  /** Strategy actually used (after any fallback). */
  strategyUsed: 'full-file' | 'search-replace' | 'fallback-full-file' | 'not-found'
  /** Line count seen at dispatch time (for runner logs). */
  lineCount: number
}

/**
 * Patch a single file using the best-fit strategy. Always returns — `null`
 * patch means we genuinely couldn't apply changes (file missing or LLM
 * failure on both paths). Caller handles the null.
 */
export async function patchFileSmart(
  repoPath: string,
  relativeFilePath: string,
  dep: StaleDep,
  breakingChanges: BreakingChange[],
  diagnosis: Diagnosis,
  emit: (msg: string) => void,
): Promise<PatchFileSmartResult> {
  const fullPath = path.join(repoPath, relativeFilePath)
  if (!existsSync(fullPath)) {
    emit(`  skip ${relativeFilePath} — not found`)
    return { patch: null, strategyUsed: 'not-found', lineCount: 0 }
  }

  // package.json gets the existing deterministic bumper from patchFile —
  // no strategy decision needed.
  if (relativeFilePath === 'package.json') {
    const patch = await patchFile(repoPath, relativeFilePath, dep, breakingChanges, diagnosis, emit)
    return { patch, strategyUsed: 'full-file', lineCount: 0 }
  }

  const lineCount = countLines(readFileSync(fullPath, 'utf-8'))
  const strategy = chooseFilePatchStrategy(lineCount)
  emit(`  Strategy: ${explainPatchStrategy(lineCount, strategy)}`)

  if (strategy === 'full-file') {
    const patch = await patchFile(repoPath, relativeFilePath, dep, breakingChanges, diagnosis, emit)
    return { patch, strategyUsed: 'full-file', lineCount }
  }

  // search-replace path with full-file fallback on failure
  const blockResult = await patchFileViaBlocks(repoPath, relativeFilePath, dep, breakingChanges, diagnosis, emit)
  if (blockResult.ok && blockResult.patch) {
    return { patch: blockResult.patch, strategyUsed: 'search-replace', lineCount }
  }

  emit(`  ↻ Falling back to full-file regeneration for ${relativeFilePath}`)
  const fallbackPatch = await patchFile(repoPath, relativeFilePath, dep, breakingChanges, diagnosis, emit)
  return { patch: fallbackPatch, strategyUsed: 'fallback-full-file', lineCount }
}
