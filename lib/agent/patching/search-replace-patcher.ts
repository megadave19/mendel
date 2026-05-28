/**
 * v1.5 Workstream #7 (runner integration) — search-replace patcher.
 *
 * Wraps the pure `applyBlocksToFile` + `parseSearchReplaceBlocks` machinery
 * in an LLM call that asks for SEARCH/REPLACE blocks instead of full-file
 * regeneration. Used by `patchFileSmart` (the dispatcher) for files large
 * enough that re-emitting the whole file would waste tokens.
 *
 * Failure handling (per TRD §7.2 + CLAUDE.md §5b):
 *   1. Parse + apply all blocks
 *   2. If any block fails to match, retry ONCE with the failure list fed back
 *      to the LLM as corrective context
 *   3. If still failing, return null so the dispatcher falls back to full-file
 *      regeneration (NEVER silently apply partial patches)
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod'
import { llmComplete } from '@/lib/llm'
import type { BreakingChange } from '@/lib/agent/signals/changelog'
import type { Diagnosis } from '@/lib/agent/phases/diagnose'
import type { StaleDep } from '@/lib/agent/phases/detect'
import type { FilePatch } from './full-file'
import { parseSearchReplaceBlocks, applyBlocksToFile, type BlockFailure } from './search-replace'

const execAsync = promisify(exec)

const SearchReplaceResponseSchema = z.object({
  /** The raw SEARCH/REPLACE block text per the format documented in the prompt. */
  blocks: z.string().min(1),
  /** Concise human-readable summary of what changed (≤ 300 chars). */
  explanation: z.string().max(300),
})

async function runPrettier(filePath: string): Promise<void> {
  try {
    await execAsync(`npx prettier --write "${filePath}"`, { timeout: 30_000 })
  } catch {
    /* non-fatal — prettier may not be configured in target repo */
  }
}

function buildInitialPrompt(
  relativeFilePath: string,
  originalContent: string,
  dep: StaleDep,
  breakingText: string,
  patchStrategy: string,
): string {
  return `
You are fixing a TypeScript source file that uses the npm package "${dep.name}".
The package is being upgraded from ${dep.currentVersion} to ${dep.latestVersion}.

Breaking changes requiring code changes:
${breakingText || 'Major version bump — update API usage per migration guide.'}

Patch strategy: ${patchStrategy}

The file is too large to regenerate in full. Return MINIMAL SEARCH/REPLACE
blocks in the following format. The SEARCH portion must match the file EXACTLY
(byte-for-byte preferred; whitespace-normalized fallback is also OK).

Format:
${relativeFilePath}
<<<<<<< SEARCH
exact existing code to replace
=======
new code that replaces it
>>>>>>> REPLACE

Rules:
- Use as FEW blocks as necessary — one per logical change
- Each SEARCH block must be a UNIQUE excerpt from the file (no ambiguous matches)
- Include 1–3 lines of surrounding context in SEARCH so the match is unambiguous
- Each SEARCH must NOT be empty (empty SEARCH is rejected by the applier)
- Only change what the upgrade strictly requires
- Maintain existing code style + indentation in REPLACE
- Do not add explanatory comments inside the code

Current file (${relativeFilePath}, full contents below):
\`\`\`typescript
${originalContent}
\`\`\`

Return JSON only:
{
  "blocks": "${relativeFilePath}\\n<<<<<<< SEARCH\\n...\\n=======\\n...\\n>>>>>>> REPLACE",
  "explanation": "what you changed and why (≤ 300 chars)"
}
`
}

function buildRetryPrompt(
  relativeFilePath: string,
  originalContent: string,
  dep: StaleDep,
  breakingText: string,
  patchStrategy: string,
  previousBlocks: string,
  failures: BlockFailure[],
): string {
  const failuresText = failures
    .map((f, i) => `Failure ${i + 1}: ${f.reason}\nFailed SEARCH:\n${f.block.search}`)
    .join('\n\n')
  return `
${buildInitialPrompt(relativeFilePath, originalContent, dep, breakingText, patchStrategy)}

────────────────────────────────────────────────────────────
A PREVIOUS ATTEMPT FAILED. Your previous SEARCH/REPLACE blocks did not match
the file. The failed blocks were:

${previousBlocks}

The specific failures were:
${failuresText}

Re-emit corrected blocks. The most common cause is missing or extra context
lines — ensure each SEARCH is an EXACT excerpt from the file shown above,
including indentation. Use whitespace-normalized matching as a fallback if
the file uses tabs vs spaces in unexpected ways.
`
}

