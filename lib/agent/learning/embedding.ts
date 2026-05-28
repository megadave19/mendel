/**
 * v1.5 Workstream #10 Push 2 (b) / PRD F16 — embedding-based rejection similarity.
 *
 * Push 1's recall matches on exact (depName, changeType). That misses
 * cross-dependency lessons: "ESM-only migrations keep breaking our Jest
 * config" is useful when diagnosing a *different* package's ESM bump. This
 * module adds semantic similarity so those cross-dep rejections surface too.
 *
 * Shape (mirrors the rest of the learning code — pure core + injectable IO):
 *   - cosineSimilarity / serialize / deserialize / embeddingText → PURE, tested
 *   - Embedder                                                   → injected seam
 *   - geminiEmbedder                                             → production default
 *
 * Embeddings are stored once at record time in RejectionPattern.embedding
 * (Bytes). Recall embeds the query and ranks by cosine similarity. Everything
 * degrades gracefully: no API key / failed embed → null embedding → recall
 * falls back to the exact-match path. We never block a record or a diagnosis
 * on the embedding layer.
 *
 * §5b honesty: similarity is a real cosine over real model vectors — we label
 * recalled-by-similarity patterns as such so the LLM (and any reader) knows a
 * cross-dep match is a weaker signal than an exact same-dep rejection.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

/** Default Gemini embedding model. Overridable via env for parity with llm/. */
const GEMINI_EMBED_MODEL = 'text-embedding-004'

/** A function that turns text into a dense vector. Injected so tests stay
 *  hermetic (no network) and so we could swap providers later. */
export type Embedder = (text: string) => Promise<Float32Array>

/* ─── PURE: canonical text + vector math ──────────────────────────────────── */

/**
 * Canonical text we embed for a rejection. Record + recall MUST build this the
 * same way so their vectors live in the same space. Order: dep, change type,
 * then the verbatim reason (the highest-signal part).
 */
export function embeddingText(input: {
  depName?: string | null
  changeType?: string | null
  rejectionReason: string
}): string {
  const parts = [
    input.depName ? `dependency: ${input.depName}` : '',
    input.changeType ? `change: ${input.changeType}` : '',
    `reason: ${input.rejectionReason}`,
  ].filter(Boolean)
  return parts.join('\n')
}

/** Cosine similarity in [-1, 1]. Returns 0 for length mismatch or zero vectors. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Float32Array → Buffer for the Prisma Bytes column (copies, no aliasing). */
export function serializeEmbedding(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength))
}

/**
 * Buffer/Uint8Array → Float32Array. Copies into a fresh 4-byte-aligned buffer
 * so we never depend on the input's byteOffset (Prisma returns a Buffer view).
 * Returns an empty array if the byte length isn't a multiple of 4 (corrupt).
 */
export function deserializeEmbedding(buf: Buffer | Uint8Array): Float32Array {
  if (buf.byteLength % 4 !== 0) return new Float32Array(0)
  const copy = new Uint8Array(buf.byteLength)
  copy.set(buf)
  return new Float32Array(copy.buffer)
}

/* ─── Production embedder (Gemini) ────────────────────────────────────────── */

/**
 * Gemini-backed embedder. Throws when GEMINI_API_KEY is absent or the call
 * fails — callers treat embedding as best-effort and catch.
 */
export const geminiEmbedder: Embedder = async (text: string) => {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_EMBED_MODEL ?? GEMINI_EMBED_MODEL })
  const res = await model.embedContent(text)
  const values = res.embedding?.values
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Gemini embedding returned no values')
  }
  return Float32Array.from(values)
}
