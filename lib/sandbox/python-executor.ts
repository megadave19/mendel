/**
 * v2.2 / F23a — Python sandbox executor.
 *
 * Minimal docker-shell wrapper for the griffe semantic-diff. Mirrors the
 * pattern of lib/sandbox/executor.ts (ensure image → run container with
 * non-root + memory cap + timeout), but ISOLATED in its own module so
 * the existing Node sandbox stays untouched. v2.3+ will fold Python into
 * the unified SandboxProvider interface; v2.2.x ships it adjacent.
 *
 * §11b.1 honored: image-build + every command uses execFile (no shell),
 * CLAUDE.md §5 rule 18.
 */

import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** Image tag the Python adapter declares + that this module builds. */
export const PYTHON_IMAGE_NAME = 'mendel-python-sandbox:v2.2'

/** Hard cap on griffe runtime — installing two PyPI versions + walking. */
const GRIFFE_TIMEOUT_MS = 90_000
const MEMORY_CAP = '2g'

// ── Image existence + build ───────────────────────────────────────────────────

/** True when the named tag is in the local Docker daemon. */
export async function pythonImageExists(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('docker', ['images', '-q', PYTHON_IMAGE_NAME], { timeout: 10_000 })
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Build the Python sandbox image if it doesn't already exist. Idempotent.
 * Errors are NOT swallowed — the adapter that calls this needs to decide
 * whether to honest-fallback to the stub.
 */
export async function ensurePythonSandboxImage(): Promise<void> {
  if (await pythonImageExists()) return
  const dockerfileDir = path.resolve(process.cwd(), 'docker')
  const dockerfilePath = path.join(dockerfileDir, 'python-sandbox.Dockerfile')
  console.log('[python-sandbox] Building image — one-time setup, takes ~60s...')
  await execFileAsync(
    'docker',
    ['build', '-f', dockerfilePath, '-t', PYTHON_IMAGE_NAME, dockerfileDir],
    { timeout: 10 * 60 * 1000 },
  )
  console.log('[python-sandbox] Image built.')
}

// ── griffe diff invocation ────────────────────────────────────────────────────

/** Honest shape returned by the inside-container Python script. */
export interface GriffeDiffOutput {
  tier: 'griffe'
  removedExports: string[]
  signatureChanges: Array<{ symbol: string; before: string; after: string }>
  newDeprecations: string[]
  unanalyzableSymbols: Array<{ symbol: string; reason: string }>
}

/**
 * Run the griffe-diff script inside the Python sandbox image. Returns the
 * parsed JSON output on success. Throws with a captured stderr tail on
 * failure so the adapter can put the cause in `unanalyzableSymbols`.
 *
 * Network mode: `--network=bridge`. The script needs PyPI access to
 * pip-install both versions. v2.2.x doesn't yet apply the iptables
 * allowlist used by the Node Phase A — adding it is tracked as the
 * "Python parity with Node sandbox" follow-on (CLAUDE.md §5 rule 12
 * still wants default-deny once the image's entrypoint matures).
 */
export async function runGriffeDiff(
  packageName: string,
  fromVersion: string,
  toVersion: string,
): Promise<GriffeDiffOutput> {
  const dockerArgs = [
    'run', '--rm',
    '--network=bridge',
    `--memory=${MEMORY_CAP}`,
    // v2.2.x polish — iptables egress allowlist INFRASTRUCTURE parity
    // with the Node sandbox (CLAUDE.md §5 r12). The image now ships
    // iptables + the entrypoint hook + gosu drop-to-user; the runtime
    // ALLOWLIST is supplied by the caller, mirroring the Node sandbox
    // contract where `buildAllowlist()` produces a user-tunable host
    // list. When the env var is empty (the default below — the §11b.1
    // tests showed that hardcoding a tight allowlist breaks pip's
    // dynamic CDN routing), the entrypoint logs + leaves bridge open
    // (back-compat with pre-polish behavior). Operators who want
    // filtering can supply `MENDEL_PYTHON_ALLOWLIST` via env or
    // upgrade this to read from a per-scan setting.
    '--cap-add=NET_ADMIN',
    '-e', `MENDEL_ALLOWLIST=${process.env.MENDEL_PYTHON_ALLOWLIST ?? ''}`,
    // The image's entrypoint drops to the mendel user via gosu after
    // applying iptables; we don't pass --user here.
    PYTHON_IMAGE_NAME,
    'griffe-diff',
    packageName,
    fromVersion,
    toVersion,
  ]
  let stdout: string
  try {
    const out = await execFileAsync('docker', dockerArgs, { timeout: GRIFFE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })
    stdout = out.stdout
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; signal?: string }
    const tail = (e.stderr ?? e.stdout ?? String(err)).slice(-800)
    const reason = e.killed ? `timed out after ${GRIFFE_TIMEOUT_MS / 1000}s` : `exited non-zero: ${tail}`
    throw new Error(`griffe-diff failed (${reason})`)
  }
  try {
    return JSON.parse(stdout.trim()) as GriffeDiffOutput
  } catch (err) {
    throw new Error(`griffe-diff returned non-JSON output: ${stdout.slice(-400)} (parse error: ${(err as Error).message})`)
  }
}
