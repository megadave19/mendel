export type PackageManager = 'pnpm' | 'npm' | 'yarn'

export interface SandboxConfig {
  repoPath: string
  scanId: string
  packageManager: PackageManager
  phaseATimeoutMs?: number
  phaseBTimeoutMs?: number
  /** Use --frozen-lockfile (true) or --no-frozen-lockfile (false, default for post-patch verify) */
  frozenLockfile?: boolean
  /**
   * v1.5 W#8 — Iptables allowlist for Phase A. When omitted, the default
   * tier-1 list is used by buildAllowlist(). When supplied, this is the
   * already-built {hosts} array from `buildAllowlist({tier2: ...})`. Empty
   * array → leave bridge network open (v1.0 back-compat).
   */
  allowlistHosts?: string[]
}

export interface SandboxPhaseResult {
  phase: 'A' | 'B'
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

export interface SandboxRunResult {
  phaseA: PhaseAResult
  phaseB: PhaseBResult | null
  volumeCleanedUp: boolean
}
