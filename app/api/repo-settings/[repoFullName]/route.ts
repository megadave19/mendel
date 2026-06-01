/**
 * GET/PUT /api/repo-settings/[repoFullName]
 *
 * Read / upsert per-repo auto-merge configuration. The Settings UI
 * (S9 + the F24 auto-merge section) reads this to render current
 * state, then PUTs back when the user toggles or saves.
 *
 * **Honesty rules (CLAUDE.md §5c r1 + r7):**
 *  - GET on a repo with NO row returns the schema defaults
 *    (autoMergeEnabled=false, floor=90, dwell=60). The UI then
 *    presents "off" honestly without needing to know whether the
 *    user has ever visited this repo before.
 *  - PUT does an upsert with the schema defaults so a brand-new row
 *    is born with the safe defaults. The user MUST opt-in by
 *    sending autoMergeEnabled=true explicitly.
 *  - PUT input is clamped:
 *      - autoMergeConfidenceFloor: [0, 100] (the policy hard-clamps
 *        further at runtime per §5c r7 — we don't lie about user
 *        intent here, we record what they asked for)
 *      - autoMergeDwellSeconds: [0, 86400] (mirrors clampDwell)
 *  - URL encoding: repoFullName arrives URL-encoded ("megadave19%2Fmendel-test")
 *    because slashes are reserved in path segments. We decode + re-validate.
 *
 * Rate limited (60/min read, 10/min write — same shape as the rest
 * of the app per CLAUDE.md §5 rule 3).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { applyRateLimit } from '@/lib/rate-limit'
import { db } from '@/lib/db'

// owner/name must each match GitHub's repo-name charset; cap length so a
// pathological URL can't blow up the DB query path.
const REPO_FULL_NAME = z.string().min(3).max(200).regex(
  /^[\w.-]+\/[\w.-]+$/,
  'repoFullName must be "owner/name" with GitHub-safe characters',
)

const PutBody = z.object({
  autoMergeEnabled: z.boolean(),
  autoMergeConfidenceFloor: z.number().int().min(0).max(100),
  autoMergeDwellSeconds: z.number().int().min(0).max(86_400),
})

const SCHEMA_DEFAULTS = {
  autoMergeEnabled: false,
  autoMergeConfidenceFloor: 90,
  autoMergeDwellSeconds: 60,
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

  const row = await db.repoSetting.findUnique({ where: { repoFullName } })
  if (!row) {
    // §5c r1: default-OFF. The UI sees a clean "off" view without
    // needing to distinguish "never configured" from "explicitly off."
    return NextResponse.json({ ...SCHEMA_DEFAULTS, repoFullName, exists: false })
  }
  return NextResponse.json({
    repoFullName: row.repoFullName,
    autoMergeEnabled: row.autoMergeEnabled,
    autoMergeConfidenceFloor: row.autoMergeConfidenceFloor,
    autoMergeDwellSeconds: row.autoMergeDwellSeconds,
    exists: true,
    updatedAt: row.updatedAt.toISOString(),
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ repoFullName: string }> },
) {
  // Tight bucket on writes — same shape as the scan POST endpoint
  // (CLAUDE.md §5 rule 3: 10/min on state-changing endpoints).
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

  const row = await db.repoSetting.upsert({
    where: { repoFullName },
    create: {
      repoFullName,
      autoMergeEnabled: body.autoMergeEnabled,
      autoMergeConfidenceFloor: body.autoMergeConfidenceFloor,
      autoMergeDwellSeconds: body.autoMergeDwellSeconds,
    },
    update: {
      autoMergeEnabled: body.autoMergeEnabled,
      autoMergeConfidenceFloor: body.autoMergeConfidenceFloor,
      autoMergeDwellSeconds: body.autoMergeDwellSeconds,
    },
  })

  return NextResponse.json({
    repoFullName: row.repoFullName,
    autoMergeEnabled: row.autoMergeEnabled,
    autoMergeConfidenceFloor: row.autoMergeConfidenceFloor,
    autoMergeDwellSeconds: row.autoMergeDwellSeconds,
    exists: true,
    updatedAt: row.updatedAt.toISOString(),
  })
}
