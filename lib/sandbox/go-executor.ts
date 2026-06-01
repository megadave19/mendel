/**
 * v2.2 / F23b — Go sandbox executor (foundation).
 *
 * Mirrors lib/sandbox/python-executor.ts. THIS module ships the image-
 * existence + image-build helpers + the apidiff invocation function as a
 * stub that throws "image not built." The real Docker integration (an
 * `mendel-go-sandbox:v2.2` image built from `golang:1.x-slim` + precompiled
 * apidiff binary) lands in the F23b sub-phase 2 commit, gated by the same
 * §11b.1 real-container test pattern that caught the case-sensitive
 * substring + COPY path bugs in F23a.
 *
 * §11b.1 honored from day one: image-build + every command goes through
 * execFile (no shell — CLAUDE.md §5 rule 18).
 */

import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** Image tag the Go adapter declares + that this module will build in sub-phase 2. */
export const GO_IMAGE_NAME = 'mendel-go-sandbox:v2.2'

/** Hard cap on apidiff runtime — `go install` of two versions + walk. */
const APIDIFF_TIMEOUT_MS = 120_000
const MEMORY_CAP = '2g'

// ── Image existence + build ───────────────────────────────────────────────────

/** True when the named tag is in the local Docker daemon. */
export async function goImageExists(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('docker', ['images', '-q', GO_IMAGE_NAME], { timeout: 10_000 })
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

/**
 * Build the Go sandbox image if it doesn't already exist. Idempotent.
 *
 * Sub-phase 1 (this commit): the Dockerfile doesn't exist yet, so this
 * function throws cleanly with the path it would build from. The Go
 * adapter's `semanticDiff` catches that and routes through the same
 * honest-fallback path used when Docker is down — §5b never silently
 * degrades. Sub-phase 2 will land `docker/go-sandbox.Dockerfile`.
 *
 * Errors are NOT swallowed — the adapter that calls this needs to decide
 * whether to honest-fallback to the stub.
 */
export async function ensureGoSandboxImage(): Promise<void> {
  if (await goImageExists()) return
  const dockerfileDir = path.resolve(process.cwd(), 'docker')
  const dockerfilePath = path.join(dockerfileDir, 'go-sandbox.Dockerfile')
  console.log('[go-sandbox] Building image — one-time setup, takes ~90s on first run...')
  await execFileAsync(
    'docker',
    ['build', '-f', dockerfilePath, '-t', GO_IMAGE_NAME, dockerfileDir],
    { timeout: 10 * 60 * 1000 },
  )
  console.log('[go-sandbox] Image built.')
}

// ── apidiff invocation ────────────────────────────────────────────────────────

/** Honest shape returned by the inside-container apidiff wrapper. */
export interface ApidiffOutput {
  tier: 'apidiff'
  removedExports: string[]
  signatureChanges: Array<{ symbol: string; before: string; after: string }>
  newDeprecations: string[]
  unanalyzableSymbols: Array<{ symbol: string; reason: string }>
}

/**
 * Run apidiff against (module, fromVersion, toVersion) inside the Go
 * sandbox image. Sub-phase 1 throws cleanly with a "not yet implemented"
 * error so the Go adapter's `semanticDiff` honest-fallback path fires
 * deterministically. Sub-phase 2 will land the real invocation.
 *
 * Network mode: `--network=bridge`. The wrapper needs proxy.golang.org
 * access to `go install` both versions. The iptables Phase-A allowlist
 * parity with Node sandbox is tracked as the "polyglot sandbox parity"
 * v2.2.x follow-on (CLAUDE.md §5 rule 12 default-deny still wants this
 * once the wrapper matures).
 */
export async function runApidiff(
  modulePath: string,
  fromVersion: string,
  toVersion: string,
): Promise<ApidiffOutput> {
  if (!(await goImageExists())) {
    throw new Error(
      `Go sandbox image ${GO_IMAGE_NAME} is not built. F23b sub-phase 2 will land the Dockerfile + apidiff wrapper. The adapter falls back honestly until then.`,
    )
  }
  const dockerArgs = [
    'run', '--rm',
    '--network=bridge',
    `--memory=${MEMORY_CAP}`,
    GO_IMAGE_NAME,
    'apidiff-diff',
    modulePath,
    fromVersion,
    toVersion,
  ]
  let stdout: string
  try {
    const out = await execFileAsync('docker', dockerArgs, { timeout: APIDIFF_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })
    stdout = out.stdout
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; signal?: string }
    const tail = (e.stderr ?? e.stdout ?? String(err)).slice(-800)
    const reason = e.killed ? `timed out after ${APIDIFF_TIMEOUT_MS / 1000}s` : `exited non-zero: ${tail}`
    throw new Error(`apidiff failed (${reason})`)
  }
  try {
    return JSON.parse(stdout.trim()) as ApidiffOutput
  } catch (err) {
    throw new Error(`apidiff returned non-JSON output: ${stdout.slice(-400)} (parse error: ${(err as Error).message})`)
  }
}
