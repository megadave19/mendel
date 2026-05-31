/**
 * Unit tests for v1.5 Workstream #3 — threshold-gated PR submission.
 *
 * Covers:
 *   - resolveThreshold env + default + clamping
 *   - chooseSubmissionMode 3-tier dispatch (TRD §9.5)
 *   - explainSubmissionMode human-readable strings (UI tooltip / runner log)
 *   - submit.ts buildPRBody v1.5 confidence block + back-compat to v1.0 stub
 *   - skip-mode safety: submitDraftPR throws if invoked with mode='skip'
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  chooseSubmissionMode,
  explainSubmissionMode,
  resolveThreshold,
  SUBMISSION_FLOOR,
  DEFAULT_THRESHOLD,
} from '@/lib/agent/confidence/threshold'
import type { ConfidenceScore } from '@/lib/agent/confidence/score'
import { __testing as submitTesting, submitDraftPR } from '@/lib/agent/phases/submit'

function makeScore(overall: number, bucket: ConfidenceScore['bucket'], verificationCapped = false): ConfidenceScore {
  return {
    overall,
    bucket,
    perBreakingChange: [{ symbol: 'sample', score: overall, signalsAgreeing: ['changelog'] }],
    perPatchedFile: [{ path: 'src/x.ts', score: 80, reductions: [] }],
    analysisCoverage: {
      symbolsAnalyzed: 10, symbolsTotal: 10, percentCovered: 100,
      analysisTier: 'dts', notAnalyzed: [],
    },
    verificationCapped,
    smokeCapped: false,
  }
}

/* ─── Threshold resolution ────────────────────────────────────────────────── */

describe('threshold: resolveThreshold env + default + clamping', () => {
  const originalEnv = process.env.MENDEL_CONFIDENCE_THRESHOLD
  beforeEach(() => { delete process.env.MENDEL_CONFIDENCE_THRESHOLD })
  afterEach(() => { process.env.MENDEL_CONFIDENCE_THRESHOLD = originalEnv })

  it('returns DEFAULT_THRESHOLD (70) with no config + no env', () => {
    expect(resolveThreshold()).toBe(DEFAULT_THRESHOLD)
    expect(resolveThreshold({})).toBe(DEFAULT_THRESHOLD)
  })

  it('respects explicit config.threshold over env', () => {
    process.env.MENDEL_CONFIDENCE_THRESHOLD = '85'
    expect(resolveThreshold({ threshold: 90 })).toBe(90)
  })

  it('reads env when no explicit config', () => {
    process.env.MENDEL_CONFIDENCE_THRESHOLD = '85'
    expect(resolveThreshold()).toBe(85)
  })

  it('clamps to [SUBMISSION_FLOOR, 100]', () => {
    expect(resolveThreshold({ threshold: 5 })).toBe(SUBMISSION_FLOOR) // floor
    expect(resolveThreshold({ threshold: 200 })).toBe(100)             // ceiling
  })

  it('falls back to default on non-numeric env', () => {
    process.env.MENDEL_CONFIDENCE_THRESHOLD = 'banana'
    expect(resolveThreshold()).toBe(DEFAULT_THRESHOLD)
  })

  it('rounds non-integer thresholds', () => {
    expect(resolveThreshold({ threshold: 72.6 })).toBe(73)
  })
})

/* ─── Mode dispatch ───────────────────────────────────────────────────────── */

describe('threshold: chooseSubmissionMode (TRD §9.5 3-tier)', () => {
  it('score ≥ threshold → standard', () => {
    expect(chooseSubmissionMode(makeScore(90, 'high'), { threshold: 70 })).toBe('standard')
    expect(chooseSubmissionMode(makeScore(70, 'medium'), { threshold: 70 })).toBe('standard') // boundary inclusive
  })

  it('floor ≤ score < threshold → draft', () => {
    expect(chooseSubmissionMode(makeScore(69, 'medium'), { threshold: 70 })).toBe('draft')
    expect(chooseSubmissionMode(makeScore(50, 'low'),    { threshold: 70 })).toBe('draft') // verification-capped lands here
    expect(chooseSubmissionMode(makeScore(SUBMISSION_FLOOR, 'low'), { threshold: 70 })).toBe('draft') // boundary inclusive
  })

  it('score < floor → skip', () => {
    expect(chooseSubmissionMode(makeScore(SUBMISSION_FLOOR - 1, 'low'), { threshold: 70 })).toBe('skip')
    expect(chooseSubmissionMode(makeScore(0, 'low'), { threshold: 70 })).toBe('skip')
  })

  it('verification-capped (overall=50) lands in draft tier with default threshold', () => {
    const capped = makeScore(50, 'low', true)
    expect(chooseSubmissionMode(capped)).toBe('draft')
  })
})

