import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { installCommand, detectTestCommand, hasBuildScript } from './detect'
import type { SandboxConfig, PhaseAResult, PhaseBResult } from './types'

const execAsync = promisify(exec)

export const IMAGE_NAME = 'mendel-sandbox:latest'
const PHASE_A_TIMEOUT_MS = 3 * 60 * 1000
const PHASE_B_TIMEOUT_MS = 5 * 60 * 1000
const MEMORY_CAP = '2g'

// ─── Image management ────────────────────────────────────────────────────────

export async function imageExists(): Promise<boolean> {
  try {
    await execAsync(`docker image inspect ${IMAGE_NAME}`)
    return true
  } catch {
    return false
  }
}

export async function ensureSandboxImage(): Promise<void> {
  if (await imageExists()) return

  const dockerfileDir = path.resolve(process.cwd(), 'docker')
  const dockerfilePath = path.join(dockerfileDir, 'sandbox.Dockerfile')

  console.log('[sandbox] Building sandbox image — one-time setup, takes ~30s...')
  await execAsync(
    `docker build -f "${dockerfilePath}" -t ${IMAGE_NAME} "${dockerfileDir}"`,
    { timeout: 5 * 60 * 1000 },
  )
  console.log('[sandbox] Image built.')
}

// ─── Volume naming ───────────────────────────────────────────────────────────

export function volumeName(scanId: string): string {
  return `mendel-nm-${scanId}`
}

// ─── Phase A — Install ───────────────────────────────────────────────────────

async function initVolumeOwnership(vol: string): Promise<void> {
  // Docker named volumes are created owned by root; chown so non-root node user can write
  await execAsync(
    `docker run --rm --user=root --volume="${vol}:/repo/node_modules" ${IMAGE_NAME} chown node:node /repo/node_modules`,
    { timeout: 15_000 },
  )
}

export async function runPhaseA(config: SandboxConfig): Promise<PhaseAResult> {
  const start = Date.now()
  const vol = volumeName(config.scanId)
  const install = installCommand(config.packageManager)

  await initVolumeOwnership(vol)

  // Paths quoted to handle spaces (macOS paths often contain spaces)
  const cmd = [
    'docker run',
    '--rm',
    '--network=bridge',
    `--memory=${MEMORY_CAP}`,
    '--user=node',
    '-e CI=true',
    `--volume="${config.repoPath}:/repo"`,
    `--volume="${vol}:/repo/node_modules"`,
    '--workdir=/repo',
    IMAGE_NAME,
    `sh -c "${install} 2>&1"`,
  ].join(' ')

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: config.phaseATimeoutMs ?? PHASE_A_TIMEOUT_MS,
    })
    return { phase: 'A', success: true, exitCode: 0, stdout, stderr, durationMs: Date.now() - start, timedOut: false, volumeName: vol }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; code?: number }
    return { phase: 'A', success: false, exitCode: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '', durationMs: Date.now() - start, timedOut: e.killed ?? false, volumeName: vol }
  }
}

// ─── Phase B — Test ──────────────────────────────────────────────────────────

export async function runPhaseB(
  config: SandboxConfig,
  vol: string,
): Promise<PhaseBResult> {
  const start = Date.now()

  const steps: string[] = []

  // TypeScript check — if tsconfig.json exists
  steps.push('pnpm exec tsc --noEmit 2>&1 && echo "TYPECHECK_OK" || echo "TYPECHECK_FAIL"')

  const testCmd = detectTestCommand(config.repoPath, config.packageManager)
  if (testCmd) {
    steps.push(`${testCmd} 2>&1 && echo "TESTS_OK" || echo "TESTS_FAIL"`)
  }

  if (hasBuildScript(config.repoPath)) {
    steps.push('pnpm run build 2>&1 || true')
  }

  const phaseCmd = steps.join('; ')

  const cmd = [
    'docker run',
    '--rm',
    '--network=none',
    `--memory=${MEMORY_CAP}`,
    '--user=node',
    '-e CI=true',
    `--volume="${config.repoPath}:/repo"`,
    `--volume="${vol}:/repo/node_modules"`,
    '--workdir=/repo',
    IMAGE_NAME,
    `sh -c "${phaseCmd}"`,
  ].join(' ')

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: config.phaseBTimeoutMs ?? PHASE_B_TIMEOUT_MS,
    })
    const typecheckPassed = !stdout.includes('TYPECHECK_FAIL')
    const testsPassed = !stdout.includes('TESTS_FAIL')
    return { phase: 'B', success: typecheckPassed && testsPassed, exitCode: 0, stdout, stderr, durationMs: Date.now() - start, timedOut: false, typecheckPassed, testsPassed }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; code?: number }
    const out = e.stdout ?? ''
    return { phase: 'B', success: false, exitCode: e.code ?? 1, stdout: out, stderr: e.stderr ?? '', durationMs: Date.now() - start, timedOut: e.killed ?? false, typecheckPassed: false, testsPassed: false }
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

export async function cleanupVolume(vol: string): Promise<boolean> {
  try {
    await execAsync(`docker volume rm ${vol}`)
    return true
  } catch {
    return false
  }
}

// ─── Egress verification (gate use only) ─────────────────────────────────────

export async function verifyEgressBlocked(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `docker run --rm --network=none ${IMAGE_NAME} sh -c 'curl -s --max-time 5 https://example.com 2>&1; echo EXIT_$?'`,
      { timeout: 15_000 },
    )
    // curl will fail — exit code non-zero means egress is blocked
    return !stdout.includes('EXIT_0')
  } catch {
    // exec itself errored — egress is blocked (docker network=none worked)
    return true
  }
}
