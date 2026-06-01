/**
 * GET /api/agent-log?scanId=…&kind=automerge.*&limit=…
 *
 * Read recent AgentLog entries for the auto-merge transparency surface
 * in the Settings UI. The §5c discipline requires that every reason
 * is LOGGED — this endpoint makes those logs visible.
 *
 * Read-only. Tight pagination cap so a curious browser can't drain
 * the entire log table. Per CLAUDE.md §5 rule 4 every filter is
 * Zod-validated; per rule 3 the route is rate-limited.
 *
 * Filters:
 *   - scanId    optional, exact match
 *   - issueId   optional, exact match
 *   - kind      optional, prefix match (e.g., "automerge." catches
 *               automerge.verdict + automerge.dwell + automerge.merge)
 *   - limit     1..100, default 50
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { applyRateLimit } from '@/lib/rate-limit'
import { db } from '@/lib/db'

const Query = z.object({
  scanId: z.string().min(1).max(64).optional(),
  issueId: z.string().min(1).max(64).optional(),
  // Kind is a string prefix the runner-glue uses (e.g., "automerge.verdict").
  // We cap the length and accept dots + letters + digits + dashes + underscores.
  kind: z.string().min(1).max(64).regex(/^[a-zA-Z0-9._-]+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export async function GET(req: NextRequest) {
  const limited = applyRateLimit(req, 'api')
  if (limited) return limited

  const url = new URL(req.url)
  let parsed: z.infer<typeof Query>
  try {
    parsed = Query.parse({
      scanId: url.searchParams.get('scanId') ?? undefined,
      issueId: url.searchParams.get('issueId') ?? undefined,
      kind: url.searchParams.get('kind') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    })
  } catch (err) {
    const message =
      err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : 'invalid query'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // Prisma `startsWith` accepts a fixed prefix — perfect for "automerge."
  // We deliberately do NOT support free-text search on `payload` (the
  // payloads can carry diagnostic strings; exposing them to client
  // filters would risk JSON-encoded contents bleeding into the SQL
  // surface even though Prisma parameterizes it).
  const limit = parsed.limit ?? 50
  const where: Record<string, unknown> = {}
  if (parsed.scanId) where.scanId = parsed.scanId
  if (parsed.issueId) where.issueId = parsed.issueId
  if (parsed.kind) where.kind = { startsWith: parsed.kind }

  const rows = await db.agentLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({
    rows: rows.map((r) => ({
      id: r.id,
      scanId: r.scanId,
      issueId: r.issueId,
      kind: r.kind,
      // Payload is JSON-stringified at write; we parse here so the UI
      // doesn't have to (also lets a malformed payload surface as an
      // honest `__parseError` field rather than crash the renderer).
      payload: safeParse(r.payload),
      createdAt: r.createdAt.toISOString(),
    })),
  })
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (err) {
    return { __parseError: String(err), raw }
  }
}
