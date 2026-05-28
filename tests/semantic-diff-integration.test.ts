/**
 * End-to-end integration test for v1.5 Workstream #1.
 *
 * Covers the path the unit + round-trip tests can't:
 *   1. Call REAL `parseSemanticDiff` against a REAL npm version pair
 *   2. Feed the result into `persistIssueData` with realistic neighbour inputs
 *   3. Insert into the REAL Prisma DB
 *   4. Read it back via the same query the API uses
 *   5. Round-trip via `dbIssueToVM` and assert the semantic-diff fields survive
 *   6. Clean up the test rows so dev.db isn't polluted
 *
 * Gated by SEMDIFF_LIVE=1 so it doesn't run on every `pnpm test` (it hits
 * the network and touches the DB). Run via:
 *   SEMDIFF_LIVE=1 pnpm test semantic-diff-integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const ENABLE = process.env.SEMDIFF_LIVE === '1'

describe.skipIf(!ENABLE)('semantic-diff integration — runner → DB → readback', () => {
  let createdScanId: string | undefined
  let createdIssueId: string | undefined

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-key-32-chars-exactly-padded!'
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
  })

  afterAll(async () => {
    if (!createdScanId) return
    const { db } = await import('@/lib/db')
    // Clean up — delete issues first, then scan (FK).
    if (createdIssueId) await db.issue.delete({ where: { id: createdIssueId } }).catch(() => {})
    await db.scan.delete({ where: { id: createdScanId } }).catch(() => {})
  })

  it('parseSemanticDiff → persistIssueData → db.issue.create → readback round-trips the semanticDiff column', async () => {
    const { parseSemanticDiff } = await import('@/lib/agent/signals/semantic-diff')
    const { persistIssueData, dbIssueToVM } = await import('@/lib/agent/issue-vm')
    const { db } = await import('@/lib/db')

    // 1. Real semantic-diff against a known stable npm pair (axios has .d.ts → Tier-1).
    const diff = await parseSemanticDiff('axios', '0.24.0', '0.27.2')
    expect(diff.analysisTier).toBe('dts')
    expect(diff.coveragePercent).toBeGreaterThan(0)

    // 2. Realistic neighbour inputs (mock the LLM-dependent shapes).
    const dep = { name: 'axios', currentVersion: '0.24.0', latestVersion: '0.27.2' } as never
    const breakingChanges = [{
      symbol: 'axios.request', changeType: 'signature-changed' as const,
      description: 'request signature evolved',
      sourceUrl: 'https://github.com/axios/axios/releases',
    }]
    const diagnosis = {
      summary: 'axios 0.24 → 0.27 introduces breaking changes',
      impact: 'callers using removed exports will break',
      filesToModify: ['src/client.ts'],
    } as never
    const patches = [
      { filePath: 'package.json', explanation: 'bump axios', newContent: '' },
    ] as never

    // 3. Create a real Scan row (FK target).
    const scan = await db.scan.create({
      data: {
        repoUrl: 'https://github.com/test/semantic-diff-integration',
        status: 'completed',
        schemaVersion: '1.0',
      },
    })
    createdScanId = scan.id

    // 4. Persist via the real path the runner uses.
    const data = persistIssueData({
      scanId: scan.id,
      dep,
      breakingChanges,
      diagnosis,
      patches,
      verificationPassed: true,
      semanticDiff: diff,
    })
    expect(data.semanticDiff).toBeTruthy()

    const issue = await db.issue.create({ data })
    createdIssueId = issue.id
    expect(issue.semanticDiff).toBeTruthy()

    // 5. Read back via the same Prisma select the API uses.
    const readBack = await db.issue.findUnique({ where: { id: issue.id } })
    expect(readBack).toBeTruthy()
    expect(readBack!.semanticDiff).toBeTruthy()

    // 6. JSON round-trip: stored bytes parse back to the original SemanticDiff shape.
    const parsed = JSON.parse(readBack!.semanticDiff!) as typeof diff
    expect(parsed.analysisTier).toBe(diff.analysisTier)
    expect(parsed.coveragePercent).toBe(diff.coveragePercent)
    expect(parsed.removedExports).toEqual(diff.removedExports)
    expect(parsed.signatureChanges.length).toBe(diff.signatureChanges.length)

    // 7. dbIssueToVM mapper still produces a valid IssueVM (Workstream #1 didn't
    //    expose semanticDiff in the VM — that's deliberate for now; Workstream #2
    //    surfaces it once confidence scoring consumes it).
    const vm = dbIssueToVM(readBack!)
    expect(vm.dep).toBe('axios')
    expect(vm.confidence).toBe('medium')
    // Not-Analyzed should reflect that semantic-diff DID run.
    expect(vm.notAnalyzed.some((n) => /\d+%/.test(n))).toBe(true)
  }, 120_000)
})
