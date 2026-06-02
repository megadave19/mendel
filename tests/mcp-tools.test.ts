/**
 * v2.3 / F26 sub-phase 1 — MCP tool registry tests.
 *
 * The pure tools layer (`lib/mcp/tools.ts`) is tested without the SDK
 * in the loop:
 *   - Every tool in ALL_TOOLS has a unique name + non-empty description
 *   - invokeTool routes valid input to the handler and parses success
 *   - invokeTool returns {ok:false, error} on bad input (Zod fail) and
 *     names the failing path
 *   - Each individual tool's handler is exercised with a fake Prisma to
 *     pin the returned shape (notably: NO encryptedPat field anywhere,
 *     NO plaintext PAT, narrow Prisma `select`)
 *   - Strict schemas refuse unknown fields (defense-in-depth against
 *     a future SDK change that might pass through extra keys)
 */

import { describe, it, expect, vi } from 'vitest'
import {
  ALL_TOOLS,
  invokeTool,
  healthTool,
  scanListTool,
  scanGetTool,
  inspectionListTool,
  type ToolDeps,
  type McpPrisma,
} from '@/lib/mcp/tools'

// ── Fake deps ────────────────────────────────────────────────────────────────

function makeDeps(prismaOverrides: Partial<McpPrisma> = {}): ToolDeps {
  const baseScan = {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    findUnique: vi.fn().mockResolvedValue(null),
  }
  const baseIssue = {
    findMany: vi.fn().mockResolvedValue([]),
  }
  const baseInspection = {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  }
  return {
    db: {
      scan: { ...baseScan, ...(prismaOverrides.scan as object) },
      issue: { ...baseIssue, ...(prismaOverrides.issue as object) },
      inspection: { ...baseInspection, ...(prismaOverrides.inspection as object) },
    } as unknown as McpPrisma,
    now: () => new Date('2026-06-01T12:00:00Z'),
  }
}

// ── Registry-level contracts ─────────────────────────────────────────────────

describe('ALL_TOOLS registry', () => {
  it('every tool has a unique name + non-empty description', () => {
    const names = ALL_TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length) // unique
    for (const t of ALL_TOOLS) {
      expect(t.description.length).toBeGreaterThan(20)
    }
  })

  it('every tool name uses the mendel.* namespace', () => {
    for (const t of ALL_TOOLS) expect(t.name.startsWith('mendel.')).toBe(true)
  })

  it('sub-phase 1 exposes the read-only tools (no action tools yet)', () => {
    const expected = [
      'mendel.health',
      'mendel.scan.list',
      'mendel.scan.get',
      'mendel.inspect.list',
    ]
    expect(ALL_TOOLS.map((t) => t.name).sort()).toEqual(expected.sort())
  })
})

// ── invokeTool — validation contract ─────────────────────────────────────────

describe('invokeTool — validation', () => {
  it('routes valid input to the handler and returns {ok:true, result}', async () => {
    const out = await invokeTool(healthTool, {}, makeDeps())
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.result).toMatchObject({
        ok: true,
        server: 'mendel-mcp',
        serverTime: '2026-06-01T12:00:00.000Z',
      })
    }
  })

  it('returns {ok:false, error} naming the failing path on bad input', async () => {
    const out = await invokeTool(scanListTool, { limit: 9999 }, makeDeps())
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.error).toMatch(/limit/)
      expect(out.error).toMatch(/50/)
    }
  })

  it('strict schemas refuse unknown fields (defense-in-depth)', async () => {
    const out = await invokeTool(healthTool, { hidden: 'X' } as never, makeDeps())
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toMatch(/unrecognized/i)
  })

  it("catches handler exceptions and returns {ok:false, error} (never bubbles to the SDK)", async () => {
    const throwingTool = {
      ...healthTool,
      name: 'mendel.throws',
      handler: async () => {
        throw new Error('boom')
      },
    }
    const out = await invokeTool(throwingTool, {}, makeDeps())
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toBe('boom')
  })

  it("treats missing input as {} so an SDK call without args still validates", async () => {
    const out = await invokeTool(healthTool, undefined, makeDeps())
    expect(out.ok).toBe(true)
  })
})

// ── Tool: mendel.scan.list ───────────────────────────────────────────────────

