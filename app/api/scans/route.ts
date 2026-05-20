import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { runScan } from '@/lib/agent/runner'
import { encrypt } from '@/lib/crypto'
import { applyRateLimit } from '@/lib/rate-limit'

const StartScanSchema = z.object({
  repoUrl: z.string().url().includes('github.com'),
  pat: z.string().min(1),
})

export async function POST(req: NextRequest) {
  // Rate limit: 10 new scans / min per IP (CLAUDE.md §5 Rule 3)
  const limited = applyRateLimit(req, 'newScan')
  if (limited) return limited

  try {
    const body = StartScanSchema.parse(await req.json())

    // Encrypt PAT before persisting — never stored in plaintext (CLAUDE.md §5 Rule 5)
    const encryptedPat = encrypt(body.pat)

    const scan = await db.scan.create({
      data: {
        repoUrl: body.repoUrl,
        status: 'queued',
        schemaVersion: '1.0',
        encryptedPat,
      },
    })

    // Fire and forget — SSE route streams progress
    // Pass plaintext PAT in-memory for this request's lifetime; runner
    // can also decrypt scan.encryptedPat if it needs to resume after restart.
    void runScan(scan.id, body.repoUrl, body.pat)

    return NextResponse.json({ id: scan.id }, { status: 202 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  // Rate limit: 60 reads / min per IP
  const limited = applyRateLimit(req, 'api')
  if (limited) return limited

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
      // encryptedPat intentionally omitted — never returned to client
    },
  })
  return NextResponse.json(scans)
}
