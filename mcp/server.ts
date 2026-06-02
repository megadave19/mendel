/**
 * v2.3 / F26 sub-phase 1 — Mendel MCP server (stdio).
 *
 * Long-running Node process (`pnpm mcp`) that exposes Mendel's read /
 * action surface to MCP-compatible clients (Claude Code, Cursor, etc.)
 * over the stdio transport. Per CLAUDE.md §11 forbidden patterns: the
 * MCP server is NEVER exposed as an unauthenticated HTTP endpoint —
 * stdio only, by design.
 *
 * **Security boundary (CLAUDE.md §5 r17):**
 *  - Every tool input is Zod-validated through `invokeTool` BEFORE the
 *    handler runs. A malformed call returns a clean error, not a crash.
 *  - PATs / encrypted PATs are NEVER returned in tool results. The
 *    read-only sub-phase 1 tools select narrow scalar fields explicitly
 *    via Prisma `select`; the action tools added in sub-phase 2 will
 *    decrypt PATs in-handler only.
 *  - Policy gates (§5c auto-merge envelope, §5c.1 eligibility) are
 *    enforced by the SAME pure modules the runner uses. A caller CANNOT
 *    bypass §5c via MCP.
 *  - `process.stderr` is the worker's intentional log surface; tool
 *    payloads + diagnostic info pass through `console.error` only (NOT
 *    stdout — stdout is reserved for the MCP JSON-RPC framing).
 */

import type { ZodRawShape } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { db } from '@/lib/db'
import { ALL_TOOLS, type ToolDeps } from '@/lib/mcp/tools'

const SERVER_NAME = 'mendel-mcp'
const SERVER_VERSION = '0.1.0'

// ── Public entry: start the server ──────────────────────────────────────────

export interface StartServerOptions {
  /** Inject a fake McpServer for tests (so we don't depend on the SDK in
   *  every unit run). When omitted the real SDK is used. */
  serverImpl?: McpServer
  /** Tests can inject a deps bundle with a fake Prisma. */
  deps?: ToolDeps
  /** Skip stdio connection — tests don't need a transport. */
  skipTransport?: boolean
  /** ISO timestamp generator override. */
  now?: () => Date
}

export async function startMcpServer(opts: StartServerOptions = {}): Promise<McpServer> {
  const server =
    opts.serverImpl ??
    new McpServer({
      name: SERVER_NAME,
      version: SERVER_VERSION,
    })

  const deps: ToolDeps = opts.deps ?? {
    db,
    now: opts.now ?? (() => new Date()),
  }

  // Register every tool from the pure registry.
  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        // The SDK accepts `ZodRawShape | AnySchema` per its registerTool
        // signature. We pass the schema's raw shape (when the schema is
        // a ZodObject) because that lets the SDK generate per-field
        // JSON-Schema descriptions automatically — better client UX than
        // passing the whole schema object. For non-object schemas
        // `extractRawShape` returns undefined and the SDK falls back to
        // a minimal schema; invokeTool still validates at the boundary.
        inputSchema: extractRawShape(tool.inputSchema),
      },
      async (rawInput: unknown) => {
        const result = await tool.invoke(rawInput, deps)
        if (result.ok) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result.result, null, 2),
              },
            ],
          }
        }
        // Validation or handler failure — return an MCP error result.
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: result.error },
          ],
        }
      },
    )
  }
  log(`registered ${ALL_TOOLS.length} tool(s): ${ALL_TOOLS.map((t) => t.name).join(', ')}`)

  if (!opts.skipTransport) {
    const transport = new StdioServerTransport()
    await server.connect(transport)
    log(`listening on stdio`)
  }

  return server
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the underlying ZodRawShape from a ZodObject so the SDK can
 *  generate a JSON-Schema input descriptor. For non-object schemas we
 *  return undefined; the validation still runs through invokeTool.
 *
 *  Return type is `ZodRawShape | undefined` — matching the SDK's
 *  `ZodRawShapeCompat` shape (a record of Zod types). The runtime
 *  guard checks shape is a function before calling it. */
function extractRawShape(schema: unknown): ZodRawShape | undefined {
  if (!schema || typeof schema !== 'object') return undefined
  const s = schema as { _def?: { shape?: () => ZodRawShape; typeName?: string } }
  if (s._def?.shape && typeof s._def.shape === 'function') {
    try {
      return s._def.shape()
    } catch {
      return undefined
    }
  }
  return undefined
}

/** stderr-only log surface — stdout is reserved for MCP JSON-RPC framing. */
function log(msg: string) {
  // eslint-disable-next-line no-console -- intentional stderr log surface
  console.error(`[mendel-mcp ${new Date().toISOString()}] ${msg}`)
}

// ── CLI entry — `pnpm mcp` runs this when imported as the main module ───────

if (require.main === module) {
  startMcpServer().catch((err) => {
    // eslint-disable-next-line no-console -- top-level error from server
    console.error('[mendel-mcp] failed to start:', err)
    process.exit(1)
  })
}
