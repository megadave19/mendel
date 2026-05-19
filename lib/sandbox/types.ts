export type PackageManager = 'pnpm' | 'npm' | 'yarn'

export interface SandboxConfig {
  repoPath: string
  scanId: string
  packageManager: PackageManager
  phaseATimeoutMs?: number
  phaseBTimeoutMs?: number
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
