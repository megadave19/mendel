/**
 * End-to-end integration test for v1.5 Workstream #2.
 *
 * Mirrors the semantic-diff integration test: exercises the full path from
 * REAL signals → confidence scorer → persistIssueData → Prisma DB → readback.
 *
 * Gated by SEMDIFF_LIVE=1 (network + DB writes — same gate as Workstream #1
 * integration so they can run together).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const ENABLE = process.env.SEMDIFF_LIVE === '1'

describe.skipIf(!ENABLE)('confidence-score integration — runner → DB → readback', () => {
  let createdScanId: string | undefined
  let createdIssueId: string | undefined

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'test-key-32-chars-exactly-padded!'
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'file:./prisma/dev.db'
  })

  afterAll(async () => {
    if (!createdScanId) return
    const { db } = await import('@/lib/db')
    if (createdIssueId) await db.issue.delete({ where: { id: createdIssueId } }).catch(() => {})
    await db.scan.delete({ where: { id: createdScanId } }).catch(() => {})
  })

  it('real semantic-diff → calculateConfidence → persist → readback round-trips the calibrated score', async () => {
    const { parseSemanticDiff } = await import('@/lib/agent/signals/semantic-diff')
    const { calculateConfidence } = await import('@/lib/agent/confidence/score')
    const { persistIssueData, parseConfidenceBlob } = await import('@/lib/agent/issue-vm')
    const { db } = await import('@/lib/db')

    // 1. Real semantic-diff against a stable Tier-1 pair.
    const diff = await parseSemanticDiff('axios', '0.24.0', '0.27.2')
    expect(diff.analysisTier).toBe('dts')

    // 2. Realistic neighbour signals.
    const breakingChanges = [{
      symbol: 'axios.request',
      changeType: 'signature-changed' as const,
      description: 'request signature evolved',
      sourceUrl: 'https://github.com/axios/axios/releases',
    }]

    // 3. Real scorer call.
    const score = calculateConfidence({
      breakingChanges,
      semanticDiff: diff,
      patchedFilePaths: ['package.json', 'src/client.ts'],
      verificationPassed: true,
    })
    expect(score.overall).toBeGreaterThan(0)
    expect(['high', 'medium', 'low']).toContain(score.bucket)
    expect(score.perPatchedFile.length).toBe(2)
    expect(score.analysisCoverage.analysisTier).toBe('dts')

    // 4. Persist via the real shape persistIssueData expects.
    const dep = { name: 'axios', currentVersion: '0.24.0', latestVersion: '0.27.2' } as never
    const diagnosis = { summary: 's', impact: 'i', filesToModify: [] } as never
    const patches = [{ filePath: 'package.json', explanation: '', newContent: '' }] as never

    const scan = await db.scan.create({
      data: {
        repoUrl: 'https://github.com/test/confidence-integration',
        status: 'completed',
        schemaVersion: '1.0',
      },
    })
    createdScanId = scan.id

    const data = persistIssueData({
      scanId: scan.id,
      dep, breakingChanges, diagnosis, patches,
      verificationPassed: true,
      semanticDiff: diff,
      confidenceScore: score,
    })
    const issue = await db.issue.create({ data })
    createdIssueId = issue.id

    // 5. Read back via Prisma — same query the API uses.
    const readBack = await db.issue.findUnique({ where: { id: issue.id } })
    expect(readBack).toBeTruthy()
    expect(readBack!.confidence).toBeTruthy()
    expect(readBack!.semanticDiff).toBeTruthy()

    // 6. Confidence column should parse as a full ConfidenceScore, not a stub.
    const parsed = parseConfidenceBlob(readBack!.confidence)
    expect(parsed.kind).toBe('score')
    if (parsed.kind === 'score') {
      expect(parsed.value.overall).toBe(score.overall)
      expect(parsed.value.bucket).toBe(score.bucket)
      expect(parsed.value.analysisCoverage.analysisTier).toBe('dts')
      expect(parsed.value.verificationCapped).toBe(false)
    }
  }, 120_000)

  it('verification failure caps overall at 50 and persists with bucket=low', async () => {
    const { calculateConfidence } = await import('@/lib/agent/confidence/score')
    const { persistIssueData, parseConfidenceBlob } = await import('@/lib/agent/issue-vm')
    const { db } = await import('@/lib/db')

    const score = calculateConfidence({
      breakingChanges: [{ symbol: 'a', changeType: 'removed', description: '', sourceUrl: 'https://x' }],
      semanticDiff: {
        removedExports: ['a'], signatureChanges: [], newDeprecations: [],
        affectedSitesInRepo: [], coveragePercent: 90, unanalyzableSymbols: [],
        analysisTier: 'dts',
      },
      patchedFilePaths: ['x.ts'],
      verificationPassed: false, // ← cap
    })
    expect(score.verificationCapped).toBe(true)
    expect(score.overall).toBe(50)
    expect(score.bucket).toBe('low')

    // Persist + readback the capped score
    const dep = { name: 'capped', currentVersion: '1.0.0', latestVersion: '2.0.0' } as never
    const breakingChanges = [{ symbol: 'a', changeType: 'removed' as const, description: '', sourceUrl: 'https://x' }]
    const diagnosis = { summary: 's', impact: 'i', filesToModify: [] } as never
    const patches = [{ filePath: 'x.ts', explanation: '', newContent: '' }] as never

    const scan = await db.scan.create({
      data: { repoUrl: 'https://github.com/test/capped-integration', status: 'completed', schemaVersion: '1.0' },
    })
    const issue = await db.issue.create({
      data: persistIssueData({ scanId: scan.id, dep, breakingChanges, diagnosis, patches, verificationPassed: false, confidenceScore: score }),
    })
    try {
      const readBack = await db.issue.findUnique({ where: { id: issue.id } })
      const parsed = parseConfidenceBlob(readBack!.confidence)
      expect(parsed.kind).toBe('score')
      if (parsed.kind === 'score') {
        expect(parsed.value.overall).toBe(50)
        expect(parsed.value.bucket).toBe('low')
        expect(parsed.value.verificationCapped).toBe(true)
      }
    } finally {
      await db.issue.delete({ where: { id: issue.id } }).catch(() => {})
      await db.scan.delete({ where: { id: scan.id } }).catch(() => {})
    }
  }, 60_000)
})