export interface PatchViaBlocksResult {
  patch: FilePatch | null
  /** True if all blocks applied. False = caller should fall back to full-file. */
  ok: boolean
  /** Block failures across all attempts (for runner logging). */
  failures: BlockFailure[]
  /** How many LLM attempts were made (1 or 2). */
  attempts: number
}

/**
 * Patch a file using search-replace blocks. Single retry on block-apply
 * failure. Returns `ok: false` (with the failure list) when the caller
 * should fall back to full-file regeneration.
 */
export async function patchFileViaBlocks(
  repoPath: string,
  relativeFilePath: string,
  dep: StaleDep,
  breakingChanges: BreakingChange[],
  diagnosis: Diagnosis,
  emit: (msg: string) => void,
): Promise<PatchViaBlocksResult> {
  const fullPath = path.join(repoPath, relativeFilePath)
  if (!existsSync(fullPath)) {
    emit(`  skip ${relativeFilePath} — not found`)
    return { patch: null, ok: false, failures: [], attempts: 0 }
  }

  const originalContent = readFileSync(fullPath, 'utf-8')
  const breakingText = breakingChanges
    .map((bc) => `- ${bc.symbol} (${bc.changeType}): ${bc.description}`)
    .join('\n')

  emit(`Patching ${relativeFilePath} via search-replace blocks…`)

  let attempt = 0
  let lastFailures: BlockFailure[] = []
  let lastBlocksText = ''

  while (attempt < 2) {
    attempt++
    const prompt = attempt === 1
      ? buildInitialPrompt(relativeFilePath, originalContent, dep, breakingText, diagnosis.patchStrategy)
      : buildRetryPrompt(relativeFilePath, originalContent, dep, breakingText, diagnosis.patchStrategy, lastBlocksText, lastFailures)

    let response: z.infer<typeof SearchReplaceResponseSchema>
    try {
      response = await llmComplete(prompt, SearchReplaceResponseSchema, { maxTokens: 8192 })
    } catch (err) {
      emit(`  ✗ LLM call failed on attempt ${attempt}: ${String(err).slice(0, 120)}`)
      return { patch: null, ok: false, failures: lastFailures, attempts: attempt }
    }

    lastBlocksText = response.blocks
    const blocks = parseSearchReplaceBlocks(response.blocks)
    if (blocks.length === 0) {
      emit(`  ⚠ attempt ${attempt}: LLM returned no parsable SEARCH/REPLACE blocks — falling back`)
      lastFailures = []
      // No blocks parsed — fallback rather than retry (retry won't help if
      // the LLM doesn't understand the format).
      return { patch: null, ok: false, failures: lastFailures, attempts: attempt }
    }

    const result = applyBlocksToFile(originalContent, blocks)
    if (result.ok) {
      writeFileSync(fullPath, result.newContent, 'utf-8')
      await runPrettier(fullPath)
      const finalContent = readFileSync(fullPath, 'utf-8')
      emit(`  ✓ ${result.applied} block(s) applied on attempt ${attempt}`)
      return {
        patch: {
          filePath: relativeFilePath,
          originalContent,
          patchedContent: finalContent,
          explanation: response.explanation,
        },
        ok: true,
        failures: [],
        attempts: attempt,
      }
    }

    lastFailures = result.failures
    emit(`  ⚠ attempt ${attempt}: ${result.failures.length} block(s) failed to match — retrying with corrective context`)
  }

  // Both attempts exhausted — caller (dispatcher) falls back to full-file.
  emit(`  ✗ search-replace failed after ${attempt} attempts — caller will fall back to full-file regen`)
  return { patch: null, ok: false, failures: lastFailures, attempts: attempt }
}
