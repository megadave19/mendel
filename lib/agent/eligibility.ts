/**
 * Contribution Eligibility Gate (2026-05-29) — honesty-of-action, CLAUDE.md §5c.
 *
 * §5b makes Mendel honest about *how confident* it is. This makes it honest +
 * respectful about *whether its contribution is welcome*. The block from
 * sindresorhus (for unsolicited automated PRs on execa) is the cautionary tale:
 * an autonomous agent that spams maintainers is a net-negative product.
 *
 * Rules:
 *  - You OWN/maintain the repo (push access)        → contribute freely (drafts OK).
 *  - Repo already automates deps (Dependabot/Renovate) OR CONTRIBUTING says
 *    "no dependency PRs / open an issue first"       → BLOCKED (report only, never a PR).
 *  - Any other repo you don't own                   → EXTERNAL: PRs only if the
 *    user explicitly acknowledged the repo welcomes them AND the change clears a
 *    HIGH bar (high confidence + passing verification). Never a low-confidence
 *    draft on a stranger's repo. Without acknowledgement → report only.
 *
 * The default for a non-owned repo is therefore "analyze + report, do NOT open a
 * PR" — which alone would have prevented the execa incident.
 */

import { existsSync, readFileSync } from 'fs'
import path from 'path'

export type EligibilityDecision = 'owned' | 'external' | 'blocked'

export interface EligibilitySignals {
  ownsRepo: boolean
  depAutomation: 'dependabot' | 'renovate' | null
  contributingRedFlag: string | null
  hasCodeOfConduct: boolean
  hasContributing: boolean
}

export interface EligibilityVerdict {
  decision: EligibilityDecision
  /** May we open a PR at all (still subject to the per-issue high bar)? */
  canOpenPRs: boolean
  /** Non-owned repos: a PR is only allowed at high confidence + passing verification. */
  requiresHighBar: boolean
  reason: string
  signals: EligibilitySignals
}

// ── Governance file locations ──────────────────────────────────────────────────

const COC_PATHS = ['CODE_OF_CONDUCT.md', '.github/CODE_OF_CONDUCT.md', 'docs/CODE_OF_CONDUCT.md']
const CONTRIBUTING_PATHS = ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md']
const DEPENDABOT_PATHS = ['.github/dependabot.yml', '.github/dependabot.yaml']
const RENOVATE_PATHS = [
  'renovate.json', 'renovate.json5', '.renovaterc', '.renovaterc.json',
  '.renovaterc.json5', '.github/renovate.json', '.github/renovate.json5',
]

// Conservative red-flag phrases — only clear "don't send dependency/drive-by PRs"
// or "open an issue first" signals, to avoid false positives.
const RED_FLAGS: RegExp[] = [
  /\bno\b[^.\n]{0,30}\bdependenc/i,
  /(do not|don't|please don't|avoid)[^.\n]{0,40}(dependenc|version bump|drive-?by|automated pull)/i,
  /(open|file|create|submit)[^.\n]{0,20}an issue[^.\n]{0,25}(first|before)/i,
  /discuss[^.\n]{0,30}before[^.\n]{0,20}(pr|pull request|submitting)/i,
]

function firstExisting(repoPath: string, candidates: string[]): string | null {
  for (const c of candidates) {
    if (existsSync(path.join(repoPath, c))) return c
  }
  return null
}

function findContributingRedFlag(repoPath: string): string | null {
  const rel = firstExisting(repoPath, CONTRIBUTING_PATHS)
  if (!rel) return null
  let text: string
  try {
    text = readFileSync(path.join(repoPath, rel), 'utf-8')
  } catch {
    return null
  }
  for (const re of RED_FLAGS) {
    const m = text.match(re)
    if (m) return m[0].trim().slice(0, 160)
  }
  return null
}

// ── Pure decision ──────────────────────────────────────────────────────────────

export function decideEligibility(i: {
  ownsRepo: boolean
  depAutomation: 'dependabot' | 'renovate' | null
  contributingRedFlag: string | null
  externalAck: boolean
}): Omit<EligibilityVerdict, 'signals'> {
  if (i.ownsRepo) {
    return { decision: 'owned', canOpenPRs: true, requiresHighBar: false, reason: 'you own/maintain this repo — contributing freely' }
  }
  if (i.depAutomation) {
    return {
      decision: 'blocked',
      canOpenPRs: false,
      requiresHighBar: true,
      reason: `repo already automates dependency updates (${i.depAutomation}) — Mendel PRs would be redundant noise; report only`,
    }
  }
  if (i.contributingRedFlag) {
    return {
      decision: 'blocked',
      canOpenPRs: false,
      requiresHighBar: true,
      reason: `CONTRIBUTING discourages unsolicited dependency PRs ("${i.contributingRedFlag}") — report only`,
    }
  }
  if (!i.externalAck) {
    return {
      decision: 'external',
      canOpenPRs: false,
      requiresHighBar: true,
      reason: "external repo you don't maintain — contribution norms not acknowledged; report only (no PR)",
    }
  }
  return {
    decision: 'external',
    canOpenPRs: true,
    requiresHighBar: true,
    reason: 'external repo (acknowledged) — PRs gated on high confidence + passing verification',
  }
}

// ── IO: read governance files + decide ──────────────────────────────────────────

export function assessContributionEligibility(
  repoPath: string,
  opts: { ownsRepo: boolean; externalAck: boolean },
): EligibilityVerdict {
  const depAutomation: EligibilitySignals['depAutomation'] = firstExisting(repoPath, DEPENDABOT_PATHS)
    ? 'dependabot'
    : firstExisting(repoPath, RENOVATE_PATHS)
      ? 'renovate'
      : null
  const contributingRedFlag = findContributingRedFlag(repoPath)
  const signals: EligibilitySignals = {
    ownsRepo: opts.ownsRepo,
    depAutomation,
    contributingRedFlag,
    hasCodeOfConduct: firstExisting(repoPath, COC_PATHS) !== null,
    hasContributing: firstExisting(repoPath, CONTRIBUTING_PATHS) !== null,
  }
  const decision = decideEligibility({
    ownsRepo: opts.ownsRepo,
    depAutomation,
    contributingRedFlag,
    externalAck: opts.externalAck,
  })
  return { ...decision, signals }
}

// ── Per-issue submission gate (combines eligibility + threshold result) ──────────

export function gateSubmission(input: {
  eligibility: Pick<EligibilityVerdict, 'decision' | 'canOpenPRs' | 'requiresHighBar' | 'reason'>
  submissionMode: 'standard' | 'draft' | 'skip'
  verificationPassed: boolean
}): { allow: boolean; reason: string } {
  const { eligibility, submissionMode, verificationPassed } = input
  if (submissionMode === 'skip') {
    return { allow: false, reason: 'confidence below floor (40) — diagnosis persisted for review' }
  }
  if (eligibility.decision === 'owned') {
    return { allow: true, reason: '' }
  }
  if (eligibility.decision === 'blocked' || !eligibility.canOpenPRs) {
    return { allow: false, reason: eligibility.reason }
  }
  // external + acknowledged → high bar only
  if (submissionMode !== 'standard' || !verificationPassed) {
    return {
      allow: false,
      reason:
        "external repo — a PR requires HIGH confidence (≥ threshold) AND passing verification; " +
        "opening a low-confidence draft on a repo you don't maintain would be noise",
    }
  }
  return { allow: true, reason: '' }
}
