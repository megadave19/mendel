import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { runScan } from '@/lib/agent/runner'
import { encrypt } from '@/lib/crypto'
import { applyRateLimit } from '@/lib/rate-limit'

const StartScanSchema = z.object({
  repoUrl: z.string().url().includes('github.com'),
  pat: z.string().min(1),
  /**
   * v1.5 Workstream #4 — optional per-scan confidence threshold (40–100).
   * Server clamps to that range. When omitted, runner falls back to
   * MENDEL_CONFIDENCE_THRESHOLD env var (default 70).
   */
  confidenceThreshold: z.number().int().min(40).max(100).optional(),
  /**
   * v1.5 Workstream #8 — optional tier-2 sandbox allowlist hosts. Caps at
   * 32 entries server-side. Per-host validation happens inside buildAllowlist;
   * invalid entries are kept here so they surface as runner log lines (we
   * never silently drop them per CLAUDE.md §5b).
   */
  tier2AllowlistHosts: z.array(z.string().max(253)).max(32).optional(),
  /**
   * 2026-05-29 — Contribution Eligibility Gate (CLAUDE.md §5c). For repos the
   * user doesn't own, set true to confirm the repo welcomes dependency PRs
   * (they've read its CONTRIBUTING + CoC). Default false → non-owned repos are
   * analyzed but no PR is opened (report only). Owned repos ignore this.
   */
  externalContributionAck: z.boolean().optional(),
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
    // v1.5 W#4: optional confidence threshold travels with the scan request.
    void runScan(scan.id, body.repoUrl, body.pat, {
      confidenceThreshold: body.confidenceThreshold,
      tier2AllowlistHosts: body.tier2AllowlistHosts,
      externalContributionAck: body.externalContributionAck,
    })

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
      errorMessage: true,
      // v1.5 W#6: surface the per-scan calibration summary so the dashboard
      // panel can render trend + bucket distribution + regression rate.
      confidenceSummary: true,
      // encryptedPat intentionally omitted — never returned to client
    },
  })
  return NextResponse.json(scans)
}
