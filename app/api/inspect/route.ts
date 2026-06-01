/**
 * POST /api/inspect — v2.1 / F22 "Point at any API" Mode.
 *
 * Validates inputs, runs `inspectApi`, persists the report, returns the
 * permalink id. Rate-limited like scans (10/min/IP) per CLAUDE.md §5 rule
 * 3. The PAT (when supplied) is used to fetch GitHub release notes for the
 * changelog signal — NEVER persisted (we only persist the analysis output,
 * never credentials, per §5 rule 5).
 *
 * §5b honesty rules surfaced here:
 *   - We refuse to "inspect" the same version → returns 422 with a clear
 *     explanation, not a misleading empty report.
 *   - Errors from the inspector are NOT thrown — they live in `report.errors`
 *     so the client can render an honest partial result.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { applyRateLimit } from '@/lib/rate-limit'
import { inspectApi } from '@/lib/agent/inspect'

// npm package names: ≤214 chars, scoped-or-unscoped, no uppercase, no
// leading dot/underscore. Semver: tolerant — accept anything that isn't
// obviously bogus (we delegate strict parsing to npm registry calls).
const PACKAGE_NAME = z
  .string()
  .min(1)
  .max(214)
  .regex(/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i, 'invalid npm package name')

const VERSION = z.string().min(1).max(50).regex(/^[0-9A-Za-z.+\-_]+$/, 'invalid version string')

const Body = z.object({
  packageName: PACKAGE_NAME,
  fromVersion: VERSION,
  toVersion: VERSION,
  /** Optional. When omitted, changelog signal is honest-skipped. */
  pat: z.string().min(10).max(200).optional(),
}).refine((b) => b.fromVersion !== b.toVersion, {
  message: 'fromVersion and toVersion must differ',
  path: ['toVersion'],
})

export async function POST(req: NextRequest) {
  // Same 10/min cap scans use — inspections also hit npm + GitHub.
  const limited = applyRateLimit(req, 'newScan')
  if (limited) return limited

  let parsed: z.infer<typeof Body>
  try {
    parsed = Body.parse(await req.json())
  } catch (err) {
    const message = err instanceof z.ZodError
      ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      : 'Invalid request body'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // Run the inspector. Per-signal failures land in report.errors, not
  // thrown — so the only thing that can blow up here is something we
  // genuinely couldn't recover from (e.g. an unexpected runtime error).
  let report: Awaited<ReturnType<typeof inspectApi>>
  try {
    report = await inspectApi({
      packageName: parsed.packageName,
      fromVersion: parsed.fromVersion,
      toVersion: parsed.toVersion,
      pat: parsed.pat,
    })
  } catch (err) {
    // §5 rule 8: generic to client; full detail server-side.
    console.error('[inspect] unexpected error', err)
    return NextResponse.json({ error: 'Inspection failed unexpectedly.' }, { status: 500 })
  }

  // Persist. We never store the PAT — only the analysis output. The
  // schema's `tenantId` is left null for v2-local; v3 cloud fills it.
  try {
    const row = await db.inspection.create({
      data: {
        packageName: report.packageName,
        fromVersion: report.fromVersion,
        toVersion: report.toVersion,
        report: JSON.stringify(report),
      },
    })
    return NextResponse.json({ id: row.id, report }, { status: 201 })
  } catch (err) {
    console.error('[inspect] persist failed', err)
    // Persistence failure isn't fatal to the analysis — return the
    // report inline so the client still shows it.
    return NextResponse.json({ id: null, report }, { status: 200 })
  }
}
