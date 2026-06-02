/**
 * GET / PUT / DELETE /api/monitor-schedules/[repoFullName]
 *
 * Read / upsert / delete a per-repo monitor schedule. The Settings UI
 * (MonitorPanel) reads this to render current state and PUTs back when
 * the user toggles the enable flag or changes cron / dwell.
 *
 * **Security boundary (CLAUDE.md §5 r5, r17):**
 *  - GET NEVER returns the encryptedPat. The Settings UI only needs to
 *    know whether a PAT is stored (`hasPat`); it cannot extract the
 *    ciphertext or the plaintext.
 *  - PUT accepts an OPTIONAL `pat` field in the body. When supplied,
 *    it's encrypted via AES-256-GCM (`@/lib/crypto`) before persistence.
 *    When omitted on an existing row, the prior `encryptedPat` is
 *    preserved — so a user can toggle enable / change cron without
 *    re-entering their PAT.
 *  - PUT REQUIRES `pat` when CREATING a new row (no prior ciphertext to
 *    preserve). Refuses with a 400 in that case.
 *  - DELETE removes the row entirely. The worker's next reload picks
 *    that up + stops the prior task.
 *
 * **Honesty rules (mirrors the RepoSetting route):**
 *  - GET on a missing row returns the schema defaults + `exists:false`.
 *  - PUT clamps via Zod: cron via `validateCronExpression`; encrypted
 *    PAT length capped (the encrypted shape is ~< 200 chars).
 *  - URL-decoded path validated against the GitHub-safe regex.
 *
 * Rate limited: GET 60/min ('api'), PUT/DELETE 10/min ('newScan' bucket).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { applyRateLimit } from '@/lib/rate-limit'
import { db } from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { validateCronExpression } from '@/lib/agent/monitor/scheduler'

const REPO_FULL_NAME = z.string().min(3).max(200).regex(
  /^[\w.-]+\/[\w.-]+$/,
  'repoFullName must be "owner/name" with GitHub-safe characters',
)

const REPO_URL = z.string().url().refine(
  (u) => u.startsWith('https://github.com/'),
  'repoUrl must be an https://github.com/ URL',
)

const CRON = z.string().min(1).max(100).refine(
  (s) => validateCronExpression(s).ok,
  (s) => {
    const r = validateCronExpression(s)
    return { message: r.ok ? 'invalid cron' : r.reason }
  },
)

const PutBody = z.object({
  repoUrl: REPO_URL,
  cronExpression: CRON,
  enabled: z.boolean(),
  /** Plaintext PAT — encrypted server-side before persistence. Optional
   *  on UPDATE (prior ciphertext is preserved). Required on CREATE. */
  pat: z.string().min(1).max(200).optional(),
})

const SCHEMA_DEFAULTS = {
  cronExpression: '0 */6 * * *',
  enabled: false,
} as const

function decodeName(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw)
    if (!REPO_FULL_NAME.safeParse(decoded).success) return null
    return decoded
  } catch {
    return null
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ repoFullName: string }> },
) {
  const limited = applyRateLimit(req, 'api')
  if (limited) return limited

  const { repoFullName: raw } = await params
  const repoFullName = decodeName(raw)
  if (!repoFullName) {
    return NextResponse.json({ error: 'invalid repoFullName' }, { status: 400 })
  }

  const row = await db.monitorSchedule.findUnique({ where: { repoFullName } })
  if (!row) {
    return NextResponse.json({
      ...SCHEMA_DEFAULTS,
      repoFullName,
      repoUrl: `https://github.com/${repoFullName}`,
      hasPat: false,
      lastFiredAt: null,
      lastErrorAt: null,
      lastError: null,
      exists: false,
    })
  }
  // CRITICAL: never return encryptedPat. The UI only sees hasPat.
  return NextResponse.json({
    repoFullName: row.repoFullName,
    repoUrl: row.repoUrl,
    cronExpression: row.cronExpression,
    enabled: row.enabled,
    hasPat: Boolean(row.encryptedPat),
    lastFiredAt: row.lastFiredAt?.toISOString() ?? null,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    lastError: row.lastError ?? null,
    exists: true,
    updatedAt: row.updatedAt.toISOString(),
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ repoFullName: string }> },
) {
  const limited = applyRateLimit(req, 'newScan')
  if (limited) return limited

  const { repoFullName: raw } = await params
  const repoFullName = decodeName(raw)
  if (!repoFullName) {
    return NextResponse.json({ error: 'invalid repoFullName' }, { status: 400 })
  }

  let body: z.infer<typeof PutBody>
  try {
    body = PutBody.parse(await req.json())
  } catch (err) {
    const message =
      err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : 'invalid body'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // Existing row → preserve encryptedPat if pat was not supplied.
  const existing = await db.monitorSchedule.findUnique({ where: { repoFullName } })
  if (!existing && !body.pat) {
    // CREATE requires a PAT. Refuse honestly rather than create a row
    // with an empty encryptedPat (which would later crash at fire time
    // when decrypt('') throws).
    return NextResponse.json(
      { error: 'pat is required to create a new monitor schedule' },
      { status: 400 },
    )
  }

  const encryptedPat = body.pat ? encrypt(body.pat) : existing!.encryptedPat

  const row = await db.monitorSchedule.upsert({
    where: { repoFullName },
    create: {
      repoFullName,
      repoUrl: body.repoUrl,
      cronExpression: body.cronExpression,
      enabled: body.enabled,
      encryptedPat,
    },
    update: {
      repoUrl: body.repoUrl,
      cronExpression: body.cronExpression,
      enabled: body.enabled,
      encryptedPat,
    },
  })

  return NextResponse.json({
    repoFullName: row.repoFullName,
    repoUrl: row.repoUrl,
    cronExpression: row.cronExpression,
    enabled: row.enabled,
    hasPat: true, // we just guaranteed one above
    lastFiredAt: row.lastFiredAt?.toISOString() ?? null,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    lastError: row.lastError ?? null,
    exists: true,
    updatedAt: row.updatedAt.toISOString(),
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ repoFullName: string }> },
) {
  const limited = applyRateLimit(req, 'newScan')
  if (limited) return limited

  const { repoFullName: raw } = await params
  const repoFullName = decodeName(raw)
  if (!repoFullName) {
    return NextResponse.json({ error: 'invalid repoFullName' }, { status: 400 })
  }

  await db.monitorSchedule.deleteMany({ where: { repoFullName } })
  return NextResponse.json({ ok: true })
}