describe('scanListTool', () => {
  it('returns scans with the documented shape; no encryptedPat field anywhere', async () => {
    const fixture = [
      {
        id: 'scan-1',
        repoUrl: 'https://github.com/x/y',
        status: 'completed',
        startedAt: new Date('2026-06-01T10:00:00Z'),
        completedAt: new Date('2026-06-01T10:05:00Z'),
        errorMessage: null,
        language: 'typescript',
        workspaceKind: null,
      },
    ]
    const deps = makeDeps({
      scan: {
        findMany: vi.fn().mockResolvedValue(fixture),
        count: vi.fn().mockResolvedValue(42),
      } as never,
    })
    const out = await invokeTool(scanListTool, { limit: 5 }, deps)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const result = out.result as { scans: unknown[]; total: number; returned: number }
    expect(result.total).toBe(42)
    expect(result.returned).toBe(1)
    // The serialized result must not contain encryptedPat anywhere —
    // the Prisma `select` excludes it, but a defense-in-depth assertion
    // catches a future field-leak regression.
    expect(JSON.stringify(result)).not.toContain('encryptedPat')
    expect(JSON.stringify(result)).not.toContain('pat')
  })

  it('forwards a status filter to Prisma as where: { status }', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const count = vi.fn().mockResolvedValue(0)
    const deps = makeDeps({ scan: { findMany, count } as never })
    await invokeTool(scanListTool, { status: 'failed', limit: 10 }, deps)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'failed' } }))
    expect(count).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'failed' } }))
  })

  it('refuses a non-canonical status value', async () => {
    const out = await invokeTool(scanListTool, { status: 'bogus' as never }, makeDeps())
    expect(out.ok).toBe(false)
  })
})

// ── Tool: mendel.scan.get ────────────────────────────────────────────────────

describe('scanGetTool', () => {
  it('returns {ok:false} when the scan is not found (honest, not silent)', async () => {
    const out = await invokeTool(scanGetTool, { id: 'missing' }, makeDeps())
    expect(out.ok).toBe(true) // invokeTool itself succeeded
    if (!out.ok) return
    expect(out.result).toMatchObject({ ok: false, reason: expect.stringMatching(/missing/) })
  })

  it('parses the scan.confidenceSummary JSON blob; returns null on parse failure', async () => {
    const deps = makeDeps({
      scan: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'scan-1',
          repoUrl: 'https://github.com/x/y',
          status: 'completed',
          startedAt: new Date('2026-06-01T10:00:00Z'),
          completedAt: new Date('2026-06-01T10:05:00Z'),
          errorMessage: null,
          language: 'typescript',
          workspaceKind: null,
          confidenceSummary: JSON.stringify({ avg: 78 }),
        }),
      } as never,
      issue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'i1', type: 'stale-dependency', severity: 'major',
            prUrl: 'https://github.com/x/y/pull/1', status: 'pr-opened',
            language: 'typescript', packageDir: '.', autoMerge: null,
          },
        ]),
      } as never,
    })
    const out = await invokeTool(scanGetTool, { id: 'scan-1' }, deps)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const r = out.result as { scan: { confidenceSummary: { avg: number } }; issues: { autoMerge: unknown }[] }
    expect(r.scan.confidenceSummary).toEqual({ avg: 78 })
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0].autoMerge).toBeNull()
  })

  it('surfaces malformed JSON blobs as { __parseError: true } instead of crashing', async () => {
    const deps = makeDeps({
      scan: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'scan-1',
          repoUrl: 'https://github.com/x/y',
          status: 'completed',
          startedAt: new Date(),
          completedAt: null,
          errorMessage: null,
          language: null,
          workspaceKind: null,
          confidenceSummary: 'NOT_JSON',
        }),
      } as never,
      issue: { findMany: vi.fn().mockResolvedValue([]) } as never,
    })
    const out = await invokeTool(scanGetTool, { id: 'scan-1' }, deps)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const r = out.result as { scan: { confidenceSummary: { __parseError?: boolean } } }
    expect(r.scan.confidenceSummary).toMatchObject({ __parseError: true })
  })

  it('refuses an empty id', async () => {
    const out = await invokeTool(scanGetTool, { id: '' }, makeDeps())
    expect(out.ok).toBe(false)
  })

  it('refuses an id over 64 chars (defensive cap)', async () => {
    const out = await invokeTool(scanGetTool, { id: 'x'.repeat(65) }, makeDeps())
    expect(out.ok).toBe(false)
  })
})

// ── Tool: mendel.inspect.list ────────────────────────────────────────────────

describe('inspectionListTool', () => {
  it('forwards a packageName filter as a Prisma where clause', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const count = vi.fn().mockResolvedValue(0)
    const deps = makeDeps({ inspection: { findMany, count } as never })
    await invokeTool(inspectionListTool, { packageName: 'axios', limit: 5 }, deps)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { packageName: 'axios' } }))
  })

  it('returns the documented shape; ISO timestamps; no PII leakage', async () => {
    const deps = makeDeps({
      inspection: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'i1', packageName: 'axios', fromVersion: '0.24.0', toVersion: '1.6.0', createdAt: new Date('2026-06-01T08:00:00Z') },
        ]),
        count: vi.fn().mockResolvedValue(1),
      } as never,
    })
    const out = await invokeTool(inspectionListTool, {}, deps)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const r = out.result as { inspections: { id: string; createdAt: string }[]; total: number }
    expect(r.total).toBe(1)
    expect(r.inspections[0].createdAt).toBe('2026-06-01T08:00:00.000Z')
  })
})
