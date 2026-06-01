/**
 * v2.3 / F24 sub-phase 3 — GET /api/agent-log route tests.
 *
 * The route returns recent AgentLog rows filtered by scanId / issueId /
 * kind. Tests pin:
 *   - Default pagination (50 rows) when no limit is supplied
 *   - Explicit limit honored within [1, 100]
 *   - kind=prefix is forwarded as a Prisma `startsWith` filter
 *   - Malformed payloads in the DB don't crash the renderer — they
 *     surface as `__parseError` (the honest-degradation contract)
 *   - 400 on invalid query input (Zod validation)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: { agentLog: { findMany: mocks.findMany } },
}))
vi.mock('@/lib/rate-limit', () => ({ applyRateLimit: () => null }))

import { GET } from '@/app/api/agent-log/route'

function mkReq(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => mocks.findMany.mockReset())

describe('GET /api/agent-log', () => {
  it('uses default limit=50 when none supplied; orders desc by createdAt', async () => {
    mocks.findMany.mockResolvedValueOnce([])
    const res = await GET(mkReq('http://localhost/api/agent-log'))
    expect(res.status).toBe(200)
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  })

  it('forwards a kind prefix as Prisma startsWith', async () => {
    mocks.findMany.mockResolvedValueOnce([])
    await GET(mkReq('http://localhost/api/agent-log?kind=automerge.'))
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { kind: { startsWith: 'automerge.' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  })

  it('honors an explicit limit within [1, 100]', async () => {
    mocks.findMany.mockResolvedValueOnce([])
    await GET(mkReq('http://localhost/api/agent-log?limit=12'))
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      take: 12,
    })
  })

  it('returns 400 on a limit above the cap', async () => {
    const res = await GET(mkReq('http://localhost/api/agent-log?limit=99999'))
    expect(res.status).toBe(400)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it('returns 400 on a kind with disallowed characters', async () => {
    const res = await GET(mkReq('http://localhost/api/agent-log?kind=automerge%20DROP'))
    expect(res.status).toBe(400)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it('parses JSON payload; surfaces __parseError instead of crashing on bad data', async () => {
    mocks.findMany.mockResolvedValueOnce([
      {
        id: 'a1',
        scanId: 'scan-1',
        issueId: 'iss-1',
        kind: 'automerge.verdict',
        payload: '{"shouldMerge":true,"reasons":[]}',
        createdAt: new Date('2026-06-01T00:00:00Z'),
      },
      {
        id: 'a2',
        scanId: 'scan-1',
        issueId: 'iss-2',
        kind: 'automerge.merge',
        payload: 'NOT_JSON',
        createdAt: new Date('2026-06-01T00:00:01Z'),
      },
    ])
    const res = await GET(mkReq('http://localhost/api/agent-log?scanId=scan-1'))
    const body = await res.json()
    expect(body.rows).toHaveLength(2)
    expect(body.rows[0].payload).toEqual({ shouldMerge: true, reasons: [] })
    expect((body.rows[1].payload as { __parseError: string }).__parseError).toBeTruthy()
  })

  it('forwards scanId + issueId filters when present', async () => {
    mocks.findMany.mockResolvedValueOnce([])
    await GET(mkReq('http://localhost/api/agent-log?scanId=s1&issueId=i1&kind=automerge.'))
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { scanId: 's1', issueId: 'i1', kind: { startsWith: 'automerge.' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  })
})
