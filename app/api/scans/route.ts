import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { runScan } from '@/lib/agent/runner'

const StartScanSchema = z.object({
  repoUrl: z.string().url().includes('github.com'),
  pat: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = StartScanSchema.parse(await req.json())

    const scan = await db.scan.create({
      data: {
        repoUrl: body.repoUrl,
        status: 'queued',
        schemaVersion: '1.0',
      },
    })

    // Fire and forget — SSE route streams progress
    void runScan(scan.id, body.repoUrl, body.pat)

    return NextResponse.json({ scanId: scan.id }, { status: 202 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  const scans = await db.scan.findMany({
    orderBy: { startedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      repoUrl: true,
      status: true,
      startedAt: true,
      completedAt: true,
      issuesFound: true,
      prsOpened: true,
    },
  })
  return NextResponse.json(scans)
}
