/**
 * Eligibility Preview (2026-05-31) — informed-consent bridge before scan start.
 *
 * The scan-time eligibility gate (lib/agent/eligibility.ts) reads governance
 * files from the cloned repo. By then the user has already ticked or unticked
 * the "external contribution acknowledged" checkbox BLIND — they couldn't see
 * whether the repo welcomes PRs, is hard-blocked by Dependabot/Renovate, or
 * has an issue Mendel could link to.
 *
 * This module surfaces the SAME verdict before the scan starts, using GitHub's
 * Contents API (no clone needed) so the user's ack is informed instead of a
 * coin-flip. The pure decision (`decideEligibility`) is shared with the
 * scan-time gate — preview and gate cannot diverge.
 *
 * Read-only and fail-soft: if any file fetch errors (404, rate-limit, perms),
 * we degrade to "unknown" — the runtime gate is the safety net, never bypassed.
 *
 * §5c.1 / §5c.2: this is a viewer, not an actor. It never writes.
 */

import { Octokit } from '@octokit/rest'
import {
  decideEligibility,
  type EligibilityDecision,
} from '@/lib/agent/eligibility'

// ── Public types ──────────────────────────────────────────────────────────────

export interface PreviewSignals {
  ownsRepo: boolean
  depAutomation: 'dependabot' | 'renovate' | null
  /** Snippet of the CONTRIBUTING red-flag line (≤160 chars), or null. */
  contributingRedFlag: string | null
  hasCodeOfConduct: boolean
  hasContributing: boolean
}

export interface LinkableIssuePreview {
  number: number
  title: string
  url: string
}

export interface EligibilityPreview {
  /** owned | external | blocked, or "unknown" when the read itself failed. */
  decision: EligibilityDecision | 'unknown'
  /** Preview without ack: "you'll be allowed to open PRs as soon as you tick the box." */
  canOpenPRsIfAcknowledged: boolean
  /** True when checking the box won't help (owned ⇒ no need, blocked ⇒ no effect). */
  ackNeeded: boolean
  /** Human-readable single-line summary, safe to render. */
  reason: string
  signals: PreviewSignals
  /** First open issue whose title/labels look like a dependency-upgrade ask. */
  linkableIssue: LinkableIssuePreview | null
  /** True when the API read itself failed (auth/rate-limit/network) — runtime gate still applies. */
  degraded: boolean
}

// ── Governance file locations (mirror lib/agent/eligibility.ts) ──────────────

const COC_PATHS = ['CODE_OF_CONDUCT.md', '.github/CODE_OF_CONDUCT.md', 'docs/CODE_OF_CONDUCT.md']
const CONTRIBUTING_PATHS = ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'docs/CONTRIBUTING.md']
const DEPENDABOT_PATHS = ['.github/dependabot.yml', '.github/dependabot.yaml']
const RENOVATE_PATHS = [
  'renovate.json', 'renovate.json5', '.renovaterc', '.renovaterc.json',
  '.renovaterc.json5', '.github/renovate.json', '.github/renovate.json5',
]

// Same red-flag set as the scan-time gate. Keep in sync.
const RED_FLAGS: RegExp[] = [
  /\bno\b[^.\n]{0,30}\bdependenc/i,
  /(do not|don't|please don't|avoid)[^.\n]{0,40}(dependenc|version bump|drive-?by|automated pull)/i,
  /(open|file|create|submit)[^.\n]{0,20}an issue[^.\n]{0,25}(first|before)/i,
  /discuss[^.\n]{0,30}before[^.\n]{0,20}(pr|pull request|submitting)/i,
]

// ── GitHub Contents API: file existence + body fetch (best-effort) ───────────

/**
 * Try to read a file via the Contents API.
 *  - 200 → returns decoded UTF-8 string
 *  - 404 → null (file genuinely doesn't exist)
 *  - any other failure → throws, so the caller can degrade once instead of N times
 */
async function tryFetchFile(
  client: Octokit,
  owner: string,
  repo: string,
  path: string,
): Promise<string | null> {
  try {
    const { data } = await client.rest.repos.getContent({ owner, repo, path })
    if (!Array.isArray(data) && 'content' in data && typeof data.content === 'string') {
      return Buffer.from(data.content, 'base64').toString('utf-8')
    }
    return null
  } catch (err: unknown) {
    const status = (err as { status?: number }).status
    if (status === 404) return null
    throw err
  }
}

/** First candidate that returns a file (or null if none exist). */
async function firstExisting(
  client: Octokit,
  owner: string,
  repo: string,
  candidates: string[],
): Promise<{ path: string; content: string } | null> {
  for (const path of candidates) {
    const content = await tryFetchFile(client, owner, repo, path)
    if (content != null) return { path, content }
  }
  return null
}

