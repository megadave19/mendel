/**
 * v2.3 / F26 sub-phase 1 — MCP server wiring tests.
 *
 * The pure tool registry has exhaustive tests in tests/mcp-tools.test.ts.
 * THIS file tests the server wrapper's contract with the MCP SDK:
 *   - Every tool in ALL_TOOLS is registered exactly once
 *   - The registered handler validates input + returns the right
 *     content[] shape on both success AND error (isError:true on fail)
 *   - The wrapper injects the supplied deps (so a fake Prisma flows
 *     through to handlers)
 *   - Transport connection is skippable for tests
 *
 * We use a hand-rolled FakeMcpServer that records every registerTool
 * call and lets us invoke registered handlers directly. This avoids
 * stdio + the real SDK in unit tests; the live `pnpm mcp` smoke is the
 * end-to-end check.
 */

import { describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  // We deliberately do NOT load lib/db (which pulls env validation).
  // The server takes a `deps` override that lets tests inject a fake
  // Prisma — vi.mock('@/lib/db') gives the import path a dummy export.
}))
void mocks

vi.mock('@/lib/db', () => ({ db: {} as Record<string, unknown> }))

import { startMcpServer } from '@/mcp/server'
import { ALL_TOOLS } from '@/lib/mcp/tools'

interface RegisteredEntry {
  name: string
  config: { description?: string; inputSchema?: unknown }
  handler: (rawInput: unknown) => Promise<unknown>
}

class FakeMcpServer {
  registered: RegisteredEntry[] = []
  registerTool(name: string, config: RegisteredEntry['config'], handler: RegisteredEntry['handler']) {
    this.registered.push({ name, config, handler })
  }
  async connect() {
    /* unused — we set skipTransport */
  }
}

function makeFakeDeps() {
  const noop = vi.fn().mockResolvedValue([])
  const zero = vi.fn().mockResolvedValue(0)
  return {
    db: {
      scan: { findMany: noop, count: zero, findUnique: vi.fn().mockResolvedValue(null) },
      issue: { findMany: noop },
      inspection: { findMany: noop, count: zero },
    } as never,
    now: () => new Date('2026-06-01T12:00:00Z'),
  }
}

describe('startMcpServer — registration', () => {
  it('registers every tool in ALL_TOOLS exactly once', async () => {
    const fake = new FakeMcpServer()
    await startMcpServer({
      serverImpl: fake as never,
      deps: makeFakeDeps(),
      skipTransport: true,
    })
    expect(fake.registered).toHaveLength(ALL_TOOLS.length)
    const names = fake.registered.map((r) => r.name).sort()
    expect(names).toEqual(ALL_TOOLS.map((t) => t.name).sort())
  })

  it("attaches a description string to every registered tool (clients render this)", async () => {
    const fake = new FakeMcpServer()
    await startMcpServer({ serverImpl: fake as never, deps: makeFakeDeps(), skipTransport: true })
    for (const r of fake.registered) {
      expect(typeof r.config.description).toBe('string')
      expect((r.config.description as string).length).toBeGreaterThan(20)
    }
  })

  it("attaches an inputSchema raw-shape for ZodObject schemas (clients can prompt the user)", async () => {
    const fake = new FakeMcpServer()
    await startMcpServer({ serverImpl: fake as never, deps: makeFakeDeps(), skipTransport: true })
    // Every sub-phase 1 tool uses a ZodObject — so inputSchema must be
    // a defined object (not undefined). Defensive check: if the SDK
    // version ever drops support for raw-shape, this fails loudly.
    for (const r of fake.registered) {
      expect(r.config.inputSchema).toBeDefined()
      expect(typeof r.config.inputSchema).toBe('object')
    }
  })
})

describe('startMcpServer — handler wiring', () => {
  it('happy path: returns { content: [{type:"text", text:"<json>"}] } when invokeTool succeeds', async () => {
    const fake = new FakeMcpServer()
    await startMcpServer({
      serverImpl: fake as never,
      deps: makeFakeDeps(),
      skipTransport: true,
    })
    const health = fake.registered.find((r) => r.name === 'mendel.health')!
    const out = (await health.handler({})) as { content: { type: string; text: string }[] }
    expect(out.content).toHaveLength(1)
    expect(out.content[0].type).toBe('text')
    const parsed = JSON.parse(out.content[0].text) as { ok: boolean; server: string }
    expect(parsed.ok).toBe(true)
    expect(parsed.server).toBe('mendel-mcp')
  })

  it('error path: returns { isError: true, content:[{type:"text", text:<reason>}] } on bad input', async () => {
    const fake = new FakeMcpServer()
    await startMcpServer({
      serverImpl: fake as never,
      deps: makeFakeDeps(),
      skipTransport: true,
    })
    const list = fake.registered.find((r) => r.name === 'mendel.scan.list')!
    const out = (await list.handler({ limit: 9999 })) as {
      isError: true
      content: { type: string; text: string }[]
    }
    expect(out.isError).toBe(true)
    expect(out.content[0].text).toMatch(/limit/)
  })

  it('error path: deps are injected — handler errors carry the deps fingerprint', async () => {
    // Inject a Prisma whose scan.findMany rejects; the resulting error
    // must surface in the handler's error result rather than throw to
    // the SDK (which would otherwise drop the diagnostic).
    const fake = new FakeMcpServer()
    const failingDeps = {
      db: {
        scan: {
          findMany: vi.fn().mockRejectedValue(new Error('db boom')),
          count: vi.fn().mockResolvedValue(0),
          findUnique: vi.fn().mockResolvedValue(null),
        },
        issue: { findMany: vi.fn() },
        inspection: { findMany: vi.fn(), count: vi.fn() },
      } as never,
      now: () => new Date('2026-06-01T12:00:00Z'),
    }
    await startMcpServer({ serverImpl: fake as never, deps: failingDeps, skipTransport: true })
    const list = fake.registered.find((r) => r.name === 'mendel.scan.list')!
    const out = (await list.handler({})) as { isError?: boolean; content: { text: string }[] }
    expect(out.isError).toBe(true)
    expect(out.content[0].text).toMatch(/db boom/)
  })
})
