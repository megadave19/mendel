/**
 * Unit tests for v1.5 Workstream #6 — scan-level confidence summarizer.
 */

import { describe, it, expect } from 'vitest'
import type { Issue } from '@prisma/client'
import {
  summarizeScanConfidence,
  parseScanConfidenceSummary,
  ScanConfidenceSummarySchema,
} from '@/lib/agent/confidence/summary'
import type { ConfidenceScore } from '@/lib/agent/confidence/score'

function makeIssue(args: {
  score?: ConfidenceScore
  stub?: boolean
  verifyPassed?: boolean
}): Pick<Issue, 'confidence' | 'verification'> {
  const { score, stub, verifyPassed = true } = args
  return {
    confidence: stub
      ? JSON.stringify({ level: 'medium' })
      : score
        ? JSON.stringify(score)
        : '',
    verification: JSON.stringify({ passed: verifyPassed }),
  }
}

function score(overall: number, bucket: ConfidenceScore['bucket'], opts: Partial<ConfidenceScore> = {}): ConfidenceScore {
  return {
    overall,
    bucket,
    perBreakingChange: [],
    perPatchedFile: [],
    analysisCoverage: { symbolsAnalyzed: 0, symbolsTotal: 0, percentCovered: 0, analysisTier: 'dts', notAnalyzed: [] },
    verificationCapped: false,
    smokeCapped: false,
    ...opts,
  }
}

describe('summarizeScanConfidence', () => {
  it('returns null when no issues exist', () => {
    expect(summarizeScanConfidence([])).toBeNull()
  })

  it('returns hasCalibratedData=false when all issues are v1.0 stubs', () => {
    const result = summarizeScanConfidence([makeIssue({ stub: true }), makeIssue({ stub: true })])
    expect(result).toBeTruthy()
    expect(result!.hasCalibratedData).toBe(false)
    expect(result!.issuesTotal).toBe(2)
    expect(result!.issuesCalibrated).toBe(0)
    expect(result!.avgScore).toBe(0)
    expect(result!.bucketCounts).toEqual({ high: 0, medium: 0, low: 0 })
  })

  it('computes average + bucket distribution + tier distribution from mixed scored issues', () => {
    const result = summarizeScanConfidence([
      makeIssue({ score: score(90, 'high', { analysisCoverage: { symbolsAnalyzed: 10, symbolsTotal: 10, percentCovered: 100, analysisTier: 'dts', notAnalyzed: [] } }) }),
      makeIssue({ score: score(70, 'medium', { analysisCoverage: { symbolsAnalyzed: 5, symbolsTotal: 10, percentCovered: 50, analysisTier: 'ast-only', notAnalyzed: [] } }) }),
      makeIssue({ score: score(50, 'low', { verificationCapped: true, analysisCoverage: { symbolsAnalyzed: 0, symbolsTotal: 0, percentCovered: 0, analysisTier: 'dts', notAnalyzed: [] } }) }),
      makeIssue({ stub: true }), // v1.0 stub — excluded from average
    ])
    expect(result!.hasCalibratedData).toBe(true)
    expect(result!.issuesTotal).toBe(4)
    expect(result!.issuesCalibrated).toBe(3)
    expect(result!.avgScore).toBe(70) // (90+70+50)/3
    expect(result!.bucketCounts).toEqual({ high: 1, medium: 1, low: 1 })
    expect(result!.tierCounts).toEqual({ dts: 2, 'api-extractor': 0, 'ast-only': 1, none: 0 })
  })

  it('regression rate counts verification failures across calibrated issues only', () => {
    const result = summarizeScanConfidence([
      makeIssue({ score: score(80, 'high'), verifyPassed: false }),
      makeIssue({ score: score(80, 'high'), verifyPassed: true }),
      makeIssue({ score: score(80, 'high'), verifyPassed: true }),
      makeIssue({ score: score(80, 'high'), verifyPassed: true }),
    ])
    expect(result!.verificationFailureRate).toBe(0.25) // 1 of 4
  })

  it('capped rate reflects verificationCapped flags from scored issues', () => {
    const result = summarizeScanConfidence([
      makeIssue({ score: score(50, 'low', { verificationCapped: true }) }),
      makeIssue({ score: score(90, 'high', { verificationCapped: false }) }),
    ])
    expect(result!.cappedRate).toBe(0.5)
  })

  it('output passes Zod schema', () => {
    const result = summarizeScanConfidence([
      makeIssue({ score: score(80, 'high') }),
    ])
    expect(() => ScanConfidenceSummarySchema.parse(result)).not.toThrow()
  })

  it('handles malformed verification blob gracefully (skips, no throw)', () => {
    const issue: Pick<Issue, 'confidence' | 'verification'> = {
      confidence: JSON.stringify(score(80, 'high')),
      verification: 'not-json',
    }
    const result = summarizeScanConfidence([issue])
    expect(result!.verificationFailureRate).toBe(0) // failure not counted
    expect(result!.issuesCalibrated).toBe(1)
  })
})

describe('parseScanConfidenceSummary', () => {
  it('returns null on null/empty/malformed input', () => {
    expect(parseScanConfidenceSummary(null)).toBeNull()
    expect(parseScanConfidenceSummary('')).toBeNull()
    expect(parseScanConfidenceSummary('not-json')).toBeNull()
    expect(parseScanConfidenceSummary('{"random":"shape"}')).toBeNull()
  })

  it('round-trips a valid summary', () => {
    const input = summarizeScanConfidence([makeIssue({ score: score(75, 'medium') })])
    const json = JSON.stringify(input)
    const out = parseScanConfidenceSummary(json)
    expect(out).toEqual(input)
  })
})