/** First red-flag match in a CONTRIBUTING-style body, or null. */
export function findRedFlag(content: string): string | null {
  for (const re of RED_FLAGS) {
    const m = content.match(re)
    if (m) return m[0].trim().slice(0, 160)
  }
  return null
}

// ── Linkable issue heuristic (read-only — never creates) ─────────────────────

const DEP_LABELS = new Set(['dependencies', 'deps', 'dependency', 'upgrade', 'upgrades'])
const UPGRADE_TITLE = /\b(upgrade|update|bump)\b[^.\n]{0,60}\b(deps|dependenc|packages?|libraries|versions?)\b/i

/**
 * Pick the first maintainer-opened issue that looks like a dependency-upgrade
 * ask. This is what §5c.2 calls "consent that already exists" — Mendel can
 * attach to it (`Addresses #N`) instead of fabricating new contact.
 */
export function pickLinkableIssue(issues: ReadonlyArray<{
  number: number; title: string; url: string; labels: string[]
}>): LinkableIssuePreview | null {
  for (const iss of issues) {
    const labelHit = iss.labels.some((l) => DEP_LABELS.has(l.toLowerCase()))
    if (labelHit || UPGRADE_TITLE.test(iss.title)) {
      return { number: iss.number, title: iss.title, url: iss.url }
    }
  }
  return null
}

// ── Top-level: build a preview ────────────────────────────────────────────────

export async function previewEligibility(
  pat: string,
  owner: string,
  repo: string,
): Promise<EligibilityPreview> {
  const client = new Octokit({ auth: pat, userAgent: 'mendel-agent' })

  // Track whether ANY read failed — surfaces "preview is incomplete; runtime
  // gate still applies" instead of pretending we have full info.
  let degraded = false

  // (1) ownership = "does this PAT have push access on the upstream repo?"
  //     same signal the runner uses at scan time (mode === 'direct').
  let ownsRepo = false
  try {
    const { data } = await client.rest.repos.get({ owner, repo })
    ownsRepo = Boolean(data.permissions?.push)
  } catch {
    degraded = true
    // Can't tell. Treat as non-owned for the safe default (external).
  }

  // (2) dep automation — file presence only, no content needed.
  let depAutomation: PreviewSignals['depAutomation'] = null
  try {
    const dependabot = await firstExisting(client, owner, repo, DEPENDABOT_PATHS)
    if (dependabot) {
      depAutomation = 'dependabot'
    } else {
      const renovate = await firstExisting(client, owner, repo, RENOVATE_PATHS)
      if (renovate) depAutomation = 'renovate'
    }
  } catch {
    degraded = true
  }

  // (3) CONTRIBUTING — body needed for the red-flag scan.
  let contributingFile: { path: string; content: string } | null = null
  try {
    contributingFile = await firstExisting(client, owner, repo, CONTRIBUTING_PATHS)
  } catch {
    degraded = true
  }
  const contributingRedFlag = contributingFile ? findRedFlag(contributingFile.content) : null

  // (4) CoC — presence only.
  let hasCodeOfConduct = false
  try {
    hasCodeOfConduct = (await firstExisting(client, owner, repo, COC_PATHS)) !== null
  } catch {
    degraded = true
  }

  // (5) linkable issue — best-effort, single page, label/title heuristic.
  let linkableIssue: LinkableIssuePreview | null = null
  if (!depAutomation && !contributingRedFlag) {
    try {
      const { data } = await client.rest.issues.listForRepo({
        owner, repo, state: 'open', per_page: 50,
      })
      const cleaned = data
        .filter((i) => !i.pull_request)
        .map((i) => ({
          number: i.number,
          title: i.title,
          url: i.html_url,
          labels: (i.labels ?? [])
            .map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
            .filter(Boolean),
        }))
      linkableIssue = pickLinkableIssue(cleaned)
    } catch {
      degraded = true
    }
  }

  // (6) decide — share the SAME pure function as the scan-time gate, BUT
  //     evaluate two branches so the UI can say "tick the box and it'll work."
  const withoutAck = decideEligibility({
    ownsRepo,
    depAutomation,
    contributingRedFlag,
    externalAck: false,
  })
  const withAck = decideEligibility({
    ownsRepo,
    depAutomation,
    contributingRedFlag,
    externalAck: true,
  })

  const ackHelps = !withoutAck.canOpenPRs && withAck.canOpenPRs
  // ack is "needed" when ticking it CHANGES the outcome (i.e., external+welcome).
  // Owned → no ack needed; blocked → ack can't unblock; external + ack-required → yes.
  const ackNeeded = ackHelps

  return {
    decision: withoutAck.decision,
    canOpenPRsIfAcknowledged: withAck.canOpenPRs,
    ackNeeded,
    reason: withoutAck.reason,
    signals: {
      ownsRepo,
      depAutomation,
      contributingRedFlag,
      hasCodeOfConduct,
      hasContributing: contributingFile != null,
    },
    linkableIssue,
    degraded,
  }
}
