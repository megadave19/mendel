import { describe, it, expect, beforeAll } from 'vitest'
import type { Issue } from '@prisma/client'

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'test-key-32-chars-exactly-padded!'
  process.env.DATABASE_URL = 'file:./prisma/dev.db'
})

const dep = { name: 'axios', currentVersion: '0.24.0', latestVersion: '1.7.9' } as never
const breakingChanges = [
  { symbol: 'default export', changeType: 'removed', description: 'CJS default removed', sourceUrl: 'https://github.com/axios/axios/releases/tag/v1.0.0' },
] as never
const diagnosis = { summary: 'default import breaks', impact: 'runtime error on import', filesToModify: ['src/client.ts'] } as never
const patches = [
  { filePath: 'package.json', explanation: 'bump axios', newContent: '' },
  { filePath: 'src/client.ts', explanation: 'fix import', newContent: '' },
] as never

describe('issue-vm: persist → map round-trip', () => {
  it('persistIssueData enforces §5b (medium confidence + Not-Analyzed) and round-trips to IssueVM', async () => {
    const { persistIssueData, dbIssueToVM } = await import('@/lib/agent/issue-vm')

    const data = persistIssueData({
      scanId: 'scan-1',
      dep,
      breakingChanges,
      diagnosis,
      patches,
      verificationPassed: true,
      prUrl: 'https://github.com/megadave19/mendel-test/pull/2',
    })

    // §5b: confidence is medium, never high.
    expect(JSON.parse(data.confidence)).toEqual({ level: 'medium' })
    // §5b: Not-Analyzed disclosures present.
    expect(JSON.parse(data.notAnalyzed).length).toBeGreaterThan(0)

    // Simulate the persisted DB row → map back to the frontend VM.
    const dbRow = {
      id: 'issue-1',
      diagnosis: data.diagnosis,
      patch: data.patch,
      verification: data.verification,
      notAnalyzed: data.notAnalyzed,
      prUrl: data.prUrl,
    } as unknown as Issue

    const vm = dbIssueToVM(dbRow)
    expect(vm.dep).toBe('axios')
    expect(vm.currentVersion).toBe('0.24.0')
    expect(vm.latestVersion).toBe('1.7.9')
    expect(vm.confidence).toBe('medium')
    expect(vm.verificationPassed).toBe(true)
    expect(vm.prUrl).toContain('/pull/2')
    expect(vm.evidence[0].url).toContain('axios')
    expect(vm.diff.length).toBeGreaterThan(0) // manifest bump at minimum
    expect(vm.notAnalyzed.length).toBeGreaterThan(0)
  })

  it('dbIssueToVM falls back safely on malformed/empty blobs', async () => {
    const { dbIssueToVM } = await import('@/lib/agent/issue-vm')
    const vm = dbIssueToVM({ id: 'x', diagnosis: 'not-json', patch: null, verification: '', notAnalyzed: '[]', prUrl: null } as unknown as Issue)
    expect(vm.confidence).toBe('medium')
    expect(Array.isArray(vm.diff)).toBe(true)
    expect(vm.prUrl).toBeUndefined()
  })

  /* v1.5 Workstream #1 — semantic-diff persistence round-trip */
  it('persistIssueData writes semanticDiff JSON column when supplied', async () => {
    const { persistIssueData } = await import('@/lib/agent/issue-vm')
    const semanticDiff = {
      removedExports: ['legacyApi'],
      signatureChanges: [{ symbol: 'request', before: '(url) => Promise', after: '(opts) => Promise' }],
      newDeprecations: [],
      affectedSitesInRepo: [{ symbol: 'legacyApi', files: ['/repo/a.ts'] }],
      coveragePercent: 92,
      unanalyzableSymbols: [],
      analysisTier: 'dts' as const,
    }
    const data = persistIssueData({
      scanId: 'scan-1',
      dep,
      breakingChanges,
      diagnosis,
      patches,
      verificationPassed: true,
      semanticDiff,
    })
    expect(data.semanticDiff).toBeTruthy()
    const parsed = JSON.parse(data.semanticDiff!)
    expect(parsed.analysisTier).toBe('dts')
    expect(parsed.removedExports).toEqual(['legacyApi'])
    expect(parsed.coveragePercent).toBe(92)
    // Not-Analyzed should reflect that semantic-diff DID run (drops the
    // "no semantic API diff in v1.0" disclosure).
    const notAnalyzed = JSON.parse(data.notAnalyzed) as string[]
    expect(notAnalyzed.some((n) => n.includes('92%'))).toBe(true)
    expect(notAnalyzed.some((n) => n.includes('no semantic API diff'))).toBe(false)
  })

  it('persistIssueData falls back to standard Not-Analyzed when semanticDiff is null', async () => {
    const { persistIssueData } = await import('@/lib/agent/issue-vm')
    const data = persistIssueData({
      scanId: 'scan-1',
      dep,
      breakingChanges,
      diagnosis,
      patches,
      verificationPassed: true,
      semanticDiff: null,
    })
    expect(data.semanticDiff).toBeNull()
    const notAnalyzed = JSON.parse(data.notAnalyzed) as string[]
    expect(notAnalyzed.some((n) => n.includes('no semantic API diff'))).toBe(true)
  })

  /* v1.5 Workstream #2 — calibrated ConfidenceScore persistence */
  it('persistIssueData writes full ConfidenceScore object into confidence column when supplied', async () => {
    const { persistIssueData, parseConfidenceBlob } = await import('@/lib/agent/issue-vm')
    const score = {
      overall: 88,
      bucket: 'high' as const,
      perBreakingChange: [{ symbol: 'foo', score: 90, signalsAgreeing: ['changelog' as const, 'semantic_diff' as const] }],
      perPatchedFile: [{ path: 'src/a.ts', score: 80, reductions: [] }],
      analysisCoverage: {
        symbolsAnalyzed: 9, symbolsTotal: 10, percentCovered: 90,
        analysisTier: 'dts' as const, notAnalyzed: [],
      },
      verificationCapped: false,
      smokeCapped: false,
    }
    const data = persistIssueData({
      scanId: 'scan-1', dep, breakingChanges, diagnosis, patches,
      verificationPassed: true, confidenceScore: score,
    })
    const parsed = parseConfidenceBlob(data.confidence)
    expect(parsed.kind).toBe('score')
    if (parsed.kind === 'score') {
      expect(parsed.value.overall).toBe(88)
      expect(parsed.value.bucket).toBe('high')
      expect(parsed.value.perBreakingChange[0].symbol).toBe('foo')
    }
  })

  it('persistIssueData falls back to v1.0 stub when confidenceScore is null (§5b honest framing)', async () => {
    const { persistIssueData, parseConfidenceBlob } = await import('@/lib/agent/issue-vm')
    const data = persistIssueData({
      scanId: 'scan-1', dep, breakingChanges, diagnosis, patches,
      verificationPassed: true, confidenceScore: null,
    })
    const parsed = parseConfidenceBlob(data.confidence)
    expect(parsed.kind).toBe('stub')
    if (parsed.kind === 'stub') expect(parsed.level).toBe('medium')
  })

  it('parseConfidenceBlob handles malformed / legacy v1.0 stub data', async () => {
    const { parseConfidenceBlob } = await import('@/lib/agent/issue-vm')
    expect(parseConfidenceBlob(null).kind).toBe('stub')
    expect(parseConfidenceBlob('').kind).toBe('stub')
    expect(parseConfidenceBlob('not-json').kind).toBe('stub')
    expect(parseConfidenceBlob('{"level":"medium"}').kind).toBe('stub') // legacy
    expect(parseConfidenceBlob('{"some":"random"}').kind).toBe('stub')  // unknown
  })

  /* v1.5 Workstream #4 — dbIssueToVM surfaces calibrated data */
  it('dbIssueToVM populates confidenceData when DB row holds a calibrated ConfidenceScore', async () => {
    const { persistIssueData, dbIssueToVM } = await import('@/lib/agent/issue-vm')
    const score = {
      overall: 88,
      bucket: 'high' as const,
      perBreakingChange: [
        { symbol: 'highSym',  score: 90, signalsAgreeing: ['changelog' as const, 'semantic_diff' as const] },
        { symbol: 'taggedSym', score: 60, signalsAgreeing: ['semantic_diff' as const], tag: 'undocumented breaking change' },
      ],
      perPatchedFile: [{ path: 'src/a.ts', score: 80, reductions: [] }],
      analysisCoverage: {
        symbolsAnalyzed: 9, symbolsTotal: 10, percentCovered: 90,
        analysisTier: 'dts' as const, notAnalyzed: [],
      },
      verificationCapped: false,
      smokeCapped: false,
    }
    const data = persistIssueData({
      scanId: 'scan-1', dep, breakingChanges, diagnosis, patches,
      verificationPassed: true, confidenceScore: score,
    })
    const dbRow = {
      id: 'i1',
      diagnosis: data.diagnosis,
      patch: data.patch,
      verification: data.verification,
      notAnalyzed: data.notAnalyzed,
      prUrl: data.prUrl,
      confidence: data.confidence,
      semanticDiff: data.semanticDiff,
    } as unknown as Issue

    const vm = dbIssueToVM(dbRow)
    expect(vm.confidence).toBe('high')               // bucket surfaced
    expect(vm.confidenceData).toBeTruthy()
    expect(vm.confidenceData!.score).toBe(88)
    expect(vm.confidenceData!.bucket).toBe('high')
    expect(vm.confidenceData!.tier).toBe('dts')
    expect(vm.confidenceData!.coveragePercent).toBe(90)
    expect(vm.confidenceData!.capped).toBe(false)
    expect(vm.confidenceData!.perBreakingChange.length).toBe(2)
    // tag should round-trip
    const tagged = vm.confidenceData!.perBreakingChange.find((p) => p.symbol === 'taggedSym')
    expect(tagged?.tag).toBe('undocumented breaking change')
  })

  it('dbIssueToVM falls back to bucket="medium" + no confidenceData on v1.0 stub rows', async () => {
    const { dbIssueToVM } = await import('@/lib/agent/issue-vm')
    const dbRow = {
      id: 'legacy',
      diagnosis: JSON.stringify({ dep: 'x', currentVersion: '1', latestVersion: '2', what: '', why: '', evidence: [] }),
      patch: null,
      verification: '',
      notAnalyzed: '[]',
      prUrl: null,
      confidence: JSON.stringify({ level: 'medium' }), // v1.0 stub shape
      semanticDiff: null,
    } as unknown as Issue
    const vm = dbIssueToVM(dbRow)
    expect(vm.confidence).toBe('medium')
    expect(vm.confidenceData).toBeUndefined()
  })

  it('dbIssueToVM falls back to bucket="medium" on malformed confidence column', async () => {
    const { dbIssueToVM } = await import('@/lib/agent/issue-vm')
    const dbRow = {
      id: 'bad',
      diagnosis: JSON.stringify({ dep: 'x', currentVersion: '1', latestVersion: '2', what: '', why: '', evidence: [] }),
      patch: null,
      verification: '',
      notAnalyzed: '[]',
      prUrl: null,
      confidence: 'not-json',
      semanticDiff: null,
    } as unknown as Issue
    const vm = dbIssueToVM(dbRow)
    expect(vm.confidence).toBe('medium')
    expect(vm.confidenceData).toBeUndefined()
  })
})
