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

// The action tools import @/lib/agent/runner + @/lib/crypto + @/lib/agent/inspect
// at module-load time, which pull in env validation. Mock those edges
// here so the tests are deterministic without ENCRYPTION_KEY etc.
vi.mock('@/lib/agent/runner', () => ({ runScan: vi.fn() }))
vi.mock('@/lib/crypto', () => ({ encrypt: (s: string) => `enc:${s}` }))
vi.mock('@/lib/agent/inspect', () => ({ inspectApi: vi.fn() }))

import {
  ALL_TOOLS,
  invokeTool,
  defineTool,
  healthTool,
  scanListTool,
  scanGetTool,
  inspectionListTool,
  scanStartTool,
  inspectRunTool,
  autoMergeGetVerdictTool,
  monitorListTool,
  type ToolDeps,
  type McpPrisma,
  type ToolIo,
} from '@/lib/mcp/tools'
import { z } from 'zod'

// ── Fake deps ────────────────────────────────────────────────────────────────

function makeDeps(prismaOverrides: Partial<McpPrisma> = {}, ioOverrides: Partial<ToolIo> = {}): ToolDeps {
  const baseScan = {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({
      id: 'scan-created-1',
      repoUrl: 'https://github.com/x/y',
      startedAt: new Date('2026-06-01T12:00:00Z'),
    }),
  }
  const baseIssue = {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
  }
  const baseInspection = {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  }
  const baseMonitorSchedule = {
    findMany: vi.fn().mockResolvedValue([]),
  }
  // Default IO: real-shaped but no-op. Override per-test.
  const io: ToolIo = {
    runScan: vi.fn().mockResolvedValue(undefined) as unknown as ToolIo['runScan'],
    inspectApi: vi.fn().mockResolvedValue({ confidence: { bucket: 'medium' } }) as unknown as ToolIo['inspectApi'],
    encrypt: ((s: string) => `enc:${s}`) as ToolIo['encrypt'],
    ...ioOverrides,
  }
  return {
    db: {
      scan: { ...baseScan, ...(prismaOverrides.scan as object) },
      issue: { ...baseIssue, ...(prismaOverrides.issue as object) },
      inspection: { ...baseInspection, ...(prismaOverrides.inspection as object) },
      monitorSchedule: { ...baseMonitorSchedule, ...(prismaOverrides.monitorSchedule as object) },
    } as unknown as McpPrisma,
    now: () => new Date('2026-06-01T12:00:00Z'),
    io,
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

  it('exposes the full v2.3 tool set (sub-phase 1 read-only + sub-phase 2 action)', () => {
    const expected = [
      // sub-phase 1 (read-only)
      'mendel.health',
      'mendel.scan.list',
      'mendel.scan.get',
      'mendel.inspect.list',
      // sub-phase 2 (action + read honesty surfaces)
      'mendel.scan.start',
      'mendel.inspect.run',
      'mendel.automerge.get-verdict',
      'mendel.monitor.list',
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
    // After the v2.2.x refactor the handler is closed inside `invoke`,
    // so we construct a throwing tool via defineTool rather than
    // spreading + overriding a field that no longer exists on the
    // public RegisteredTool shape.
    const throwingTool = defineTool({
      name: 'mendel.throws',
      description: 'throws to verify the catch-bubble contract — not registered',
      inputSchema: z.object({}).strict(),
      handler: async () => {
        throw new Error('boom')
      },
    })
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

// ── Tool: mendel.scan.start (ACTION) ─────────────────────────────────────────

describe('scanStartTool', () => {
  it('encrypts the PAT BEFORE persisting; never returns plaintext or ciphertext', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'scan-1',
      repoUrl: 'https://github.com/x/y',
      startedAt: new Date('2026-06-01T12:00:00Z'),
    })
    const encryptSpy = vi.fn((s: string) => `enc:${s}`)
    const runScanSpy = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps(
      { scan: { create } as never },
      { encrypt: encryptSpy as ToolIo['encrypt'], runScan: runScanSpy as unknown as ToolIo['runScan'] },
    )
    const out = await invokeTool(
      scanStartTool,
      { repoUrl: 'https://github.com/x/y', pat: 'plaintext-pat-value' },
      deps,
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return

    // 1. PAT encrypted exactly once, with the supplied plaintext.
    expect(encryptSpy).toHaveBeenCalledTimes(1)
    expect(encryptSpy).toHaveBeenCalledWith('plaintext-pat-value')

    // 2. The persisted Scan.encryptedPat is the ciphertext, not the plaintext.
    const persistedData = create.mock.calls[0][0].data as Record<string, unknown>
    expect(persistedData.encryptedPat).toBe('enc:plaintext-pat-value')
    expect(persistedData.encryptedPat).not.toBe('plaintext-pat-value')

    // 3. Response NEVER contains the plaintext OR ciphertext.
    const serialised = JSON.stringify(out.result)
    expect(serialised).not.toContain('plaintext-pat-value')
    expect(serialised).not.toContain('enc:plaintext-pat-value')
    expect(serialised).not.toContain('encryptedPat')

    // 4. Response shape pin.
    expect(out.result).toMatchObject({
      ok: true,
      scanId: 'scan-1',
      status: 'queued',
      repoUrl: 'https://github.com/x/y',
    })
  })

  it('fires runScan in the background with the plaintext PAT (matches POST /api/scans contract)', async () => {
    const runScanSpy = vi.fn().mockResolvedValue(undefined)
    const deps = makeDeps({}, { runScan: runScanSpy as unknown as ToolIo['runScan'] })
    await invokeTool(
      scanStartTool,
      {
        repoUrl: 'https://github.com/x/y',
        pat: 'p',
        confidenceThreshold: 80,
        smokeTest: true,
        externalContributionAck: true,
      },
      deps,
    )
    expect(runScanSpy).toHaveBeenCalledTimes(1)
    const args = runScanSpy.mock.calls[0]
    expect(args[1]).toBe('https://github.com/x/y')
    expect(args[2]).toBe('p')
    expect(args[3]).toEqual({
      confidenceThreshold: 80,
      smokeTest: true,
      externalContributionAck: true,
    })
  })

  it("swallows runScan errors at the fire-and-forget boundary (no unhandled rejection)", async () => {
    const runScanSpy = vi.fn().mockRejectedValue(new Error('runner exploded'))
    const deps = makeDeps({}, { runScan: runScanSpy as unknown as ToolIo['runScan'] })
    // The tool returns ok:true the moment Scan row is persisted; the
    // runner error is the runner's responsibility to persist to
    // scan.errorMessage. This is the same shape POST /api/scans uses.
    const out = await invokeTool(
      scanStartTool,
      { repoUrl: 'https://github.com/x/y', pat: 'p' },
      deps,
    )
    expect(out.ok).toBe(true)
  })

  it('refuses a non-https/github.com repoUrl', async () => {
    const out = await invokeTool(
      scanStartTool,
      { repoUrl: 'https://gitlab.com/x/y', pat: 'p' },
      makeDeps(),
    )
    expect(out.ok).toBe(false)
  })

  it('refuses a PAT under 1 char or over 200 chars (defensive)', async () => {
    expect(
      (await invokeTool(scanStartTool, { repoUrl: 'https://github.com/x/y', pat: '' }, makeDeps())).ok,
    ).toBe(false)
    expect(
      (await invokeTool(
        scanStartTool,
        { repoUrl: 'https://github.com/x/y', pat: 'x'.repeat(201) },
        makeDeps(),
      )).ok,
    ).toBe(false)
  })

  it('refuses confidenceThreshold outside [40,100]', async () => {
    expect(
      (await invokeTool(
        scanStartTool,
        { repoUrl: 'https://github.com/x/y', pat: 'p', confidenceThreshold: 20 },
        makeDeps(),
      )).ok,
    ).toBe(false)
    expect(
      (await invokeTool(
        scanStartTool,
        { repoUrl: 'https://github.com/x/y', pat: 'p', confidenceThreshold: 150 },
        makeDeps(),
      )).ok,
    ).toBe(false)
  })
})

// ── Tool: mendel.inspect.run (ACTION) ────────────────────────────────────────

describe('inspectRunTool', () => {
  it('forwards inputs to inspectApi + returns its report', async () => {
    const inspectApiSpy = vi.fn().mockResolvedValue({
      packageName: 'axios',
      fromVersion: '0.24.0',
      toVersion: '1.6.0',
      confidence: { bucket: 'medium', overall: 65 },
      structuralCap: 'medium-ceiling-no-verify',
    })
    const deps = makeDeps({}, { inspectApi: inspectApiSpy as unknown as ToolIo['inspectApi'] })
    const out = await invokeTool(
      inspectRunTool,
      { packageName: 'axios', fromVersion: '0.24.0', toVersion: '1.6.0', pat: 'p' },
      deps,
    )
    expect(out.ok).toBe(true)
    expect(inspectApiSpy).toHaveBeenCalledWith({
      packageName: 'axios',
      fromVersion: '0.24.0',
      toVersion: '1.6.0',
      pat: 'p',
    })
    if (!out.ok) return
    const r = out.result as { ok: boolean; report: { confidence: { bucket: string } } }
    expect(r.ok).toBe(true)
    expect(r.report.confidence.bucket).toBe('medium')
  })

  it('does not require a PAT (anon path)', async () => {
    const inspectApiSpy = vi.fn().mockResolvedValue({ confidence: { bucket: 'medium' } })
    const deps = makeDeps({}, { inspectApi: inspectApiSpy as unknown as ToolIo['inspectApi'] })
    const out = await invokeTool(
      inspectRunTool,
      { packageName: 'axios', fromVersion: '1.0.0', toVersion: '2.0.0' },
      deps,
    )
    expect(out.ok).toBe(true)
    expect(inspectApiSpy).toHaveBeenCalledWith({
      packageName: 'axios',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      pat: undefined,
    })
  })

  it("does not persist or echo the PAT (response never carries it)", async () => {
    const inspectApiSpy = vi.fn().mockResolvedValue({ confidence: { bucket: 'medium' } })
    const deps = makeDeps({}, { inspectApi: inspectApiSpy as unknown as ToolIo['inspectApi'] })
    const out = await invokeTool(
      inspectRunTool,
      { packageName: 'axios', fromVersion: '1.0.0', toVersion: '2.0.0', pat: 'super-secret' },
      deps,
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(JSON.stringify(out.result)).not.toContain('super-secret')
  })

  it('refuses empty packageName / versions', async () => {
    expect((await invokeTool(inspectRunTool, { packageName: '', fromVersion: '1', toVersion: '2' }, makeDeps())).ok).toBe(false)
    expect((await invokeTool(inspectRunTool, { packageName: 'x', fromVersion: '', toVersion: '2' }, makeDeps())).ok).toBe(false)
  })
})

// ── Tool: mendel.automerge.get-verdict (READ honesty surface) ───────────────

describe('autoMergeGetVerdictTool', () => {
  it('returns {ok:false, reason} when the issue id is missing (no silent null)', async () => {
    const out = await invokeTool(autoMergeGetVerdictTool, { issueId: 'missing' }, makeDeps())
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result).toMatchObject({ ok: false, reason: expect.stringMatching(/missing/) })
  })

  it("returns verdict:null with an honest note when the gate did not run (legacy / no PR)", async () => {
    const deps = makeDeps({
      issue: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'i1',
          scanId: 'scan-1',
          prUrl: null,
          autoMerge: null,
        }),
      } as never,
    })
    const out = await invokeTool(autoMergeGetVerdictTool, { issueId: 'i1' }, deps)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const r = out.result as { ok: boolean; verdict: unknown; note?: string }
    expect(r.ok).toBe(true)
    expect(r.verdict).toBeNull()
    expect(r.note).toMatch(/gate did not run/i)
  })

  it('returns the persisted verdict JSON parsed into an object (every §5c reason readable)', async () => {
    const persistedVerdict = {
      verdict: 'skipped',
      reasons: [
        '§5c r1: auto-merge not enabled for this repo (default OFF)',
        '§5c r3: confidence 72/100 below effective floor 90',
      ],
    }
    const deps = makeDeps({
      issue: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'i1',
          scanId: 'scan-1',
          prUrl: 'https://github.com/x/y/pull/1',
          autoMerge: JSON.stringify(persistedVerdict),
        }),
      } as never,
    })
    const out = await invokeTool(autoMergeGetVerdictTool, { issueId: 'i1' }, deps)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const r = out.result as { verdict: { verdict: string; reasons: string[] } }
    expect(r.verdict.verdict).toBe('skipped')
    expect(r.verdict.reasons).toHaveLength(2)
    expect(r.verdict.reasons[0]).toMatch(/§5c r1/)
  })

  it('surfaces a malformed verdict blob as {__parseError:true} instead of crashing', async () => {
    const deps = makeDeps({
      issue: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'i1',
          scanId: 'scan-1',
          prUrl: null,
          autoMerge: 'NOT_JSON',
        }),
      } as never,
    })
    const out = await invokeTool(autoMergeGetVerdictTool, { issueId: 'i1' }, deps)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const r = out.result as { verdict: { __parseError?: boolean } }
    expect(r.verdict.__parseError).toBe(true)
  })
})

