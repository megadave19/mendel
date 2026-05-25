/**
 * POST /api/validate-pat — Fix #1.
 *
 * The connect page was POSTing here but the route didn't exist, so it fell
 * through to `catch` and accepted any non-empty string as valid. The
 * "Validating…" UX was lying. This calls GitHub's /user with the PAT and
 * returns valid/scopes — actually validates.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { applyRateLimit } from '@/lib/rate-limit'

const Body = z.object({ pat: z.string().min(1) })

export async function POST(req: NextRequest) {
  const limited = applyRateLimit(req, 'api')
  if (limited) return limited

  let pat: string
  try {
    pat = Body.parse(await req.json()).pat.trim()
  } catch {
    return NextResponse.json({ valid: false, error: 'PAT is required' }, { status: 400 })
  }

  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${pat}`,
        'User-Agent': 'mendel-agent',
        Accept: 'application/vnd.github+json',
      },
    })
    if (!res.ok) {
      return NextResponse.json({
        valid: false,
        error: res.status === 401 ? 'PAT rejected by GitHub (check the token).' : `GitHub returned ${res.status}.`,
      })
    }
    const user = (await res.json()) as { login?: string }
    // x-oauth-scopes is empty for fine-grained tokens; classic tokens list scopes.
    const scopes = res.headers.get('x-oauth-scopes')?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
    return NextResponse.json({ valid: true, login: user.login, scopes })
  } catch (err) {
    return NextResponse.json({
      valid: false,
      error: `Network error reaching GitHub: ${err instanceof Error ? err.message : String(err)}`,
    }, { status: 502 })
  }
}
