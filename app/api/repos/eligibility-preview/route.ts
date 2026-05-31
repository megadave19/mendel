/**
 * POST /api/repos/eligibility-preview
 *
 * Live eligibility verdict for a (owner, repo) before the user starts a scan.
 * Returns the same decision the scan-time gate will make, plus signal detail
 * (governance files, dep automation, linkable issue) and an `ackNeeded` flag
 * so the New Scan UI can either ask for the external-ack checkbox or hide it.
 *
 * Read-only. Fail-soft: any unrecoverable error returns `degraded:true` so
 * the runtime gate stays the safety net (CLAUDE.md §5c.1 — never bypass).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { applyRateLimit } from '@/lib/rate-limit'
import { previewEligibility } from '@/lib/agent/eligibility-preview'

// Owner/repo charset matches GitHub: alnum, dot, dash, underscore. Cap length
// so a pathological input can't run a 10k-char Octokit path through to GitHub.
const NAME = z.string().min(1).max(100).regex(/^[\w.-]+$/, 'invalid character')

const Body = z.object({
  pat: z.string().min(1).max(200),
  owner: NAME,
  repo: NAME,
})

export async function POST(req: NextRequest) {
  // 60/min — same as every other read endpoint (CLAUDE §5 rule 3).
  const limited = applyRateLimit(req, 'api')
  if (limited) return limited

  let parsed: z.infer<typeof Body>
  try {
    parsed = Body.parse(await req.json())
  } catch (err) {
    const message = err instanceof z.ZodError
      ? err.issues.map((i) => i.message).join('; ')
      : 'Invalid request body'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    const preview = await previewEligibility(parsed.pat, parsed.owner, parsed.repo)
    return NextResponse.json(preview)
  } catch (err) {
    // §5 rule 8: errors to client are generic; full detail stays server-side.
    // We deliberately return `degraded:true` (not a hard 500) so the UI can
    // show "couldn't preview; runtime gate still applies" instead of breaking.
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      {
        decision: 'unknown',
        canOpenPRsIfAcknowledged: false,
        ackNeeded: false,
        reason: `Couldn't reach GitHub: ${message.slice(0, 200)}`,
        signals: {
          ownsRepo: false,
          depAutomation: null,
          contributingRedFlag: null,
          hasCodeOfConduct: false,
          hasContributing: false,
        },
        linkableIssue: null,
        degraded: true,
      },
      { status: 200 },
    )
  }
}
