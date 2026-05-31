export type PackageManager = 'pnpm' | 'npm' | 'yarn'

/**
 * v2.0 / F20 — Phase C (smoke) opt-in config. When omitted entirely, smoke is
 * disabled and SmokeResult.attempted=false. When `enabled=true` BUT no boot
 * command is detected, SmokeResult is still `attempted=false` + a clear reason
 * — never a fake-green "booted" (CLAUDE.md §5b: honest by construction).
 */
export interface SmokeConfig {
  enabled: boolean
  /** Explicit boot command. When omitted, smoke.ts heuristics detect one. */
  command?: string
  /** Substring (e.g. "listening on port") that signals a successful boot. */
  readyPattern?: string
  /** Hard timeout — capped at 90s by the sandbox per CLAUDE.md §5 rule 16. */
  timeoutMs?: number
}

export interface SandboxConfig {
  repoPath: string
  scanId: string
  packageManager: PackageManager
  phaseATimeoutMs?: number
  phaseBTimeoutMs?: number
  phaseCTimeoutMs?: number
  /** Use --frozen-lockfile (true) or --no-frozen-lockfile (false, default for post-patch verify) */
  frozenLockfile?: boolean
  /**
   * v1.5 W#8 — Iptables allowlist for Phase A. When omitted, the default
   * tier-1 list is used by buildAllowlist(). When supplied, this is the
   * already-built {hosts} array from `buildAllowlist({tier2: ...})`. Empty
   * array → leave bridge network open (v1.0 back-compat).
   */
  allowlistHosts?: string[]
  /** v2.0 / F20 — Phase C smoke-test opt-in. Omit ⇒ disabled. */
  smokeTest?: SmokeConfig
}

export interface SandboxPhaseResult {
  phase: 'A' | 'B' | 'C'
  success: boolean
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

export interface PhaseAResult extends SandboxPhaseResult {
  phase: 'A'
  volumeName: string
}

export interface PhaseBResult extends SandboxPhaseResult {
  phase: 'B'
  typecheckPassed: boolean
  testsPassed: boolean
}

/**
 * v2.0 / F20 — Phase C result. The shape is honest by construction:
 *  - `attempted=false` (no command detected, or smoke disabled) → no
 *    inferences about boot success allowed downstream.
 *  - `attempted=true, booted=false` → real failure (crash, timeout, or
 *    no ready signal within the window).
 *  - `attempted=true, booted=true`  → real success: ready signal observed
 *    OR clean exit within the window (depends on `readySignal` reason).
 *
 * `reason` is the human-readable line UI + score.ts use to explain why.
 */
export type SmokeBootReason =
  | 'ready-pattern-matched'
  | 'clean-exit'
  | 'crashed-non-zero-exit'
  | 'timed-out'
  | 'no-boot-command-detected'
  | 'smoke-disabled'

export interface PhaseCResult extends SandboxPhaseResult {
  phase: 'C'
  attempted: boolean
  booted: boolean
  reason: SmokeBootReason
  /** Boot command that was actually executed (empty when not attempted). */
  command: string
  /** Tail of stdout+stderr for the issue card body (≤ 2000 chars). */
  logTail: string
}

export interface SandboxRunResult {
  phaseA: PhaseAResult
  phaseB: PhaseBResult | null
  phaseC: PhaseCResult | null
  volumeCleanedUp: boolean
}
