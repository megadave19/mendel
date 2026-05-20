import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit } from '@/lib/rate-limit'

describe('checkRateLimit', () => {
  it('allows requests under the limit', () => {
    const key = `test-${Date.now()}-a`
    const result = checkRateLimit(key, 5, 60_000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('counts up correctly within a window', () => {
    const key = `test-${Date.now()}-b`
    checkRateLimit(key, 3, 60_000)
    checkRateLimit(key, 3, 60_000)
    const third = checkRateLimit(key, 3, 60_000)
    expect(third.allowed).toBe(true)
    expect(third.remaining).toBe(0)
  })

  it('blocks the request exactly at the limit', () => {
    const key = `test-${Date.now()}-c`
    checkRateLimit(key, 2, 60_000)
    checkRateLimit(key, 2, 60_000)
    const over = checkRateLimit(key, 2, 60_000)
    expect(over.allowed).toBe(false)
    expect(over.remaining).toBe(0)
    expect(over.retryAfter).toBeGreaterThan(0)
  })

  it('resets after the window expires', async () => {
    const key = `test-${Date.now()}-d`
    const windowMs = 50 // 50ms window for test speed
    checkRateLimit(key, 1, windowMs)
    const over = checkRateLimit(key, 1, windowMs)
    expect(over.allowed).toBe(false)

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, windowMs + 10))

    const after = checkRateLimit(key, 1, windowMs)
    expect(after.allowed).toBe(true)
  })

  it('isolates keys from each other', () => {
    const ts = Date.now()
    const key1 = `test-${ts}-e1`
    const key2 = `test-${ts}-e2`
    checkRateLimit(key1, 1, 60_000)
    checkRateLimit(key1, 1, 60_000) // key1 now blocked

    const key2Result = checkRateLimit(key2, 1, 60_000)
    expect(key2Result.allowed).toBe(true) // key2 unaffected
  })
})
