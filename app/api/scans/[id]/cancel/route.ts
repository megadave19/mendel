/**
 * POST /api/scans/[id]/cancel — Fix #4 (audit-2).
 * Soft-cancels a running scan. Runner checks the cancel flag between phases
 * and throws "Scan cancelled by user", which the outer catch maps to
 * status='cancelled'.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requestCancel } from '@/lib/agent/runner'
import { applyRateLimit } from '@/lib/rate-limit'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = applyRateLimit(req, 'api')
  if (limited) return limited

  const { id } = await params
  const ok = requestCancel(id)
  return NextResponse.json({ ok }, { status: ok ? 202 : 404 })
}
