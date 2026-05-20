/**
 * In-memory rate limiter — fixed window, keyed by (IP + route).
 *
 * v1.0 limits per CLAUDE.md §5 Rule 3:
 *   POST /api/scans  : 10 req / 60 s
 *   All other API    : 60 req / 60 s
 *
 * This is intentionally simple: single-process, resets on server restart.
 * Replace with Redis + @upstash/ratelimit before any multi-instance deploy.
 */

import { NextRequest, NextResponse } from 'next/server'

interface WindowEntry {
  count: number
  resetAt: number // epoch ms
}

// Single shared store — survives across requests in the same process
const store = new Map<string, WindowEntry>()

// Prune expired entries every 5 minutes to prevent unbounded growth
const PRUNE_INTERVAL_MS = 5 * 60 * 1000
const pruneTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key)
  }
}, PRUNE_INTERVAL_MS)

// Prevent the timer from keeping the process alive during tests
if (typeof pruneTimer.unref === 'function') pruneTimer.unref()

// ─── Core check ──────────────────────────────────────────────────────────────

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the window resets (only set when not allowed) */
  retryAfter: number
  /** Remaining requests in the current window */
  remaining: number
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt < now) {
    // New window
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfter: 0, remaining: limit - 1 }
  }

  if (entry.count >= limit) {
    return {
      allowed: false,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      remaining: 0,
    }
  }

  entry.count++
  return { allowed: true, retryAfter: 0, remaining: limit - entry.count }
}

// ─── IP extraction helper ─────────────────────────────────────────────────────

export function getClientIp(req: NextRequest): string {
  // Prefer forwarded IP (set by proxies/load balancers); fall back to direct
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

// ─── Named limit presets (per CLAUDE.md §5 Rule 3) ───────────────────────────

const LIMITS = {
  /** POST /api/scans — expensive operation, strict cap */
  newScan: { limit: 10, windowMs: 60_000 },
  /** General API reads */
  api: { limit: 60, windowMs: 60_000 },
} as const

type LimitName = keyof typeof LIMITS

/**
 * Apply a named rate limit to a request.
 * Returns a 429 NextResponse if over limit, or null if allowed.
 *
 * Usage:
 *   const limited = applyRateLimit(req, 'newScan')
 *   if (limited) return limited
 */
export function applyRateLimit(
  req: NextRequest,
  limitName: LimitName,
): NextResponse | null {
  const { limit, windowMs } = LIMITS[limitName]
  const ip = getClientIp(req)
  const key = `${limitName}:${ip}`

  const result = checkRateLimit(key, limit, windowMs)

  if (!result.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(result.retryAfter),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
        },
      },
    )
  }

  return null
}
