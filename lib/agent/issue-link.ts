/**
 * Issue-linking (2026-05-29, CLAUDE.md §5c.2). When Mendel opens a PR, link it
 * to an EXISTING open issue the maintainer already filed (e.g. a "dependencies"
 * good-first-issue). This makes the PR *resolve a real request* instead of
 * arriving uninvited — consent already exists, so linking is welcome.
 *
 * Mendel NEVER creates issues on repos it doesn't own (see §5c.2): it detects
 * and links existing consent; it never fabricates new consent. This module is
 * read-only matching + reference formatting — there is deliberately no
 * "create issue" function for external repos.
 */

import type { RepoIssue } from '@/lib/github/types'

const DEP_LABELS = new Set(['dependencies', 'deps', 'dependency'])
const UPGRADE_RE = /\b(upgrade|update|bump|stale|outdated|out[- ]?of[- ]?date)\b/i
const DEPS_WORD_RE = /\bdependenc/i

/**
 * Pick the best existing open issue to link a given dependency's PR to. Pure.
 * Prefers an issue that names THIS dependency + an upgrade intent; falls back
 * to a general "upgrade dependencies"/`dependencies`-labelled umbrella issue.
 * Returns null when nothing relevant is open (→ PR opens without a link).
 */
export function pickIssueForDep(issues: RepoIssue[], depName: string): RepoIssue | null {
  if (issues.length === 0) return null
  const depLower = depName.toLowerCase()

  let depSpecific: RepoIssue | null = null
  let general: RepoIssue | null = null

  for (const iss of issues) {
    const hay = `${iss.title}\n${iss.body ?? ''}`.toLowerCase()
    const labelHit = iss.labels.some((l) => DEP_LABELS.has(l.toLowerCase()))
    const mentionsDep = hay.includes(depLower)
    const upgradeIntent = UPGRADE_RE.test(iss.title)
    const aboutDeps = labelHit || DEPS_WORD_RE.test(iss.title)

    if (!depSpecific && mentionsDep && (upgradeIntent || labelHit)) depSpecific = iss
    if (!general && aboutDeps && (upgradeIntent || labelHit)) general = iss
  }
  return depSpecific ?? general
}

/**
 * Format the PR-body reference. Owned repo → "Closes #N" (auto-closes the issue
 * on merge — fine, it's your issue). External repo → "Addresses #N" (links
 * without presumptuously auto-closing a maintainer's issue — they decide).
 */
export function formatIssueReference(issue: RepoIssue, ownsRepo: boolean): string {
  const verb = ownsRepo ? 'Closes' : 'Addresses'
  return `${verb} #${issue.number} — ${issue.title}`
}
