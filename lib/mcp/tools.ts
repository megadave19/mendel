/**
 * v2.3 / F26 sub-phase 1 — MCP tool registry (pure).
 *
 * Each tool is a self-contained record with a Zod input schema + a
 * handler that takes parsed input + a `Deps` bundle and returns a
 * JSON-serializable result. NO direct DB or network IO at construction
 * time — the handler closes over `deps`, which the server wrapper
 * supplies (real Prisma at runtime; fakes in tests).
 *
 * **Security boundary (CLAUDE.md §5 r17):**
 *  - Every tool's input is Zod-validated AT THE TOOL BOUNDARY before
 *    the handler runs. A malformed call gets a clean error, not a crash.
 *  - PATs are NEVER returned. Sub-phase 1 ships only read-only tools
 *    that don't touch PATs; sub-phase 2 will add action tools where the
 *    PAT travels through the same encrypted-at-rest discipline (decrypt
 *    in-handler, never log, never return).
 *  - Policy gates (§5c auto-merge envelope, §5c.1 eligibility) are
 *    enforced by the SAME pure modules the runner uses. Sub-phase 2
 *    will route action tools through those gates — a caller CANNOT
 *    bypass §5c via MCP. The §11 forbidden pattern "exposing MCP as
 *    HTTP" is honored by the stdio-only transport in mcp/server.ts.
 *
 * **Honesty:**
 *  - Tool responses never silently truncate. List endpoints carry a
 *    `total` field so the client can detect pagination overflow.
 *  - On unrecoverable errors, the handler returns `{ ok: false, reason }`
 *    rather than throwing — McpServer would otherwise convert a throw
 *    into a generic error and drop the diagnostic.
 */

import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import { runScan } from '@/lib/agent/runner'
import { encrypt } from '@/lib/crypto'
import { inspectApi } from '@/lib/agent/inspect'

// ── Dep bundle injected by the server wrapper ───────────────────────────────

/**
 * Minimum Prisma surface the registry touches. Sub-phase 2 widens the
 * read-only set to cover monitorSchedule (read-only) and adds scan.create
 * for the new scan.start tool. Tests pass a fake.
 */
export type McpPrisma = Pick<PrismaClient, 'scan' | 'issue' | 'inspection' | 'monitorSchedule'>

/** IO seams the action tools touch. Injectable so tests can replace
 *  them with fakes (no real runScan, no real inspectApi, no real
 *  crypto/env). The signatures mirror the runtime imports. */
export interface ToolIo {
  runScan: typeof runScan
  inspectApi: typeof inspectApi
  encrypt: typeof encrypt
}

export interface ToolDeps {
  db: McpPrisma
  /** ISO timestamp generator — injectable for deterministic tests. */
  now: () => Date
  /** Action IO — defaults to the real imports at runtime; tests inject fakes. */
  io?: ToolIo
}

/** Default IO bundle — used when ToolDeps.io is omitted. Server uses
 *  this at runtime; tests pass their own fakes via ToolDeps.io. */
export const defaultToolIo: ToolIo = {
  runScan,
  inspectApi,
  encrypt,
}

// ── Tool type ───────────────────────────────────────────────────────────────

/** A registered tool. The handler returns a JSON-serializable result;
 *  the server wrapper marshals it into the MCP `CallToolResult` shape. */
export interface ToolRecord<I> {
  name: string
  description: string
  inputSchema: z.ZodType<I>
  handler: (input: I, deps: ToolDeps) => Promise<unknown>
}

/** Build a typed `ToolRecord` while preserving the schema's inferred type. */
export function defineTool<S extends z.ZodType>(
  spec: Omit<ToolRecord<z.infer<S>>, 'inputSchema'> & { inputSchema: S },
): ToolRecord<z.infer<S>> {
  return spec
}

// ── Tool: mendel.health ─────────────────────────────────────────────────────

const HealthInput = z.object({}).strict()

export const healthTool = defineTool({
  name: 'mendel.health',
  description:
    'Lightweight health check. Returns server time + a static "ok" so an MCP client can confirm the server is reachable and running. No DB access; safest possible tool to run first.',
  inputSchema: HealthInput,
  handler: async (_input, deps) => ({
    ok: true,
    server: 'mendel-mcp',
    serverTime: deps.now().toISOString(),
  }),
})

// ── Tool: mendel.scan.list ──────────────────────────────────────────────────

const ScanListInput = z
  .object({
    /** Page size — capped at 50. Default 10. */
    limit: z.number().int().min(1).max(50).default(10),
    /** Optional status filter — when supplied, only matching scans. */
    status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
  })
  .strict()

