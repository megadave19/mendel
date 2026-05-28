/**
 * v1.5 Workstream #7 — Search-replace block patching (TRD §7.2).
 *
 * Parses LLM responses in the industry-standard SEARCH/REPLACE block
 * format (aider-compatible). Applies blocks to source with:
 *   1. Exact string match first (fastest, most precise)
 *   2. Whitespace-normalized fuzzy fallback (handles indentation/trailing-
 *      whitespace drift between what the LLM sees and what's on disk)
 *
 * Each block that fails to match is surfaced individually in the result —
 * the caller (runner) can decide to retry with stricter context, fall back
 * to full-file regeneration, or report the failure to the user.
 *
 * Block format the LLM is expected to produce:
 *
 *   path/to/file.ts
 *   <<<<<<< SEARCH
 *   old code (must match disk content, exact or whitespace-normalized)
 *   =======
 *   new code (replaces the matched range)
 *   >>>>>>> REPLACE
 *
 * Multiple blocks per file are allowed; they're applied in source order.
 *
 * §5b honesty rules in code:
 *   - Failed blocks are NEVER silently dropped. The result `ok` flag and
 *     `failures[]` array surface every failure with a reason.
 *   - Empty SEARCH is rejected (would otherwise blindly prepend). Allowing
 *     it would let a malformed LLM response corrupt the file.
 */

import { z } from 'zod'

/* ─── Schemas ─────────────────────────────────────────────────────────────── */

export const SearchReplaceBlockSchema = z.object({
  filePath: z.string(),
  search: z.string(),
  replace: z.string(),
})
export type SearchReplaceBlock = z.infer<typeof SearchReplaceBlockSchema>

export const BlockFailureSchema = z.object({
  block: SearchReplaceBlockSchema,
  reason: z.string(),
})
export type BlockFailure = z.infer<typeof BlockFailureSchema>

export interface ApplyResult {
  ok: boolean
  newContent: string
  applied: number
  failures: BlockFailure[]
}

/* ─── Parser ──────────────────────────────────────────────────────────────── */

const SEARCH_MARKER = '<<<<<<< SEARCH'
const DIVIDER_MARKER = '======='
const REPLACE_MARKER = '>>>>>>> REPLACE'

/**
 * Parse the LLM's free-form text into a list of SearchReplaceBlocks. The
 * file path is the line IMMEDIATELY before each SEARCH marker. Files may
 * have multiple consecutive blocks targeting the same path.
 *
 * Whitespace + blank lines between blocks are ignored. Stray prose before
 * the first block or after the last is ignored too (LLMs love adding
 * explanatory text).
 */
export function parseSearchReplaceBlocks(text: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    // Find the next SEARCH marker
    if (lines[i].trim() !== SEARCH_MARKER) { i++; continue }

    // The file path is the most recent non-empty line BEFORE the SEARCH
    // marker that isn't itself a marker or fence-line.
    let filePath = ''
    for (let j = i - 1; j >= 0; j--) {
      const candidate = lines[j].trim()
      if (candidate === '' || candidate.startsWith('```')) continue
      if (candidate === SEARCH_MARKER || candidate === DIVIDER_MARKER || candidate === REPLACE_MARKER) break
      filePath = candidate
      break
    }

    // Collect SEARCH content until DIVIDER
    const searchLines: string[] = []
    i++
    while (i < lines.length && lines[i].trim() !== DIVIDER_MARKER) {
      searchLines.push(lines[i])
      i++
    }
    if (i >= lines.length) break // unclosed block — ignore

    // Skip the divider
    i++

    // Collect REPLACE content until REPLACE marker
    const replaceLines: string[] = []
    while (i < lines.length && lines[i].trim() !== REPLACE_MARKER) {
      replaceLines.push(lines[i])
      i++
    }
    if (i >= lines.length) break // unclosed block — ignore

    // Skip the REPLACE marker
    i++

    if (filePath !== '') {
      blocks.push({
        filePath,
        search: searchLines.join('\n'),
        replace: replaceLines.join('\n'),
      })
    }
  }
  return blocks
}

