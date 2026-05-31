/**
 * Tests for lib/agent/eligibility-preview.ts — the pre-scan eligibility verdict
 * shown on /scan/new. Mirrors the scan-time gate (lib/agent/eligibility.ts) but
 * reads via GitHub API instead of from a clone.
 *
 * Coverage: pure red-flag detection, pure linkable-issue picking, and the
 * `previewEligibility` integration across the four real-world outcomes:
 *   owned · external+welcome · blocked-by-dependabot · blocked-by-CONTRIBUTING
 * Plus the degraded-but-not-broken fail-soft path that CLAUDE §5c.1 requires.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoist + return a fresh mock per test so we don't carry state between cases.
const mockGetContent = vi.fn()
const mockGetRepo = vi.fn()
const mockListIssues = vi.fn()

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      repos: {
        get: mockGetRepo,
        getContent: mockGetContent,
      },
      issues: {
        listForRepo: mockListIssues,
      },
    },
  })),
}))

import {
  previewEligibility,
  findRedFlag,
  pickLinkableIssue,
} from '@/lib/agent/eligibility-preview'

beforeEach(() => {
  mockGetContent.mockReset()
  mockGetRepo.mockReset()
  mockListIssues.mockReset()
})

// Helpers — Octokit's getContent returns base64; emulate that.
const file = (text: string) => ({
  data: { content: Buffer.from(text).toString('base64'), encoding: 'base64' },
})
const notFound = () => Promise.reject(Object.assign(new Error('not found'), { status: 404 }))

// Default: every governance lookup 404s, repo.get returns no push, no issues.
function wireEmptyRepo(opts?: { canPush?: boolean }) {
  mockGetRepo.mockResolvedValue({ data: { permissions: { push: opts?.canPush ?? false } } })
  mockGetContent.mockImplementation(() => notFound())
  mockListIssues.mockResolvedValue({ data: [] })
}

describe('findRedFlag — CONTRIBUTING phrase detection', () => {
  it('catches "open an issue first"', () => {
    expect(findRedFlag('Please open an issue first before submitting a PR.')).toMatch(/open an issue first/i)
  })
  it('catches "no dependency PRs"', () => {
    expect(findRedFlag('We accept no dependency-bump PRs from outside contributors.')).toMatch(/no .*dependenc/i)
  })
  it('catches "discuss before submitting a pr"', () => {
    expect(findRedFlag('Please discuss the change before submitting a PR.')).toMatch(/discuss.*before.*pr/i)
  })
  it("doesn't false-positive on clean CONTRIBUTING", () => {
    expect(findRedFlag('Thanks for your interest. Please run pnpm test before opening a PR.')).toBeNull()
  })
})

describe('pickLinkableIssue — read-only consent detection', () => {
  it("picks an issue with a 'dependencies' label", () => {
    const got = pickLinkableIssue([
      { number: 1, title: 'Bug in X', url: 'u1', labels: ['bug'] },
      { number: 2, title: 'Update deps', url: 'u2', labels: ['dependencies'] },
    ])
    expect(got?.number).toBe(2)
  })
  it("matches a title that asks to 'upgrade dependencies' even without label", () => {
    const got = pickLinkableIssue([
      { number: 7, title: 'Please upgrade outdated packages', url: 'u7', labels: ['help wanted'] },
    ])
    expect(got?.number).toBe(7)
  })
  it("matches case-insensitively (e.g. 'Deps' label)", () => {
    const got = pickLinkableIssue([
      { number: 5, title: 'Upkeep', url: 'u5', labels: ['Deps'] },
    ])
    expect(got?.number).toBe(5)
  })
  it('returns null when nothing matches', () => {
    expect(pickLinkableIssue([
      { number: 1, title: 'Refactor auth', url: 'u', labels: ['bug'] },
    ])).toBeNull()
  })
  it("doesn't synth a match from a vague title (e.g. 'update README')", () => {
    expect(pickLinkableIssue([
      { number: 1, title: 'update README', url: 'u', labels: ['docs'] },
    ])).toBeNull()
  })
})

describe('previewEligibility — full integration', () => {
  it("returns 'owned' when the PAT has push access (no ack needed)", async () => {
    wireEmptyRepo({ canPush: true })
    const out = await previewEligibility('pat', 'me', 'mine')
    expect(out.decision).toBe('owned')
    expect(out.signals.ownsRepo).toBe(true)
    expect(out.ackNeeded).toBe(false)
    expect(out.canOpenPRsIfAcknowledged).toBe(true)
  })

  it("returns 'external' (welcome with ack) for a non-owned, clean repo", async () => {
    wireEmptyRepo({ canPush: false })
    const out = await previewEligibility('pat', 'someone', 'else')
    expect(out.decision).toBe('external')
    // Without ack → can't open PRs yet. WITH ack → can. Therefore ack is the lever.
    expect(out.canOpenPRsIfAcknowledged).toBe(true)
    expect(out.ackNeeded).toBe(true)
  })

  it("returns 'blocked' when .github/dependabot.yml exists — ack can't override", async () => {
    mockGetRepo.mockResolvedValue({ data: { permissions: { push: false } } })
    mockListIssues.mockResolvedValue({ data: [] })
    // First two CONTRIBUTING lookups 404; dependabot path returns content.
    mockGetContent.mockImplementation(({ path }: { path: string }) => {
      if (path === '.github/dependabot.yml') return Promise.resolve(file('version: 2'))
      return notFound()
    })
    const out = await previewEligibility('pat', 'someone', 'automated')
    expect(out.decision).toBe('blocked')
    expect(out.signals.depAutomation).toBe('dependabot')
    expect(out.canOpenPRsIfAcknowledged).toBe(false) // even WITH ack, blocked stays blocked
    expect(out.ackNeeded).toBe(false)
  })

  it("returns 'blocked' when CONTRIBUTING has a red-flag", async () => {
    mockGetRepo.mockResolvedValue({ data: { permissions: { push: false } } })
    mockListIssues.mockResolvedValue({ data: [] })
    mockGetContent.mockImplementation(({ path }: { path: string }) => {
      if (path === 'CONTRIBUTING.md') {
        return Promise.resolve(file('Please open an issue first before submitting a PR.'))
      }
      return notFound()
    })
    const out = await previewEligibility('pat', 'someone', 'strict')
    expect(out.decision).toBe('blocked')
    expect(out.signals.contributingRedFlag).toMatch(/open an issue first/i)
    expect(out.canOpenPRsIfAcknowledged).toBe(false)
  })

  it('attaches a linkable issue when one exists (and the repo is not blocked)', async () => {
    mockGetRepo.mockResolvedValue({ data: { permissions: { push: false } } })
    mockGetContent.mockImplementation(() => notFound())
    mockListIssues.mockResolvedValue({
      data: [
        { number: 98, title: 'Upgrade dependencies', html_url: 'https://x/98', labels: [{ name: 'dependencies' }], pull_request: undefined },
      ],
    })
    const out = await previewEligibility('pat', 'ta-vivo', 'ta-vivo')
    expect(out.linkableIssue).toEqual({ number: 98, title: 'Upgrade dependencies', url: 'https://x/98' })
  })

  it('skips issue lookup entirely when the repo is hard-blocked (no point)', async () => {
    mockGetRepo.mockResolvedValue({ data: { permissions: { push: false } } })
    mockGetContent.mockImplementation(({ path }: { path: string }) => {
      if (path === '.github/dependabot.yml') return Promise.resolve(file('version: 2'))
      return notFound()
    })
    // listIssues should never be called when blocked — assert by failing if it is.
    mockListIssues.mockImplementation(() => { throw new Error('listIssues should not be called for blocked repos') })
    const out = await previewEligibility('pat', 'someone', 'blocked')
    expect(out.decision).toBe('blocked')
    expect(out.linkableIssue).toBeNull()
  })

  it("degrades gracefully when repo.get errors (treats as 'external', degraded:true)", async () => {
    mockGetRepo.mockRejectedValue(Object.assign(new Error('auth'), { status: 401 }))
    mockGetContent.mockImplementation(() => notFound())
    mockListIssues.mockResolvedValue({ data: [] })
    const out = await previewEligibility('pat', 'someone', 'opaque')
    expect(out.degraded).toBe(true)
    expect(out.signals.ownsRepo).toBe(false)
    // Safe default: treated as external (least-privilege) — never silently 'owned'.
    expect(out.decision).toBe('external')
  })

  it('does not bypass blocking just because the repo read degraded', async () => {
    // Even if we can't tell ownership, a dependabot file we DO see still blocks.
    mockGetRepo.mockRejectedValue(Object.assign(new Error('auth'), { status: 403 }))
    mockListIssues.mockResolvedValue({ data: [] })
    mockGetContent.mockImplementation(({ path }: { path: string }) => {
      if (path === '.github/dependabot.yml') return Promise.resolve(file('version: 2'))
      return notFound()
    })
    const out = await previewEligibility('pat', 'someone', 'opaque-but-automated')
    expect(out.decision).toBe('blocked')
    expect(out.degraded).toBe(true)
  })
})
