/**
 * v1.5 Workstream #10 (PRD F16) — Rejection-Learning Loop: recall.
 *
 * Returns the K most-recent rejection patterns matching a (depName, changeType)
 * query so the diagnose phase can feed them to the LLM as negative-example
 * context: "these prior attempts were rejected; learn from them."
 *
 * Match strategy (v1.5 first cut):
 *   1. Exact (depName, changeType) match — strongest signal
 *   2. depName-only match (any changeType) — fallback when the change types
 *      differ but the package is the same (still informative)
 *
 * Embedding-based semantic similarity is W#10 Push 2 — for now exact match
 * is fine because the search space per scan is small (1 dep, 1 changeType).
 *
 * §5b honesty:
 *   - We surface the EXACT prior reason text. No paraphrase.
 *   - Caller decides how many to feed the LLM (cap = 5 by default).
 */

import { db } from '@/lib/db'
import {
  type Embedder,
  geminiEmbedder,
  cosineSimilarity,
  deserializeEmbedding,
} from './embedding'

export interface RecalledPattern {
  id: string
  /** Nullable in DB (legacy data + future-poll path may insert without a
   *  depName). Recall queries always filter by a known depName, but TS
   *  still sees the DB column as nullable — kept honest. */
  depName: string | null
  changeType: string | null
  rejectionReason: string
  prUrl: string
  createdAt: Date
}

export interface RecallOptions {
  /** Max patterns to return (after match prioritization). Default 5. */
  limit?: number
  /** When supplied, prefer exact changeType match; fall back to depName-only. */
  changeType?: string
}

const DEFAULT_LIMIT = 5

/**
 * Recall recent rejection patterns for a dep. Returns most-recent-first.
 *
 * When `changeType` is supplied, exact (depName, changeType) matches come
 * first, then depName-only matches fill up to `limit`. This lets the LLM
 * see the most relevant rejections first while still benefiting from
 * dep-level history.
 */
export async function recallRejectionPatterns(
  depName: string,
  options: RecallOptions = {},
): Promise<RecalledPattern[]> {
  const limit = options.limit ?? DEFAULT_LIMIT
  if (limit <= 0) return []
  if (!depName || depName.trim() === '') return []

  // Exact-match first (when changeType supplied).
  let exactMatches: RecalledPattern[] = []
  if (options.changeType) {
    exactMatches = await db.rejectionPattern.findMany({
      where: { depName, changeType: options.changeType },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, depName: true, changeType: true,
        rejectionReason: true, prUrl: true, createdAt: true,
      },
    })
  }

  if (exactMatches.length >= limit) return exactMatches

  // Backfill with depName-only matches that aren't already in the exact set.
  const exactIds = new Set(exactMatches.map((p) => p.id))
  const fallbackNeeded = limit - exactMatches.length
  const fallback = await db.rejectionPattern.findMany({
    where: {
      depName,
      // exclude already-included exact matches
      id: { notIn: [...exactIds] },
    },
    orderBy: { createdAt: 'desc' },
    take: fallbackNeeded,
    select: {
      id: true, depName: true, changeType: true,
      rejectionReason: true, prUrl: true, createdAt: true,
    },
  })

  return [...exactMatches, ...fallback]
}

/* ─── v1.5 W#10 Push 2(b) — embedding-based cross-dep similarity ──────────── */

export interface SimilarPattern extends RecalledPattern {
  /** Cosine similarity to the query in [0, 1] (negatives clamped out). */
  similarity: number
}

export interface SimilarRecallOptions {
  limit?: number
  /** Minimum cosine similarity to include. Default 0.75. */
  minSimilarity?: number
  /** Injected embedder (tests). Defaults to Gemini. */
  embedder?: Embedder
  /** Exclude these pattern ids (e.g., already returned by exact match). */
  excludeIds?: string[]
}

const DEFAULT_MIN_SIMILARITY = 0.75
const SIMILARITY_CANDIDATE_CAP = 500

