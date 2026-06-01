/**
 * GET /api/inspect/[id] — v2.1 / F22 permalink resolver.
 *
 * Returns the stored ApiReport for a persisted inspection. Read-only.
 * Rate-limited (60/min general). 404 on unknown ids → triggers the
 * project's not-found page on the client (parallel to /scan/[id]).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { applyRateLimit } from '@/lib/rate-limit'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = applyRateLimit(req, 'api')
  if (limited) return limited

  const { id } = await params
  // Defensive — the route already constrains the segment, but `id` could
  // be anything; reject obviously malformed values cheaply.
  if (!id || id.length > 64 || !/^[a-z0-9_-]+$/i.test(id)) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
  }

  const row = await db.inspection.findUnique({
    where: { id },
    select: {
      id: true,
      packageName: true,
      fromVersion: true,
      toVersion: true,
      report: true,
      createdAt: true,
    },
  })
  if (!row) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
  }

  // Parse the persisted ApiReport blob. If it's malformed (e.g. an old
  // row from a previous schema), surface that honestly rather than
  // silently shipping a partial response.
  let report: unknown
  try {
    report = JSON.parse(row.report)
  } catch {
    return NextResponse.json(
      { error: 'Stored report is malformed; re-run the inspection.' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    id: row.id,
    packageName: row.packageName,
    fromVersion: row.fromVersion,
    toVersion: row.toVersion,
    createdAt: row.createdAt,
    report,
  })
}