export const scanListTool = defineTool({
  name: 'mendel.scan.list',
  description:
    'List recent scans, newest first. Returns id, repoUrl, status, startedAt, completedAt, and a brief issue count. PAT and encryptedPat fields are NEVER included.',
  inputSchema: ScanListInput,
  handler: async (input, deps) => {
    const where = input.status ? { status: input.status } : {}
    const [rows, total] = await Promise.all([
      deps.db.scan.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          repoUrl: true,
          status: true,
          startedAt: true,
          completedAt: true,
          errorMessage: true,
          language: true,
          workspaceKind: true,
        },
      }),
      deps.db.scan.count({ where }),
    ])
    return {
      scans: rows.map((s) => ({
        id: s.id,
        repoUrl: s.repoUrl,
        status: s.status,
        startedAt: s.startedAt?.toISOString() ?? null,
        completedAt: s.completedAt?.toISOString() ?? null,
        errorMessage: s.errorMessage ?? null,
        language: s.language ?? null,
        workspaceKind: s.workspaceKind ?? null,
      })),
      total,
      returned: rows.length,
    }
  },
})

// ── Tool: mendel.scan.get ────────────────────────────────────────────────────

const ScanGetInput = z.object({
  id: z.string().min(1).max(64),
}).strict()

export const scanGetTool = defineTool({
  name: 'mendel.scan.get',
  description:
    'Fetch a single scan by id, plus a summary of its issues (id, depName, severity, prUrl, status). The full diagnosis/patch/verification blobs are NOT returned — the client can call mendel.issue.get (sub-phase 2) for that. PAT fields are NEVER included.',
  inputSchema: ScanGetInput,
  handler: async (input, deps) => {
    const scan = await deps.db.scan.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        repoUrl: true,
        status: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
        language: true,
        workspaceKind: true,
        confidenceSummary: true,
      },
    })
    if (!scan) {
      return { ok: false, reason: `scan ${input.id} not found` }
    }
    const issues = await deps.db.issue.findMany({
      where: { scanId: input.id },
      select: {
        id: true,
        type: true,
        severity: true,
        prUrl: true,
        status: true,
        language: true,
        packageDir: true,
        autoMerge: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    return {
      scan: {
        id: scan.id,
        repoUrl: scan.repoUrl,
        status: scan.status,
        startedAt: scan.startedAt?.toISOString() ?? null,
        completedAt: scan.completedAt?.toISOString() ?? null,
        errorMessage: scan.errorMessage ?? null,
        language: scan.language ?? null,
        workspaceKind: scan.workspaceKind ?? null,
        confidenceSummary: safeParse(scan.confidenceSummary),
      },
      issues: issues.map((i) => ({
        id: i.id,
        type: i.type,
        severity: i.severity,
        prUrl: i.prUrl ?? null,
        status: i.status,
        language: i.language ?? null,
        packageDir: i.packageDir ?? null,
        autoMerge: safeParse(i.autoMerge),
      })),
    }
  },
})

// ── Tool: mendel.inspect.list ───────────────────────────────────────────────

const InspectionListInput = z
  .object({
    limit: z.number().int().min(1).max(50).default(10),
    packageName: z.string().min(1).max(200).optional(),
  })
  .strict()

