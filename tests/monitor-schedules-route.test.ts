/**
 * v2.3 / F25 sub-phase 2 — API route tests for monitor schedules.
 *
 * Mocks @/lib/db + @/lib/crypto. Tests pin:
 *
 *   - GET on missing row returns schema defaults + exists:false +
 *     hasPat:false (never the encryptedPat)
 *   - GET on stored row NEVER exposes encryptedPat — only hasPat
 *   - PUT on CREATE requires a `pat` (400 otherwise)
 *   - PUT on UPDATE without `pat` preserves the prior encryptedPat
 *   - PUT clamps cron via validateCronExpression (400 on bad shape)
 *   - PUT 400 on bad repoFullName / bad repoUrl
 *   - DELETE removes the row + returns ok
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  encrypt: vi.fn((s: string) => `enc:${s}`),
}))

vi.mock('@/lib/db', () => ({
  db: {
    monitorSchedule: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      deleteMany: mocks.deleteMany,
    },
  },
}))
vi.mock('@/lib/crypto', () => ({
  encrypt: mocks.encrypt,
  decrypt: (s: string) => s.replace(/^enc:/, ''),
}))
vi.mock('@/lib/rate-limit', () => ({ applyRateLimit: () => null }))

import { GET, PUT, DELETE } from '@/app/api/monitor-schedules/[repoFullName]/route'

function mkReq(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  mocks.findUnique.mockReset()
  mocks.upsert.mockReset()
  mocks.deleteMany.mockReset()
  mocks.encrypt.mockClear()
})

// ── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/monitor-schedules/[repoFullName]', () => {
  it('returns schema defaults + exists:false + hasPat:false on missing row', async () => {
    mocks.findUnique.mockResolvedValueOnce(null)
    const res = await GET(
      mkReq('http://localhost/api/monitor-schedules/megadave19%2Fmendel-test'),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.repoFullName).toBe('megadave19/mendel-test')
    expect(body.enabled).toBe(false)
    expect(body.cronExpression).toBe('0 */6 * * *')
    expect(body.exists).toBe(false)
    expect(body.hasPat).toBe(false)
    expect(body.repoUrl).toBe('https://github.com/megadave19/mendel-test')
    // CRITICAL: no encryptedPat exposed.
    expect(body.encryptedPat).toBeUndefined()
  })

  it('returns the stored row WITHOUT the encryptedPat (hasPat:true)', async () => {
    mocks.findUnique.mockResolvedValueOnce({
      repoFullName: 'megadave19/mendel-test',
      repoUrl: 'https://github.com/megadave19/mendel-test',
      cronExpression: '0 0 * * *',
      enabled: true,
      encryptedPat: 'enc:secret-pat-value',
      lastFiredAt: new Date('2026-06-01T00:00:00Z'),
      lastErrorAt: null,
      lastError: null,
      updatedAt: new Date('2026-06-01T01:00:00Z'),
    })
    const res = await GET(
      mkReq('http://localhost/api/monitor-schedules/megadave19%2Fmendel-test'),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    const body = await res.json()
    expect(body.exists).toBe(true)
    expect(body.hasPat).toBe(true)
    // CRITICAL: encryptedPat is NEVER in the response.
    expect(body.encryptedPat).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('enc:secret-pat-value')
  })

  it('returns 400 on malformed repoFullName', async () => {
    const res = await GET(
      mkReq('http://localhost/api/monitor-schedules/no-slash'),
      { params: Promise.resolve({ repoFullName: 'no-slash' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })
})

// ── PUT ──────────────────────────────────────────────────────────────────────

describe('PUT /api/monitor-schedules/[repoFullName]', () => {
  it('CREATE requires pat (400 otherwise)', async () => {
    mocks.findUnique.mockResolvedValueOnce(null) // no existing row
    const res = await PUT(
      mkReq('http://localhost/api/monitor-schedules/megadave19%2Fmendel-test', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoUrl: 'https://github.com/megadave19/mendel-test',
          cronExpression: '0 */6 * * *',
          enabled: true,
          // pat OMITTED — must 400
        }),
      }),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/pat is required/)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('CREATE encrypts pat + upserts the row', async () => {
    mocks.findUnique.mockResolvedValueOnce(null)
    mocks.upsert.mockResolvedValueOnce({
      repoFullName: 'megadave19/mendel-test',
      repoUrl: 'https://github.com/megadave19/mendel-test',
      cronExpression: '0 */6 * * *',
      enabled: true,
      encryptedPat: 'enc:plaintext',
      lastFiredAt: null,
      lastErrorAt: null,
      lastError: null,
      updatedAt: new Date('2026-06-01T01:00:00Z'),
    })
    const res = await PUT(
      mkReq('http://localhost/api/monitor-schedules/megadave19%2Fmendel-test', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoUrl: 'https://github.com/megadave19/mendel-test',
          cronExpression: '0 */6 * * *',
          enabled: true,
          pat: 'plaintext',
        }),
      }),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    expect(res.status).toBe(200)
    expect(mocks.encrypt).toHaveBeenCalledWith('plaintext')
    expect(mocks.upsert).toHaveBeenCalled()
    const call = mocks.upsert.mock.calls[0][0]
    expect(call.create.encryptedPat).toBe('enc:plaintext')
    // CRITICAL: response never exposes encryptedPat or plaintext.
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('enc:plaintext')
    expect(JSON.stringify(body)).not.toContain('plaintext')
    expect(body.hasPat).toBe(true)
  })

  it('UPDATE without pat PRESERVES the prior encryptedPat', async () => {
    mocks.findUnique.mockResolvedValueOnce({
      repoFullName: 'megadave19/mendel-test',
      repoUrl: 'https://github.com/megadave19/mendel-test',
      cronExpression: '0 0 * * *',
      enabled: false,
      encryptedPat: 'enc:prior-ciphertext',
      lastFiredAt: null,
      lastErrorAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    mocks.upsert.mockResolvedValueOnce({
      repoFullName: 'megadave19/mendel-test',
      repoUrl: 'https://github.com/megadave19/mendel-test',
      cronExpression: '0 */6 * * *',
      enabled: true,
      encryptedPat: 'enc:prior-ciphertext',
      lastFiredAt: null,
      lastErrorAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    await PUT(
      mkReq('http://localhost/api/monitor-schedules/megadave19%2Fmendel-test', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoUrl: 'https://github.com/megadave19/mendel-test',
          cronExpression: '0 */6 * * *',
          enabled: true,
          // pat OMITTED
        }),
      }),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    expect(mocks.encrypt).not.toHaveBeenCalled() // no new ciphertext
    const call = mocks.upsert.mock.calls[0][0]
    expect(call.update.encryptedPat).toBe('enc:prior-ciphertext') // preserved
  })

  it('returns 400 on a cron expression that fails validateCronExpression', async () => {
    const res = await PUT(
      mkReq('http://localhost/api/monitor-schedules/megadave19%2Fmendel-test', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoUrl: 'https://github.com/megadave19/mendel-test',
          cronExpression: 'BOGUS',
          enabled: true,
          pat: 'p',
        }),
      }),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('returns 400 on a non-https/github.com repoUrl', async () => {
    const res = await PUT(
      mkReq('http://localhost/api/monitor-schedules/megadave19%2Fmendel-test', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoUrl: 'https://gitlab.com/megadave19/mendel-test',
          cronExpression: '0 */6 * * *',
          enabled: false,
          pat: 'p',
        }),
      }),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('returns 400 on malformed repoFullName (validation runs BEFORE Prisma)', async () => {
    const res = await PUT(
      mkReq('http://localhost/api/monitor-schedules/no-slash', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoUrl: 'https://github.com/x/y',
          cronExpression: '0 */6 * * *',
          enabled: false,
          pat: 'p',
        }),
      }),
      { params: Promise.resolve({ repoFullName: 'no-slash' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })
})

// ── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/monitor-schedules/[repoFullName]', () => {
  it('removes the row and returns ok', async () => {
    mocks.deleteMany.mockResolvedValueOnce({ count: 1 })
    const res = await DELETE(
      mkReq('http://localhost/api/monitor-schedules/megadave19%2Fmendel-test', { method: 'DELETE' }),
      { params: Promise.resolve({ repoFullName: 'megadave19%2Fmendel-test' }) },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { repoFullName: 'megadave19/mendel-test' } })
  })

  it('returns 400 on malformed repoFullName', async () => {
    const res = await DELETE(
      mkReq('http://localhost/api/monitor-schedules/no-slash', { method: 'DELETE' }),
      { params: Promise.resolve({ repoFullName: 'no-slash' }) },
    )
    expect(res.status).toBe(400)
    expect(mocks.deleteMany).not.toHaveBeenCalled()
  })
})