/* ─── Applier ─────────────────────────────────────────────────────────────── */

/**
 * Apply a list of blocks to a single file's content. Blocks are applied in
 * order; each lookup is against the CURRENT (post-previous-blocks) content,
 * so blocks can reference each other's modified state if needed.
 *
 * Match strategy per block:
 *   1. Exact match (string.indexOf) — fastest, most precise
 *   2. Whitespace-normalized fuzzy match — collapses runs of whitespace and
 *      trims line-trailing whitespace before comparison. Locates the
 *      original-content range that corresponds to the normalized match.
 *
 * Returns failures in order. `ok` is true iff every block applied.
 */
export function applyBlocksToFile(originalContent: string, blocks: SearchReplaceBlock[]): ApplyResult {
  let content = originalContent
  let applied = 0
  const failures: BlockFailure[] = []

  for (const block of blocks) {
    if (block.search === '') {
      failures.push({ block, reason: 'empty SEARCH — refusing to apply (would blindly prepend)' })
      continue
    }

    // 1. Exact match
    const exactIdx = content.indexOf(block.search)
    if (exactIdx !== -1) {
      content = content.slice(0, exactIdx) + block.replace + content.slice(exactIdx + block.search.length)
      applied++
      continue
    }

    // 2. Whitespace-normalized fuzzy fallback
    const fuzzyResult = applyFuzzy(content, block.search, block.replace)
    if (fuzzyResult) {
      content = fuzzyResult
      applied++
      continue
    }

    failures.push({ block, reason: 'no exact or whitespace-normalized match for SEARCH block' })
  }

  return {
    ok: failures.length === 0,
    newContent: content,
    applied,
    failures,
  }
}

/**
 * Whitespace-normalized matcher. Algorithm:
 *   - Normalize both content + search by:
 *     a) trimming trailing whitespace on each line
 *     b) collapsing runs of internal whitespace (spaces/tabs) within a line
 *   - Find the normalized search in the normalized content
 *   - Map the match back to original content offsets via cumulative line
 *     length tracking
 *   - Splice the original (unnormalized) range with the replacement
 */
function applyFuzzy(content: string, search: string, replace: string): string | null {
  const contentLines = content.split('\n')
  const searchLines = search.split('\n')
  const normContent = contentLines.map(normalizeLine)
  const normSearch = searchLines.map(normalizeLine)

  // Sliding window: find a contiguous block of normContent that matches
  // normSearch exactly.
  for (let start = 0; start + normSearch.length <= normContent.length; start++) {
    let ok = true
    for (let j = 0; j < normSearch.length; j++) {
      if (normContent[start + j] !== normSearch[j]) { ok = false; break }
    }
    if (!ok) continue

    // Match found at [start, start + normSearch.length). Compute the
    // original (unnormalized) range using join-with-\n offsets.
    const before = contentLines.slice(0, start).join('\n')
    const matched = contentLines.slice(start, start + normSearch.length).join('\n')
    const after = contentLines.slice(start + normSearch.length).join('\n')

    // Preserve the \n between before/matched/after exactly as in the original
    const leadingNl = start > 0 ? '\n' : ''
    const trailingNl = start + normSearch.length < contentLines.length ? '\n' : ''
    return before + leadingNl + replace + trailingNl + after
      // Note: `matched` is computed for clarity only; not used in the join
      // since we slice it out via the leading/trailing newline accounting.
      // Keeping the var visible in code review makes the slice intent obvious.
      + (matched.length === 0 && trailingNl === '' ? '' : '')
  }

  return null
}

function normalizeLine(line: string): string {
  return line.replace(/[\t ]+/g, ' ').replace(/[\t ]+$/g, '').trim()
}

/* ─── Test-only exports ───────────────────────────────────────────────────── */

export const __testing = {
  normalizeLine,
  applyFuzzy,
  SEARCH_MARKER,
  DIVIDER_MARKER,
  REPLACE_MARKER,
}
