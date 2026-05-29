/**
 * Tests for the Contribution Eligibility Gate (CLAUDE.md §5c).
 *
 * The rule that would have prevented the sindresorhus/execa block: a repo you
 * don't own gets NO PR unless you explicitly acknowledge it welcomes them AND
 * the change clears a high bar. Repos that already automate deps, or whose
 * CONTRIBUTING discourages drive-by PRs, are hard-blocked.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { decideEligibility, gateSubmission, assessContributionEligibility } from '@/lib/agent/eligibility'

describe('decideEligibility (pure)', () => {
  const base = { depAutomation: null, contributingRedFlag: null, externalAck: false } as const

  it('owned repo → contribute freely', () => {
    const r = decideEligibility({ ...base, ownsRepo: true })
    expect(r.decision).toBe('owned')
    expect(r.canOpenPRs).toBe(true)
    expect(r.requiresHighBar).toBe(false)
  })

  it('non-owned + Dependabot → blocked (redundant noise)', () => {
    const r = decideEligibility({ ...base, ownsRepo: false, depAutomation: 'dependabot' })
    expect(r.decision).toBe('blocked')
    expect(r.canOpenPRs).toBe(false)
    expect(r.reason).toContain('dependabot')
  })

  it('non-owned + CONTRIBUTING red flag → blocked', () => {
    const r = decideEligibility({ ...base, ownsRepo: false, contributingRedFlag: 'no dependency PRs' })
    expect(r.decision).toBe('blocked')
    expect(r.canOpenPRs).toBe(false)
  })

  it('non-owned + NO acknowledgement → external, report-only (no PR)', () => {
    const r = decideEligibility({ ...base, ownsRepo: false })
    expect(r.decision).toBe('external')
    expect(r.canOpenPRs).toBe(false) // the execa-incident-preventing default
    expect(r.requiresHighBar).toBe(true)
  })

  it('non-owned + acknowledged → external, may open PRs (high bar)', () => {
    const r = decideEligibility({ ...base, ownsRepo: false, externalAck: true })
    expect(r.decision).toBe('external')
    expect(r.canOpenPRs).toBe(true)
    expect(r.requiresHighBar).toBe(true)
  })
})

describe('gateSubmission (pure)', () => {
  const owned = { decision: 'owned' as const, canOpenPRs: true, requiresHighBar: false, reason: '' }
  const extAck = { decision: 'external' as const, canOpenPRs: true, requiresHighBar: true, reason: '' }
  const extNoAck = { decision: 'external' as const, canOpenPRs: false, requiresHighBar: true, reason: 'no ack' }
  const blocked = { decision: 'blocked' as const, canOpenPRs: false, requiresHighBar: true, reason: 'dependabot' }

  it('score below floor → never (any repo)', () => {
    expect(gateSubmission({ eligibility: owned, submissionMode: 'skip', verificationPassed: true }).allow).toBe(false)
  })
  it('owned + draft → allowed (drafts fine on your own repo)', () => {
    expect(gateSubmission({ eligibility: owned, submissionMode: 'draft', verificationPassed: false }).allow).toBe(true)
  })
  it('blocked → never', () => {
    expect(gateSubmission({ eligibility: blocked, submissionMode: 'standard', verificationPassed: true }).allow).toBe(false)
  })
  it('external no-ack → never (report only)', () => {
    expect(gateSubmission({ eligibility: extNoAck, submissionMode: 'standard', verificationPassed: true }).allow).toBe(false)
  })
  it('external ack + draft (low confidence) → blocked (no drive-by drafts)', () => {
    expect(gateSubmission({ eligibility: extAck, submissionMode: 'draft', verificationPassed: true }).allow).toBe(false)
  })
  it('external ack + standard but verification failed → blocked', () => {
    expect(gateSubmission({ eligibility: extAck, submissionMode: 'standard', verificationPassed: false }).allow).toBe(false)
  })
  it('external ack + standard + verified → allowed (the only external PR path)', () => {
    expect(gateSubmission({ eligibility: extAck, submissionMode: 'standard', verificationPassed: true }).allow).toBe(true)
  })
})

describe('assessContributionEligibility (governance files)', () => {
  let root: string
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'elig-')) })
  afterAll(async () => { await rm(root, { recursive: true, force: true }) })

  async function repo(name: string, files: Record<string, string>): Promise<string> {
    const dir = join(root, name)
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel)
      await mkdir(join(full, '..'), { recursive: true })
      await writeFile(full, content, 'utf-8')
    }
    await mkdir(dir, { recursive: true })
    return dir
  }

  it('detects Dependabot → blocked for non-owned', async () => {
    const dir = await repo('dependabot', { '.github/dependabot.yml': 'version: 2\n' })
    const v = assessContributionEligibility(dir, { ownsRepo: false, externalAck: true })
    expect(v.decision).toBe('blocked')
    expect(v.signals.depAutomation).toBe('dependabot')
  })

  it('detects Renovate → blocked for non-owned', async () => {
    const dir = await repo('renovate', { 'renovate.json': '{}' })
    const v = assessContributionEligibility(dir, { ownsRepo: false, externalAck: true })
    expect(v.decision).toBe('blocked')
    expect(v.signals.depAutomation).toBe('renovate')
  })

  it('detects a CONTRIBUTING red flag → blocked', async () => {
    const dir = await repo('contrib', { 'CONTRIBUTING.md': 'Please open an issue first before submitting a PR.' })
    const v = assessContributionEligibility(dir, { ownsRepo: false, externalAck: true })
    expect(v.decision).toBe('blocked')
    expect(v.signals.contributingRedFlag).toBeTruthy()
  })

  it('clean external repo + ack → external (may open PRs at high bar)', async () => {
    const dir = await repo('clean', { 'CODE_OF_CONDUCT.md': 'Be nice.', 'package.json': '{}' })
    const v = assessContributionEligibility(dir, { ownsRepo: false, externalAck: true })
    expect(v.decision).toBe('external')
    expect(v.canOpenPRs).toBe(true)
    expect(v.signals.hasCodeOfConduct).toBe(true)
  })

  it('owned repo → owned regardless of governance files', async () => {
    const dir = await repo('owned', { '.github/dependabot.yml': 'version: 2\n' })
    const v = assessContributionEligibility(dir, { ownsRepo: true, externalAck: false })
    expect(v.decision).toBe('owned')
  })
})
