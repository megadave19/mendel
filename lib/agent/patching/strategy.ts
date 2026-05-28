/**
 * v1.5 Workstream #7 — Per-file patch strategy selector (TRD §7.2).
 *
 * Pure function. Picks between:
 *   - 'full-file'      → existing v1.0 full-file regeneration
 *   - 'search-replace' → v1.5 block-based patching (handles large files)
 *
 * TRD §7.2 thresholds:
 *   - Files < 150 lines: full-file regeneration (existing)
 *   - Files 150–500: search-replace blocks
 *   - Files > 500: hard-required search-replace blocks
 *
 * (For 150–500 the spec allows either; we pick search-replace because it
 *  consumes ~10× fewer tokens per file at that size and the block-application
 *  layer can fall back to full-file if the LLM returns malformed blocks.)
 */

export type PatchStrategy = 'full-file' | 'search-replace'

/** TRD §7.2 thresholds. Exported for tests + log messages. */
export const FULL_FILE_MAX_LINES = 150
export const SEARCH_REPLACE_REQUIRED_LINES = 500

export function chooseFilePatchStrategy(lineCount: number): PatchStrategy {
  if (!Number.isFinite(lineCount) || lineCount < 0) return 'full-file'
  if (lineCount < FULL_FILE_MAX_LINES) return 'full-file'
  return 'search-replace'
}

/**
 * Human-readable rationale string for runner logs. Tells the user WHY we
 * picked the strategy — surfaced in the live console so a confused user
 * doesn't have to dig into source to understand "why didn't this re-emit
 * the whole file?"
 */
export function explainPatchStrategy(lineCount: number, strategy: PatchStrategy): string {
  if (strategy === 'full-file') {
    return `${lineCount} lines · using full-file regeneration (under ${FULL_FILE_MAX_LINES}-line threshold)`
  }
  if (lineCount >= SEARCH_REPLACE_REQUIRED_LINES) {
    return `${lineCount} lines · using search-replace blocks (required above ${SEARCH_REPLACE_REQUIRED_LINES} lines)`
  }
  return `${lineCount} lines · using search-replace blocks (preferred above ${FULL_FILE_MAX_LINES} lines for token efficiency)`
}

/** Count lines in a string for strategy selection. Counts content lines —
 *  a trailing newline doesn't add an extra count. Matches `wc -l` + 1 for
 *  files without trailing newline. */
export function countLines(source: string): number {
  if (source.length === 0) return 0
  let n = 1
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) n++
  }
  // Trailing newline shouldn't count as an extra line of content.
  if (source.charCodeAt(source.length - 1) === 10) n--
  return n
}
