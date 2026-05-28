/**
 * v1.5 Workstream #10 (PRD F16) — Rejection-Learning Loop: recorder.
 *
 * When a Mendel PR is closed without merging, the rejection reason is captured
 * into `RejectionPattern` so future diagnoses on the same dep / changeType
 * get the previous failure as negative-example context for the LLM.
 *
 * This module is the WRITE side. The recall module reads.
 *
 * Sources of rejection input:
 *   1. Manual: user clicks "Mark as rejected" on a PR-opened IssueCard, types
 *      a brief reason, POST /api/rejections records via this module.
 *   2. Future (W#10 Push 2): poll GitHub for closed-without-merge PRs Mendel
 *      opened, scrape last comment as the reason.
 *
 * §5b honesty:
 *   - Reason is stored verbatim — never paraphrased by us before retrieval.
 *     The LLM sees what the user (or PR closer) actually said.
 *   - `embedding` field is reserved for future similarity lookup. For v1.5
 *     first cut we use exact (depName, changeType) match; embedding-based
 *     similarity is W#10 Push 2.
 */

import { z } from 'zod'
import { db } from '@/lib/db'
import { type Embedder, geminiEmbedder, embeddingText, serializeEmbedding } from './embedding'

export const RecordRejectionSchema = z.object({
  /** npm package name the rejected PR was for. */
  depName: z.string().min(1).max(214),
  /**
   * The type of change Mendel attempted (matches BreakingChange.changeType
   * shape). Optional because we sometimes record rejections from PRs that
   * had no concrete breaking change identified (e.g., bare version bumps).
   */
  changeType: z.enum(['removed', 'renamed', 'signature-changed', 'behavior-changed', 'version-bump']).optional(),
  /** User-or-reviewer-supplied reason. Stored verbatim. */
  rejectionReason: z.string().min(3).max(2000),
  /** GitHub PR URL — required so we can dedupe + so the LLM can cite. */
  prUrl: z.string().url().regex(/github\.com/, 'must be a github.com URL'),
})
export type RecordRejectionInput = z.infer<typeof RecordRejectionSchema>

export interface RecordRejectionResult {
  id: string
  /** True if this is a new record; false if the PR was already recorded. */
  created: boolean
  /** v1.5 W#10 Push 2(b): true if a semantic embedding was stored. */
  embedded: boolean
}

export interface RecordRejectionOptions {
  /**
   * v1.5 W#10 Push 2(b) — injected embedder. Defaults to Gemini. Pass `null`
   * to skip embedding entirely (e.g., bulk imports where you don't want the
   * API cost); pass a fake in tests for hermetic runs.
   */
  embedder?: Embedder | null
}

/**
 * v1.5 W#10 Push 2(b) — compute the embedding for a rejection, best-effort.
 * Never throws: a failed/absent embedder just yields null so the record still
 * persists and recall falls back to exact match.
 */
async function tryEmbed(
  input: RecordRejectionInput,
  embedder: Embedder | null | undefined,
): Promise<Buffer | null> {
  if (embedder === null) return null
  const fn = embedder ?? geminiEmbedder
  try {
    const vec = await fn(embeddingText(input))
    return vec.length > 0 ? serializeEmbedding(vec) : null
  } catch {
    return null
  }
}

/**
 * Persist a rejection pattern. Dedupes on prUrl — re-recording the same PR
 * updates the reason (and re-embeds) in place instead of creating duplicates.
 */
export async function recordRejection(
  input: RecordRejectionInput,
  options: RecordRejectionOptions = {},
): Promise<RecordRejectionResult> {
  const validated = RecordRejectionSchema.parse(input)

  // v1.5 W#10 Push 2(b): embed the canonical text (best-effort, never throws).
  const embedding = await tryEmbed(validated, options.embedder)

  // Dedupe by prUrl. If a previous record exists, update + return created=false.
  const existing = await db.rejectionPattern.findFirst({
    where: { prUrl: validated.prUrl },
    select: { id: true },
  })

  if (existing) {
    await db.rejectionPattern.update({
      where: { id: existing.id },
      data: {
        depName: validated.depName,
        changeType: validated.changeType ?? null,
        rejectionReason: validated.rejectionReason,
        // Re-embed on update so a corrected reason gets a fresh vector. Keep
        // the existing embedding when this run couldn't produce one.
        ...(embedding ? { embedding } : {}),
      },
    })
    return { id: existing.id, created: false, embedded: embedding !== null }
  }

  const created = await db.rejectionPattern.create({
    data: {
      depName: validated.depName,
      changeType: validated.changeType ?? null,
      rejectionReason: validated.rejectionReason,
      prUrl: validated.prUrl,
      embedding: embedding ?? undefined,
    },
  })
  return { id: created.id, created: true, embedded: embedding !== null }
}