/**
 * Recall rejection patterns SEMANTICALLY similar to a free-text query, across
 * ALL dependencies (not just the same dep). Embeds the query, scores every
 * stored embedding by cosine, and returns the top matches ≥ minSimilarity.
 *
 * Best-effort: if the embedder fails (no API key, network), returns [] so the
 * caller silently keeps the exact-match results. Never throws.
 */
export async function recallSimilarRejections(
  query: string,
  options: SimilarRecallOptions = {},
): Promise<SimilarPattern[]> {
  const limit = options.limit ?? DEFAULT_LIMIT
  if (limit <= 0 || !query || query.trim() === '') return []

  let queryVec
  try {
    const embed = options.embedder ?? geminiEmbedder
    queryVec = await embed(query)
  } catch {
    return [] // embedding unavailable → caller falls back to exact match
  }
  if (queryVec.length === 0) return []

  const exclude = new Set(options.excludeIds ?? [])
  const candidates = await db.rejectionPattern.findMany({
    where: { embedding: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: SIMILARITY_CANDIDATE_CAP,
    select: {
      id: true, depName: true, changeType: true,
      rejectionReason: true, prUrl: true, createdAt: true, embedding: true,
    },
  })

  const min = options.minSimilarity ?? DEFAULT_MIN_SIMILARITY
  const scored: SimilarPattern[] = []
  for (const c of candidates) {
    if (exclude.has(c.id) || !c.embedding) continue
    const sim = cosineSimilarity(queryVec, deserializeEmbedding(c.embedding))
    if (sim >= min) {
      scored.push({
        id: c.id, depName: c.depName, changeType: c.changeType,
        rejectionReason: c.rejectionReason, prUrl: c.prUrl, createdAt: c.createdAt,
        similarity: sim,
      })
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity)
  return scored.slice(0, limit)
}

/**
 * Format recalled patterns as a single prompt-friendly string. Used by the
 * diagnose phase to thread context into the LLM call.
 *
 * Returns empty string when no patterns — the diagnose prompt can then skip
 * the "previously rejected" section entirely.
 */
export function formatPatternsForPrompt(patterns: RecalledPattern[]): string {
  if (patterns.length === 0) return ''
  const lines = patterns.map((p, i) => {
    const when = p.createdAt.toISOString().slice(0, 10)
    const type = p.changeType ? ` (${p.changeType})` : ''
    const name = p.depName ?? '(unknown dep)'
    return `${i + 1}. [${when}] ${name}${type}: ${p.rejectionReason} (PR: ${p.prUrl})`
  })
  return [
    'Previously rejected fixes for this dependency — learn from these:',
    ...lines,
    'Avoid repeating these mistakes in your diagnosis or patch strategy.',
  ].join('\n')
}

/**
 * Format SIMILARITY-sourced patterns (other dependencies) as a clearly-labeled
 * weaker-signal section. §5b: a cross-dep semantic match is informative but
 * not as strong as a same-dep rejection — we say so explicitly so the LLM
 * weights it accordingly. Returns '' when empty.
 */
export function formatSimilarPatternsForPrompt(patterns: SimilarPattern[]): string {
  if (patterns.length === 0) return ''
  const lines = patterns.map((p, i) => {
    const when = p.createdAt.toISOString().slice(0, 10)
    const type = p.changeType ? ` (${p.changeType})` : ''
    const name = p.depName ?? '(unknown dep)'
    const pct = Math.round(p.similarity * 100)
    return `${i + 1}. [${when}] ${name}${type} — ${pct}% similar: ${p.rejectionReason} (PR: ${p.prUrl})`
  })
  return [
    'Semantically similar rejections from OTHER dependencies (weaker signal — different package, but the failure mode may rhyme):',
    ...lines,
    'Consider whether the same failure mode could apply here, but do not assume it does.',
  ].join('\n')
}
