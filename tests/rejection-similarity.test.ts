/**
 * Tests for v1.5 Workstream #10 Push 2 (b) — embedding-based rejection similarity.
 *
 * Pure (no DB / network):
 *   - cosineSimilarity, serialize/deserialize round-trip, embeddingText
 *
 * Integration (real Prisma DB + an INJECTED deterministic embedder — no
 * network): recordRejection stores an embedding; recallSimilarRejections ranks
 * cross-dependency matches by cosine, honors minSimilarity + excludeIds;
 * formatSimilarPatternsForPrompt labels them as a weaker signal.
 *
 * Mirrors tests/rejection-learning.test.ts: real DB + afterEach cleanup.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import {
  cosineSimilarity,
  serializeEmbedding,
  deserializeEmbedding,
  embeddingText,
  type Embedder,
} from '@/lib/agent/learning/embedding'
import { recordRejection } from '@/lib/agent/learning/rejection-recorder'
import {
  recallSimilarRejections,
  formatSimilarPatternsForPrompt,
  type SimilarPattern,
} from '@/lib/agent/learning/rejection-recall'

const PR_BASE = 'https://github.com/test/rejection-similarity-suite/pull/'

beforeAll(() => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-key-32-chars-exactly-padded!'
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
})

afterEach(async () => {
  const { db } = await import('@/lib/db')
  await db.rejectionPattern.deleteMany({ where: { prUrl: { startsWith: PR_BASE } } })
})

/**
 * Deterministic fake embedder: returns a fixed vector for the first matching
 * keyword found in the text, else a default. Lets us control cosine exactly.
 */
function fakeEmbedder(map: Record<string, number[]>, fallback = [0, 0, 1]): Embedder {
  return async (text: string) => {
    for (const key of Object.keys(map)) {
      if (text.includes(key)) return Float32Array.from(map[key])
    }
    return Float32Array.from(fallback)
  }
}

/* ─── PURE: vector math ───────────────────────────────────────────────────── */

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity(Float32Array.from([1, 2, 3]), Float32Array.from([1, 2, 3]))).toBeCloseTo(1, 5)
  })
  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0, 5)
  })
  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity(Float32Array.from([1, 1]), Float32Array.from([-1, -1]))).toBeCloseTo(-1, 5)
  })
  it('is 0 for a zero vector or length mismatch', () => {
    expect(cosineSimilarity(Float32Array.from([0, 0]), Float32Array.from([1, 1]))).toBe(0)
    expect(cosineSimilarity(Float32Array.from([1]), Float32Array.from([1, 2]))).toBe(0)
    expect(cosineSimilarity(Float32Array.from([]), Float32Array.from([]))).toBe(0)
  })
})

describe('serialize/deserialize embedding', () => {
  it('round-trips a Float32Array through Buffer', () => {
    const vec = Float32Array.from([0.5, -1.25, 3.0, 42.125])
    const buf = serializeEmbedding(vec)
    const back = deserializeEmbedding(buf)
    expect(Array.from(back)).toEqual(Array.from(vec))
  })
  it('returns empty for a corrupt (non-multiple-of-4) buffer', () => {
    expect(deserializeEmbedding(Buffer.from([1, 2, 3]))).toEqual(new Float32Array(0))
  })
})

describe('embeddingText', () => {
  it('includes dep, change, and verbatim reason', () => {
    const t = embeddingText({ depName: 'axios', changeType: 'removed', rejectionReason: 'breaks auth' })
    expect(t).toContain('dependency: axios')
    expect(t).toContain('change: removed')
    expect(t).toContain('reason: breaks auth')
  })
  it('omits absent dep/change cleanly', () => {
    const t = embeddingText({ rejectionReason: 'just because' })
    expect(t).toBe('reason: just because')
  })
})

/* ─── record + recall integration ─────────────────────────────────────────── */