export const inspectionListTool = defineTool({
  name: 'mendel.inspect.list',
  description:
    'List recent F22 inspection reports (newest first). Optional packageName filter. Returns id, packageName, fromVersion, toVersion, createdAt — call mendel.inspect.get (sub-phase 2) for the full report blob.',
  inputSchema: InspectionListInput,
  handler: async (input, deps) => {
    const where = input.packageName ? { packageName: input.packageName } : {}
    const [rows, total] = await Promise.all([
      deps.db.inspection.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: { id: true, packageName: true, fromVersion: true, toVersion: true, createdAt: true },
      }),
      deps.db.inspection.count({ where }),
    ])
    return {
      inspections: rows.map((r) => ({
        id: r.id,
        packageName: r.packageName,
        fromVersion: r.fromVersion,
        toVersion: r.toVersion,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      returned: rows.length,
    }
  },
})

// ── Tool: mendel.scan.start (ACTION) ─────────────────────────────────────────
//
// Start a headless scan from an MCP client. Mirrors POST /api/scans:
//   1. Validate inputs (Zod)
//   2. Encrypt PAT (AES-256-GCM via @/lib/crypto)
//   3. Insert Scan row with status='queued'
//   4. Fire-and-forget runScan in the background
//   5. Return { scanId } immediately
//
// Security:
//   - The plaintext PAT enters in `input.pat` and is encrypted IMMEDIATELY
//     before any persistence. The response NEVER includes the PAT.
//   - The runner's eligibility gate (§5c.1) runs unchanged inside runScan
//     — a caller cannot bypass it via MCP because runScan is the same
//     function the UI calls.
//   - Per CLAUDE.md §5 r17: validation at the boundary; the encrypted PAT
//     is the only PAT-shaped value that ever lives in the DB.

const ScanStartInput = z.object({
  repoUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://github.com/'), 'repoUrl must be an https://github.com/ URL'),
  pat: z.string().min(1).max(200),
  /** Optional confidence threshold override per scan (40–100). */
  confidenceThreshold: z.number().int().min(40).max(100).optional(),
  /** v2.0 / F20 — opt-in Phase C smoke test. */
  smokeTest: z.boolean().optional(),
  /** §5c.1 — acknowledge external-contribution norms. Default false. */
  externalContributionAck: z.boolean().optional(),
}).strict()

export const scanStartTool = defineTool({
  name: 'mendel.scan.start',
  description:
    'Start a headless scan of a GitHub repo. The PAT is encrypted at rest immediately; never logged, never returned. The runner runs eligibility (§5c.1) + verification gates internally — a caller cannot bypass them via MCP. Returns { scanId } immediately; the scan runs in the background.',
  inputSchema: ScanStartInput,
  handler: async (input, deps) => {
    const io = deps.io ?? defaultToolIo
    const encryptedPat = io.encrypt(input.pat)

    const created = await deps.db.scan.create({
      data: {
        repoUrl: input.repoUrl,
        status: 'queued',
        schemaVersion: '1.0',
        encryptedPat,
        smokeRequested: input.smokeTest ?? false,
      },
    })

    // Fire-and-forget. The runner re-decrypts the PAT internally for
    // every per-dep API call; we keep the in-memory plaintext alive for
    // this request only because runScan also accepts it directly (same
    // contract POST /api/scans uses).
    void io
      .runScan(created.id, input.repoUrl, input.pat, {
        confidenceThreshold: input.confidenceThreshold,
        smokeTest: input.smokeTest,
        externalContributionAck: input.externalContributionAck,
      })
      .catch(() => {
        // Runner errors are persisted to scan.errorMessage by the
        // runner itself. We deliberately swallow here so the
        // fire-and-forget doesn't surface a noisy unhandled-rejection.
      })

    return {
      ok: true,
      scanId: created.id,
      status: 'queued',
      repoUrl: created.repoUrl,
      startedAt: created.startedAt?.toISOString() ?? null,
    }
  },
})

// ── Tool: mendel.inspect.run (ACTION) ────────────────────────────────────────
//
// Calls the F22 inspect orchestrator. F22 is purely analytical (no
// repo, no PR, no sandbox); the structural cap (`applyInspectStructuralCap`)
// inside inspectApi forces the bucket ≤ 'medium' so this can never produce
// a 'high' confidence — matching the UI's contract.

const InspectRunInput = z.object({
  packageName: z.string().min(1).max(200),
  fromVersion: z.string().min(1).max(64),
  toVersion: z.string().min(1).max(64),
  /** Optional PAT for the changelog signal. The plaintext is forwarded
   *  to inspectApi and immediately consumed by GitHub API calls; never
   *  persisted, never returned. */
  pat: z.string().min(1).max(200).optional(),
}).strict()

export const inspectRunTool = defineTool({
  name: 'mendel.inspect.run',
  description:
    'Run an F22 inspection on a package version pair (no repo clone, no sandbox, no PR). Returns a calibrated ApiReport with the structural cap applied (bucket ≤ medium — inspect mode can never reach high). PAT is optional and never persisted.',
  inputSchema: InspectRunInput,
  handler: async (input, deps) => {
    const io = deps.io ?? defaultToolIo
    const report = await io.inspectApi({
      packageName: input.packageName,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      pat: input.pat,
    })
    return { ok: true, report }
  },
})

// ── Tool: mendel.automerge.get-verdict (READ honesty surface) ───────────────
//
// Returns the persisted §5c verdict for an issue. This is the LLM-facing
// honesty surface that closes the §5c loop: every NO reason logged at
// scan time is readable here, so a client can show the user EXACTLY why
// auto-merge fired or skipped.

const AutoMergeGetVerdictInput = z.object({
  issueId: z.string().min(1).max(64),
}).strict()

export const autoMergeGetVerdictTool = defineTool({
  name: 'mendel.automerge.get-verdict',
  description:
    'Read the persisted §5c auto-merge verdict for an issue (verdict: merged/skipped/failed/cancelled; full reasons array). Returns null when the gate did not run for this issue (e.g., no PR was opened). Pure read; never fires a merge.',
  inputSchema: AutoMergeGetVerdictInput,
  handler: async (input, deps) => {
    const issue = await deps.db.issue.findUnique({
      where: { id: input.issueId },
      select: {
        id: true,
        scanId: true,
        prUrl: true,
        autoMerge: true,
      },
    })
    if (!issue) {
      return { ok: false, reason: `issue ${input.issueId} not found` }
    }
    if (!issue.autoMerge) {
      return {
        ok: true,
        issueId: issue.id,
        scanId: issue.scanId,
        prUrl: issue.prUrl ?? null,
        verdict: null,
        note: 'auto-merge gate did not run for this issue (no PR opened, or scan predates F24)',
      }
    }
    const parsed = (() => {
      try {
        return JSON.parse(issue.autoMerge) as Record<string, unknown>
      } catch {
        return { __parseError: true, raw: (issue.autoMerge ?? '').slice(0, 200) }
      }
    })()
    return {
      ok: true,
      issueId: issue.id,
      scanId: issue.scanId,
      prUrl: issue.prUrl ?? null,
      verdict: parsed,
    }
  },
})

// ── Tool: mendel.monitor.list (READ — F25 surface) ──────────────────────────
//
// Lists every MonitorSchedule row. CRITICAL: encryptedPat is NEVER
// returned — the same hasPat:boolean contract the REST endpoint uses.

const MonitorListInput = z
  .object({
    /** Optional filter: only enabled rows. */
    enabledOnly: z.boolean().default(false),
  })
  .strict()

export const monitorListTool = defineTool({
  name: 'mendel.monitor.list',
  description:
    'List all F25 monitor schedules. The encryptedPat is NEVER included — only `hasPat: boolean` (matches the REST endpoint contract). Optional enabledOnly filter for active schedules.',
  inputSchema: MonitorListInput,
  handler: async (input, deps) => {
    const where = input.enabledOnly ? { enabled: true } : {}
    const rows = await deps.db.monitorSchedule.findMany({
      where,
      select: {
        id: true,
        repoFullName: true,
        repoUrl: true,
        cronExpression: true,
        enabled: true,
        encryptedPat: true, // selected here ONLY so we can compute hasPat; never returned
        lastFiredAt: true,
        lastErrorAt: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    })
    return {
      schedules: rows.map((r) => ({
        id: r.id,
        repoFullName: r.repoFullName,
        repoUrl: r.repoUrl,
        cronExpression: r.cronExpression,
        enabled: r.enabled,
        hasPat: Boolean(r.encryptedPat),
        lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
        lastErrorAt: r.lastErrorAt?.toISOString() ?? null,
        lastError: r.lastError ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      total: rows.length,
    }
  },
})

// ── The registry ────────────────────────────────────────────────────────────

/** Erased-input ToolRecord — handler input is checked at runtime via the
 *  Zod schema, so the static type can be widened to satisfy the
 *  contravariance constraint when storing heterogeneous tools in a list. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolRecord<any>

/** The frozen list of all tools the MCP server exposes. */
export const ALL_TOOLS: ReadonlyArray<AnyTool> = Object.freeze([
  // Read-only (sub-phase 1)
  healthTool,
  scanListTool,
  scanGetTool,
  inspectionListTool,
  // Read + Action (sub-phase 2)
  scanStartTool,
  inspectRunTool,
  autoMergeGetVerdictTool,
  monitorListTool,
])

// ── Helpers ─────────────────────────────────────────────────────────────────

function safeParse(raw: string | null | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return { __parseError: true, raw: raw.slice(0, 200) }
  }
}

/** Validate input through a tool's schema, then invoke its handler. The
 *  server wrapper uses this; tests use it to verify routing + validation
 *  without the SDK in the loop. Returns `{ ok: false, error }` on
 *  validation failure so the server can map it to a clean MCP error.
 *
 *  Accepts any tool type (`AnyTool`) because handlers are heterogeneous —
 *  runtime safety comes from `tool.inputSchema.safeParse` below. */
export async function invokeTool(
  tool: AnyTool,
  rawInput: unknown,
  deps: ToolDeps,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const parsed = tool.inputSchema.safeParse(rawInput ?? {})
  if (!parsed.success) {
    return {
      ok: false,
      error: `input validation failed for ${tool.name}: ${parsed.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')}`,
    }
  }
  try {
    const result = await tool.handler(parsed.data, deps)
    return { ok: true, result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
