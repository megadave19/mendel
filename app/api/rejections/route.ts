/**
 * v1.5 Workstream #10 (PRD F16) — Rejection record API.
 *
 * POST records a rejection (user clicked "Mark as rejected" on a PR-opened
 *      IssueCard).
 * GET  lists recent rejection patterns for a dep (used by the UI to show
 *      "this dep has N prior rejections" so the user doesn't have to look it
 *      up themselves).
 *
 * Rate-limited like every other API per CLAUDE.md §5 Rule 3.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { recordRejection, RecordRejectionSchema } from '@/lib/agent/learning/rejection-recorder'
import { recallRejectionPatterns } from '@/lib/agent/learning/rejection-recall'
import { applyRateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  const limited = applyRateLimit(req, 'api')
  if (limited) return limited

  try {
    const body = RecordRejectionSchema.parse(await req.json())
    const result = await recordRejection(body)
    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 201 : 200 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  const limited = applyRateLimit(req, 'api')
  if (limited) return limited

  const url = new URL(req.url)
  const dep = url.searchParams.get('dep') ?? ''
  const changeType = url.searchParams.get('changeType') ?? undefined
  const limit = Math.max(1, Math.min(20, parseInt(url.searchParams.get('limit') ?? '5', 10) || 5))

  if (!dep) {
    return NextResponse.json({ error: 'missing required `dep` query parameter' }, { status: 400 })
  }

  try {
    const patterns = await recallRejectionPatterns(dep, { changeType, limit })
    return NextResponse.json({ patterns })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