// ── Tool: mendel.monitor.list (READ — F25 surface) ──────────────────────────

describe('monitorListTool', () => {
  it("returns schedules with hasPat:boolean — encryptedPat NEVER in the response", async () => {
    const deps = makeDeps({
      monitorSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 's1',
            repoFullName: 'alice/r',
            repoUrl: 'https://github.com/alice/r',
            cronExpression: '0 */6 * * *',
            enabled: true,
            encryptedPat: 'enc:secret-pat-DO-NOT-LEAK',
            lastFiredAt: new Date('2026-06-01T10:00:00Z'),
            lastErrorAt: null,
            lastError: null,
            createdAt: new Date('2026-06-01T08:00:00Z'),
            updatedAt: new Date('2026-06-01T10:00:00Z'),
          },
        ]),
      } as never,
    })
    const out = await invokeTool(monitorListTool, {}, deps)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const r = out.result as { schedules: { hasPat: boolean }[]; total: number }
    expect(r.total).toBe(1)
    expect(r.schedules[0].hasPat).toBe(true)
    // Defense-in-depth: a stringify check for the literal ciphertext +
    // the field name. A future refactor that accidentally spreads the
    // Prisma row into the response would fail loudly here.
    const serialised = JSON.stringify(out.result)
    expect(serialised).not.toContain('enc:secret-pat-DO-NOT-LEAK')
    expect(serialised).not.toContain('encryptedPat')
  })

  it("hasPat:false when encryptedPat is empty (no row has empty ciphertext today, but defensive)", async () => {
    const deps = makeDeps({
      monitorSchedule: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 's1',
            repoFullName: 'alice/r',
            repoUrl: 'https://github.com/alice/r',
            cronExpression: '0 */6 * * *',
            enabled: false,
            encryptedPat: '',
            lastFiredAt: null,
            lastErrorAt: null,
            lastError: null,
            createdAt: new Date('2026-06-01T08:00:00Z'),
            updatedAt: new Date('2026-06-01T08:00:00Z'),
          },
        ]),
      } as never,
    })
    const out = await invokeTool(monitorListTool, {}, deps)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const r = out.result as { schedules: { hasPat: boolean }[] }
    expect(r.schedules[0].hasPat).toBe(false)
  })

  it('forwards enabledOnly:true as where:{enabled:true}', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const deps = makeDeps({ monitorSchedule: { findMany } as never })
    await invokeTool(monitorListTool, { enabledOnly: true }, deps)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true } }))
  })

  it('defaults to listing all rows when enabledOnly is omitted (where:{} is honest)', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const deps = makeDeps({ monitorSchedule: { findMany } as never })
    await invokeTool(monitorListTool, {}, deps)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
  })
})
