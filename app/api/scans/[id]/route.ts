import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { applyRateLimit } from '@/lib/rate-limit'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = applyRateLimit(req, 'api')
  if (limited) return limited

  const { id } = await params
  const scan = await db.scan.findUnique({
    where: { id },
    select: {
      id: true,
      repoUrl: true,
      status: true,
      startedAt: true,
      completedAt: true,
      issuesFound: true,
      prsOpened: true,
      totalTokens: true,
      schemaVersion: true,
      issues: true,
      agentLogs: true,
      // encryptedPat intentionally omitted — never returned to client
    },
  })

  if (!scan) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  }

  return NextResponse.json(scan)
}
