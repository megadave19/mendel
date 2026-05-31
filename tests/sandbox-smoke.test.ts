/**
 * Tests for lib/sandbox/smoke.ts — Phase C (v2.0 / F20).
 *
 * The pure parts (detectBootCommand, detectReadySignal, resolvePhaseCReason,
 * buildPhaseCDockerCommand) are exhaustively tested here. The Docker-running
 * part (runPhaseC) gets a real-container test gated behind DOCKER_INTEGRATION
 * in a separate file — that's the §11b.1 "never trust shipped Docker code
 * until a real container ran it" rule.
 *
 * Honesty assertions baked in:
 *   - no boot command → attempted=false (never silently green)
 *   - smoke disabled → attempted=false
 *   - timeout while running → booted=false, reason='timed-out'
 *   - non-zero exit → booted=false, reason='crashed-non-zero-exit'
 *   - Phase C MUST use --network=none in the built command
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  detectBootCommand,
  detectReadySignal,
  resolvePhaseCReason,
  buildPhaseCDockerCommand,
  runPhaseC,
} from '@/lib/sandbox/smoke'
import type { SandboxConfig } from '@/lib/sandbox/types'

// ── detectBootCommand ─────────────────────────────────────────────────────────

describe('detectBootCommand — priority + fallback chain', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mendel-smoke-'))
  })

  function writePkg(json: object) {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(json))
  }

  it('prefers scripts.start over dev/serve', () => {
    writePkg({ scripts: { start: 'node server.js', serve: 'x', dev: 'y' } })
    expect(detectBootCommand(dir, 'pnpm')).toBe('pnpm run start')
  })

  it('falls back to scripts.serve when start is missing', () => {
    writePkg({ scripts: { serve: 'node server.js', dev: 'y' } })
    expect(detectBootCommand(dir, 'npm')).toBe('npm run serve')
  })

  it('falls back to scripts.dev when start/serve are missing', () => {
    writePkg({ scripts: { dev: 'nodemon' } })
    expect(detectBootCommand(dir, 'yarn')).toBe('yarn run dev')
  })

  it('uses bin (string form) when no boot scripts exist', () => {
    writePkg({ bin: './cli.js' })
    expect(detectBootCommand(dir, 'pnpm')).toBe('node ./cli.js')
  })

  it('uses the first bin entry when bin is an object map', () => {
    writePkg({ bin: { mybin: './cli.js', other: './x.js' } })
    expect(detectBootCommand(dir, 'pnpm')).toBe('node ./cli.js')
  })

  it('falls back to main when there is no script and no bin', () => {
    writePkg({ main: 'dist/index.js' })
    expect(detectBootCommand(dir, 'pnpm')).toBe('node dist/index.js')
  })

  it("returns null when nothing is detectable (never silent 'green')", () => {
    writePkg({ name: 'lib-only', version: '1.0.0' })
    expect(detectBootCommand(dir, 'pnpm')).toBeNull()
  })

  it('returns null when package.json is missing entirely', () => {
    expect(detectBootCommand(dir, 'pnpm')).toBeNull()
  })

  it("DOES NOT pick test/build/lint scripts (those aren't boots)", () => {
    writePkg({ scripts: { test: 'vitest', build: 'tsc', lint: 'eslint' } })
    expect(detectBootCommand(dir, 'pnpm')).toBeNull()
  })

  it('returns null on a corrupt package.json (never crashes the scan)', () => {
    writeFileSync(path.join(dir, 'package.json'), '{not json')
    expect(detectBootCommand(dir, 'pnpm')).toBeNull()
  })

  // Tear down between tests
  // (vitest beforeEach replaces `dir` each run; we don't manually rm because
  // tmp dirs get reclaimed and the test set is tiny)
})

// ── detectReadySignal ─────────────────────────────────────────────────────────

describe('detectReadySignal — substring match (case-insensitive)', () => {
  it("matches the caller-supplied pattern exactly (case-insensitive)", () => {
    expect(detectReadySignal('Server READY at port 3000', 'server ready')).toBe(true)
    expect(detectReadySignal('something else', 'server ready')).toBe(false)
  })

  it('falls back to defaults when no pattern is supplied — finds common phrases', () => {
    expect(detectReadySignal('Listening on port 3000', undefined)).toBe(true)
    expect(detectReadySignal('Server running on http://localhost:8080', undefined)).toBe(true)
    expect(detectReadySignal('ready at /api', undefined)).toBe(true)
  })

  it('returns false on output with no ready phrase (default set)', () => {
    expect(detectReadySignal('starting...\nloading config...', undefined)).toBe(false)
  })
})

// ── resolvePhaseCReason — the §5b honesty truth table ────────────────────────

describe('resolvePhaseCReason — honest mapping from run signals to (booted, reason)', () => {
  it("ready-pattern match WINS over everything (still booted even if eventually crashed)", () => {
    const out = resolvePhaseCReason({
      timedOut: false, exitCode: 1, stdout: 'Listening on port 3000\n<later crash>',
      readyPattern: undefined,
    })
    expect(out).toEqual({ booted: true, reason: 'ready-pattern-matched' })
  })

  it('clean exit (code 0) without ready signal = booted=true, reason=clean-exit (short CLIs)', () => {
    const out = resolvePhaseCReason({ timedOut: false, exitCode: 0, stdout: 'done', readyPattern: undefined })
    expect(out).toEqual({ booted: true, reason: 'clean-exit' })
  })

  it('non-zero exit without ready signal = booted=false, reason=crashed-non-zero-exit', () => {
    const out = resolvePhaseCReason({ timedOut: false, exitCode: 1, stdout: 'Error: …', readyPattern: undefined })
    expect(out).toEqual({ booted: false, reason: 'crashed-non-zero-exit' })
  })

  it("timeout while still running = booted=false, reason=timed-out (NEVER silent 'booted')", () => {
    const out = resolvePhaseCReason({ timedOut: true, exitCode: 1, stdout: 'starting...', readyPattern: undefined })
    expect(out).toEqual({ booted: false, reason: 'timed-out' })
  })

  it("timeout BUT ready signal was seen in captured output = booted=true (a server CAN behave this way)", () => {
    const out = resolvePhaseCReason({ timedOut: true, exitCode: 1, stdout: 'Listening on port 3000', readyPattern: undefined })
    expect(out).toEqual({ booted: true, reason: 'ready-pattern-matched' })
  })
})

// ── buildPhaseCDockerCommand — security/honesty invariants ───────────────────

describe('buildPhaseCDockerCommand — locked Docker flags', () => {
  const built = buildPhaseCDockerCommand({
    repoPath: '/tmp/repo with spaces',
    vol: 'mendel-nm-scan-x',
    bootCommand: 'pnpm run start',
  })

  it('runs --network=none (CLAUDE.md §5 rule 16 — Phase C NEVER granted egress)', () => {
    expect(built).toContain('--network=none')
    expect(built).not.toContain('--network=bridge')
  })

  it('caps memory and runs non-root', () => {
    expect(built).toContain('--memory=2g')
    expect(built).toContain('--user=node')
  })

  it('bypasses the image ENTRYPOINT with --entrypoint=sh (real-container test caught su-exec failure under --user=node)', () => {
    expect(built).toContain('--entrypoint=sh')
  })

  it('removes the container after run (--rm) — no leftover state per CLAUDE §5 rule 11', () => {
    expect(built).toContain('--rm')
  })

  it('mounts the repo + install volume', () => {
    expect(built).toContain('"/tmp/repo with spaces:/repo"')
    expect(built).toContain('"mendel-nm-scan-x:/repo/node_modules"')
  })

  it('shell-quotes the boot command via shArg (no metachar injection)', () => {
    // With --entrypoint=sh, the trailing arg is just `-c '<cmd>'` (no leading `sh`).
    expect(built).toMatch(/-c 'pnpm run start'/)
  })
})

// ── runPhaseC (mocked exec) — assert the not-attempted paths ─────────────────

// Mock node:child_process so we don't actually launch Docker.
const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
}))
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return { ...actual, exec: mocks.exec }
})

const SAMPLE: SandboxConfig = {
  repoPath: '/tmp/nonexistent-repo-for-test',
  scanId: 'scan-x',
  packageManager: 'pnpm',
}

describe('runPhaseC — opt-in + no-fake-green branches', () => {
  beforeEach(() => { mocks.exec.mockReset() })

  it("returns attempted=false reason=smoke-disabled when smokeTest is omitted", async () => {
    const r = await runPhaseC(SAMPLE, 'vol-x')
    expect(r.attempted).toBe(false)
    expect(r.booted).toBe(false)
    expect(r.reason).toBe('smoke-disabled')
    expect(r.success).toBe(false) // NOT a pass — §5b
    expect(mocks.exec).not.toHaveBeenCalled()
  })

  it("returns attempted=false reason=smoke-disabled when smokeTest.enabled=false", async () => {
    const r = await runPhaseC({ ...SAMPLE, smokeTest: { enabled: false } }, 'vol-x')
    expect(r.attempted).toBe(false)
    expect(r.reason).toBe('smoke-disabled')
    expect(mocks.exec).not.toHaveBeenCalled()
  })

  it("returns attempted=false reason=no-boot-command-detected when there's no package.json", async () => {
    const r = await runPhaseC({ ...SAMPLE, smokeTest: { enabled: true } }, 'vol-x')
    expect(r.attempted).toBe(false)
    expect(r.reason).toBe('no-boot-command-detected')
    expect(r.command).toBe('')
    expect(mocks.exec).not.toHaveBeenCalled()
  })
})