/* ─── Explanations (for runner logs + UI tooltips) ────────────────────────── */

describe('threshold: explainSubmissionMode produces human-readable strings', () => {
  it('explains standard mode with score + threshold', () => {
    const s = makeScore(90, 'high')
    expect(explainSubmissionMode('standard', s, { threshold: 70 }))
      .toContain('90/100')
    expect(explainSubmissionMode('standard', s, { threshold: 70 }))
      .toContain('standard PR')
  })

  it('explains draft mode with both threshold + floor', () => {
    const s = makeScore(55, 'low')
    const text = explainSubmissionMode('draft', s, { threshold: 70 })
    expect(text).toContain('55/100')
    expect(text).toContain('Draft PR')
  })

  it('explains skip mode with floor reference', () => {
    const s = makeScore(20, 'low')
    const text = explainSubmissionMode('skip', s)
    expect(text).toContain('20/100')
    expect(text).toContain('floor')
    expect(text).toContain('no PR')
  })
})

/* ─── PR body builder shows score + bucket + tags ─────────────────────────── */

describe('submit: buildPRBody v1.5 confidence block', () => {
  const dep = { name: 'axios', currentVersion: '0.24.0', latestVersion: '0.27.2' } as never
  const breakingChanges = [{ symbol: 'request', changeType: 'signature-changed' as const, description: '', sourceUrl: 'https://gh/x' }]
  const diagnosis = { summary: 's', impact: 'i', filesToModify: [] } as never
  const patches = [{ filePath: 'package.json', explanation: 'bump axios', newContent: '' }] as never

  it('renders calibrated bucket emoji + score in body when confidenceScore supplied', () => {
    const score = makeScore(90, 'high')
    const body = submitTesting.buildPRBody(dep, breakingChanges, diagnosis, patches, true, score, 'standard')
    expect(body).toContain('🟢')
    expect(body).toContain('Confidence: 90/100 (high)')
    expect(body).toContain('calibrated')
    expect(body).toContain('Mendel v1.5')
    expect(body).toContain('standard PR') // footer reflects mode
  })

  it('renders draft footer + warning when mode=draft', () => {
    const score = makeScore(55, 'low')
    const body = submitTesting.buildPRBody(dep, breakingChanges, diagnosis, patches, true, score, 'draft')
    expect(body).toContain('🔴')
    expect(body).toContain('Opened as **Draft**')
    expect(body).toContain('mark ready')
  })

  it('falls back to v1.0 "medium" framing when confidenceScore is null', () => {
    const body = submitTesting.buildPRBody(dep, breakingChanges, diagnosis, patches, true, null, 'draft')
    expect(body).toContain('Confidence: medium')
    expect(body).not.toContain('calibrated')
  })

  it('surfaces verification cap warning when score.verificationCapped is true', () => {
    const capped = makeScore(50, 'low', true)
    const body = submitTesting.buildPRBody(dep, breakingChanges, diagnosis, patches, false, capped, 'draft')
    expect(body).toContain('capped at 50')
    expect(body).toContain('verification did not pass')
  })

  it('lists per-symbol tags when present', () => {
    const score: ConfidenceScore = {
      ...makeScore(70, 'medium'),
      perBreakingChange: [
        { symbol: 'undocumentedSym', score: 70, signalsAgreeing: ['semantic_diff'], tag: 'undocumented breaking change' },
        { symbol: 'taggedSym', score: 48, signalsAgreeing: ['changelog'], tag: 'needs manual verification' },
      ],
    }
    const body = submitTesting.buildPRBody(dep, breakingChanges, diagnosis, patches, true, score, 'draft')
    expect(body).toContain('undocumentedSym')
    expect(body).toContain('undocumented breaking change')
    expect(body).toContain('needs manual verification')
  })
})

/* ─── Skip-mode safety ────────────────────────────────────────────────────── */

describe('submit: skip-mode guard', () => {
  it('submitDraftPR throws if invoked with mode=skip (defensive — runner must filter)', async () => {
    const dep = { name: 'x', currentVersion: '1', latestVersion: '2' } as never
    await expect(
      submitDraftPR(
        '/tmp/no-repo', 'o', 'r', 'main',
        dep, [], { summary: '', impact: '', filesToModify: [] } as never, [],
        true, 'pat', () => {}, null, 'skip',
      ),
    ).rejects.toThrow(/mode=skip/)
  })
})
