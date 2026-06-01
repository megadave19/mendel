/**
 * v2.3 / F24 sub-phase 3 — API route tests for the auto-merge UI.
 *
 * Mocks @/lib/db so we can pin behavior without a live SQLite. The
 * routes are thin (validation + upsert + return); these tests catch
 * the boundary cases the UI relies on:
 *
 *   - GET on a missing row returns the schema defaults + exists:false
 *   - GET on a malformed repoFullName returns 400
 *   - PUT validates the body (Zod) and upserts with the right shape
 *   - PUT clamps server-side via Zod min/max (HTTP 400 below 0 or above 100)
 *   - URL-decoded path segment is what reaches Prisma (otherwise a
 *     "megadave19%2Fmendel-test" arg would miss the unique index)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    repoSetting: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  // Tests don't exercise the rate-limit code path; returning null = allowed.
  applyRateLimit: () => null,
}))

// Import AFTER mocks land.
import { GET, PUT } from '@/app/api/repo-settings/[repoFullName]/route'

function mkReq(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  mocks.findUnique.mockReset()
  mocks.upsert.mockReset()
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/repo-settings/[repoFullName]', () => {
  it('returns schema defaults + exists:false when the row does not exist', async () => {
    mocks.findUnique.mockResolvedValueOnce(null)
    const res = await GET(
      mkReq('http://localhost/api/repo-settings/megadave19%2Fmendel-test'),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.repoFullName).toBe('megadave19/mendel-test')
    expect(body.autoMergeEnabled).toBe(false)
    expect(body.autoMergeConfidenceFloor).toBe(90)
    expect(body.autoMergeDwellSeconds).toBe(60)
    expect(body.exists).toBe(false)
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { repoFullName: 'megadave19/mendel-test' },
    })
  })

  it('returns the stored row when one exists', async () => {
    const updated = new Date('2026-06-01T01:02:03Z')
    mocks.findUnique.mockResolvedValueOnce({
      repoFullName: 'megadave19/mendel-test',
      autoMergeEnabled: true,
      autoMergeConfidenceFloor: 95,
      autoMergeDwellSeconds: 30,
      updatedAt: updated,
    })
    const res = await GET(
      mkReq('http://localhost/api/repo-settings/megadave19%2Fmendel-test'),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    const body = await res.json()
    expect(body.exists).toBe(true)
    expect(body.autoMergeEnabled).toBe(true)
    expect(body.autoMergeConfidenceFloor).toBe(95)
    expect(body.autoMergeDwellSeconds).toBe(30)
    expect(body.updatedAt).toBe(updated.toISOString())
  })

  it('returns 400 on a malformed repoFullName (path-traversal / non-GitHub chars)', async () => {
    const res = await GET(
      mkReq('http://localhost/api/repo-settings/not-a-slash'),
      { params: Promise.resolve({ repoFullName: 'not-a-slash' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it('returns 400 on a non-decodable path segment (mangled %)', async () => {
    const res = await GET(
      mkReq('http://localhost/api/repo-settings/%FF'),
      { params: Promise.resolve({ repoFullName: '%FF' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })
})

// ── PUT ───────────────────────────────────────────────────────────────────────

describe('PUT /api/repo-settings/[repoFullName]', () => {
  it('upserts with the validated body and returns the saved row', async () => {
    const updated = new Date('2026-06-01T02:00:00Z')
    mocks.upsert.mockResolvedValueOnce({
      repoFullName: 'megadave19/mendel-test',
      autoMergeEnabled: true,
      autoMergeConfidenceFloor: 92,
      autoMergeDwellSeconds: 45,
      updatedAt: updated,
    })
    const res = await PUT(
      mkReq('http://localhost/api/repo-settings/megadave19%2Fmendel-test', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          autoMergeEnabled: true,
          autoMergeConfidenceFloor: 92,
          autoMergeDwellSeconds: 45,
        }),
      }),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.autoMergeEnabled).toBe(true)
    expect(body.exists).toBe(true)
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { repoFullName: 'megadave19/mendel-test' },
      create: {
        repoFullName: 'megadave19/mendel-test',
        autoMergeEnabled: true,
        autoMergeConfidenceFloor: 92,
        autoMergeDwellSeconds: 45,
      },
      update: {
        autoMergeEnabled: true,
        autoMergeConfidenceFloor: 92,
        autoMergeDwellSeconds: 45,
      },
    })
  })

  it('returns 400 when confidence floor is above 100', async () => {
    const res = await PUT(
      mkReq('http://localhost/api/repo-settings/megadave19%2Fmendel-test', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          autoMergeEnabled: true,
          autoMergeConfidenceFloor: 999,
          autoMergeDwellSeconds: 60,
        }),
      }),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('returns 400 when dwellSeconds exceeds the day cap', async () => {
    const res = await PUT(
      mkReq('http://localhost/api/repo-settings/megadave19%2Fmendel-test', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          autoMergeEnabled: false,
          autoMergeConfidenceFloor: 90,
          autoMergeDwellSeconds: 1_000_000,
        }),
      }),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('returns 400 when body is missing required fields', async () => {
    const res = await PUT(
      mkReq('http://localhost/api/repo-settings/megadave19%2Fmendel-test', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoMergeEnabled: true }),
      }),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('returns 400 on a malformed repoFullName (path validation runs before Prisma)', async () => {
    const res = await PUT(
      mkReq('http://localhost/api/repo-settings/not-a-slash', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          autoMergeEnabled: false,
          autoMergeConfidenceFloor: 90,
          autoMergeDwellSeconds: 60,
        }),
      }),
      { params: Promise.resolve({ repoFullName: 'not-a-slash' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
