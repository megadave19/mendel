/**
 * Tests for issue-linking (CLAUDE.md §5c.2). Mendel links a PR to an EXISTING
 * maintainer-opened issue (consent already exists); it never creates issues on
 * repos it doesn't own. Pure matcher + reference formatter.
 */

import { describe, it, expect } from 'vitest'
import { pickIssueForDep, formatIssueReference } from '@/lib/agent/issue-link'
import type { RepoIssue } from '@/lib/github/types'

const iss = (number: number, title: string, labels: string[] = [], body = ''): RepoIssue => ({
  number, title, labels, body, url: `https://github.com/o/r/issues/${number}`,
})

describe('pickIssueForDep', () => {
  it('prefers a dep-specific upgrade issue over a general one', () => {
    const issues = [
      iss(10, 'Upgrade dependencies', ['dependencies']),
      iss(11, 'Bump axios to v1 — breaking changes'),
    ]
    expect(pickIssueForDep(issues, 'axios')?.number).toBe(11)
  })

  it('falls back to a general "upgrade dependencies" umbrella issue (the ta-vivo #98 case)', () => {
    const issues = [iss(98, 'Upgrade dependencies', ['enhancement', 'help wanted', 'good first issue', 'dependencies'])]
    expect(pickIssueForDep(issues, 'vuex')?.number).toBe(98)
  })

  it('matches via the `dependencies` label even without keyword in title', () => {
    const issues = [iss(5, 'Maintenance pass', ['dependencies'])]
    expect(pickIssueForDep(issues, 'lodash')?.number).toBe(5)
  })

  it('returns null when no issue is dependency-related', () => {
    const issues = [iss(1, 'Add dark mode', ['feature']), iss(2, 'Fix login bug', ['bug'])]
    expect(pickIssueForDep(issues, 'react')).toBeNull()
  })

  it('returns null for an empty issue list', () => {
    expect(pickIssueForDep([], 'anything')).toBeNull()
  })

  it('does not false-match an unrelated "upgrade" issue with no deps signal', () => {
    // "upgrade the docs" — upgrade intent but not about dependencies
    const issues = [iss(7, 'Upgrade the onboarding docs', ['documentation'])]
    expect(pickIssueForDep(issues, 'express')).toBeNull()
  })
})

describe('formatIssueReference', () => {
  it('owned repo → "Closes #N" (auto-closes your own issue on merge)', () => {
    expect(formatIssueReference(iss(98, 'Upgrade dependencies'), true)).toBe('Closes #98 — Upgrade dependencies')
  })
  it('external repo → "Addresses #N" (links without presuming to close a maintainer\'s issue)', () => {
    expect(formatIssueReference(iss(98, 'Upgrade dependencies'), false)).toBe('Addresses #98 — Upgrade dependencies')
  })
})
