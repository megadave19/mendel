/**
 * v1.5 Workstream #10 Push 2 (a) — PR-state poll endpoint.
 *
 * POST triggers a poll of every unresolved Mendel-opened PR. Merged PRs flip
 * to 'pr-merged'; PRs closed without merge are auto-recorded as rejection
 * patterns (feeding the learning loop) and flip to 'pr-rejected'. Safe to call
 * repeatedly — resolved issues are excluded from future polls.
 *
 * This is the automation entry point: a dashboard button calls it now; a cron
 * can call it later. Rate-limited per CLAUDE.md §5 Rule 3.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { pollPrStates } from '@/lib/agent/learning/pr-state-poller'
import { applyRateLimit } from '@/lib/rate-limit'

const PollSchema = z.object({
  /** Optional — restrict the poll to a single scan's PRs. */
  scanId: z.string().min(1).max(64).optional(),
})

export async function POST(req: NextRequest) {
  const limited = applyRateLimit(req, 'api')
  if (limited) return limited

  try {
    // Body is optional; tolerate an empty request.
    const raw = await req.json().catch(() => ({}))
    const { scanId } = PollSchema.parse(raw ?? {})
    const summary = await pollPrStates({ scanId })
    return NextResponse.json({ ok: true, summary })
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