describe('recordRejection embedding + recallSimilarRejections (fake embedder + real DB)', () => {
  it('stores an embedding when an embedder is supplied (embedded=true)', async () => {
    const { db } = await import('@/lib/db')
    const embedder = fakeEmbedder({ ESM: [1, 0, 0] })
    const res = await recordRejection(
      { depName: 'axios', rejectionReason: 'ESM-only migration broke our jest setup', prUrl: PR_BASE + 'e1' },
      { embedder },
    )
    expect(res.embedded).toBe(true)
    const row = await db.rejectionPattern.findFirst({ where: { prUrl: PR_BASE + 'e1' }, select: { embedding: true } })
    expect(row?.embedding).toBeTruthy()
  })

  it('skips embedding when embedder is null (embedded=false, column null)', async () => {
    const { db } = await import('@/lib/db')
    const res = await recordRejection(
      { depName: 'lodash', rejectionReason: 'removed default export', prUrl: PR_BASE + 'e2' },
      { embedder: null },
    )
    expect(res.embedded).toBe(false)
    const row = await db.rejectionPattern.findFirst({ where: { prUrl: PR_BASE + 'e2' }, select: { embedding: true } })
    expect(row?.embedding).toBeNull()
  })

  it('ranks cross-dependency matches by cosine, filtered by minSimilarity', async () => {
    // Two rejections on DIFFERENT deps with controlled vectors.
    const embedder = fakeEmbedder({ ESM: [1, 0, 0], 'removed default': [0, 1, 0] })
    await recordRejection({ depName: 'axios', rejectionReason: 'ESM migration pain', prUrl: PR_BASE + 's1' }, { embedder })
    await recordRejection({ depName: 'lodash', rejectionReason: 'removed default export', prUrl: PR_BASE + 's2' }, { embedder })

    // Query closest to the ESM vector → should return the axios one, not lodash,
    // even though we'd be diagnosing some unrelated package.
    const queryEmbedder = fakeEmbedder({ ESM: [1, 0, 0] })
    const hits = await recallSimilarRejections('ESM something', { embedder: queryEmbedder, minSimilarity: 0.75 })
    expect(hits.length).toBe(1)
    expect(hits[0].depName).toBe('axios')
    expect(hits[0].similarity).toBeCloseTo(1, 5)
  })

  it('honors excludeIds (drops already-returned exact matches)', async () => {
    const embedder = fakeEmbedder({ ESM: [1, 0, 0] })
    const a = await recordRejection({ depName: 'axios', rejectionReason: 'ESM x', prUrl: PR_BASE + 'x1' }, { embedder })
    const hits = await recallSimilarRejections('ESM y', { embedder, excludeIds: [a.id], minSimilarity: 0.5 })
    expect(hits.find((h) => h.id === a.id)).toBeUndefined()
  })

  it('returns [] when the embedder fails (graceful fallback to exact match)', async () => {
    const throwing: Embedder = async () => { throw new Error('no key') }
    const hits = await recallSimilarRejections('anything', { embedder: throwing })
    expect(hits).toEqual([])
  })

  it('returns [] for an empty query', async () => {
    const embedder = fakeEmbedder({ ESM: [1, 0, 0] })
    expect(await recallSimilarRejections('', { embedder })).toEqual([])
  })
})

/* ─── formatter ───────────────────────────────────────────────────────────── */

describe('formatSimilarPatternsForPrompt', () => {
  it('labels cross-dep matches as a weaker signal + shows similarity %', () => {
    const patterns: SimilarPattern[] = [{
      id: '1', depName: 'axios', changeType: 'removed',
      rejectionReason: 'ESM broke jest', prUrl: PR_BASE + 'f1',
      createdAt: new Date('2026-05-28T00:00:00Z'), similarity: 0.91,
    }]
    const out = formatSimilarPatternsForPrompt(patterns)
    expect(out).toContain('OTHER dependencies')
    expect(out).toContain('weaker signal')
    expect(out).toContain('91% similar')
    expect(out).toContain('ESM broke jest')
  })
  it('returns empty string for no patterns', () => {
    expect(formatSimilarPatternsForPrompt([])).toBe('')
  })
})
