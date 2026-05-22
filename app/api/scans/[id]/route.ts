import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { applyRateLimit } from '@/lib/rate-limit'
import { dbIssueToVM } from '@/lib/agent/issue-vm'

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
      deps: true,
      issues: true,
      // encryptedPat intentionally omitted — never returned to client
    },
  })

  if (!scan) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  }

  // Parse the persisted dep-name list (JSON string[]) for the dep graph.
  let deps: string[] = []
  try {
    if (scan.deps) deps = JSON.parse(scan.deps) as string[]
  } catch {
    deps = []
  }

  // Map persisted DB issues → frontend IssueVM so the client renders real data.
  // `deps` below overrides the raw JSON string from `rest`.
  const { issues, ...rest } = scan
  return NextResponse.json({ ...rest, deps, issues: issues.map(dbIssueToVM) })
}
