/**
 * v2.2.x polish — iptables egress filter PARITY tests for the per-language
 * sandbox images (Python / Go / Rust).
 *
 * The pre-existing tests/iptables-allowlist-container.test.ts proves the
 * Node image's iptables hook actually filters egress. This file proves
 * the SAME contract holds for the three v2.2 polyglot images, which now
 * share the docker/setup-allowlist-debian.sh entrypoint hook:
 *
 *   1. Image declared CAP_NET_ADMIN + MENDEL_ALLOWLIST → entrypoint
 *      logs "[allowlist] allowlist applied" + iptables sees the rules
 *   2. With the allowlist set, an allowed host returns HTTP 200 + a
 *      blocked host times out (curl exit 28)
 *   3. With the allowlist EMPTY (the default), the entrypoint logs the
 *      back-compat message + leaves bridge open (no filtering)
 *
 * Gated by DOCKER_INTEGRATION=1. Hits the public internet via curl.
 */

import { describe, it, expect } from 'vitest'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const ENABLE = process.env.DOCKER_INTEGRATION === '1'

const IMAGES = [
  { name: 'python', tag: 'mendel-python-sandbox:v2.2' },
  { name: 'go', tag: 'mendel-go-sandbox:v2.2' },
  { name: 'rust', tag: 'mendel-rust-sandbox:v2.2' },
] as const

const ALLOWED_HOST = 'example.com' // stable, public, returns 200
const BLOCKED_HOST = 'icanhazip.com' // different host, definitely not in any sane allowlist

describe.skipIf(!ENABLE).each(IMAGES)('iptables parity — $name image', ({ tag }) => {
  it('with MENDEL_ALLOWLIST=example.com + CAP_NET_ADMIN, the allowed host returns HTTP 200', async () => {
    // Run curl inside the container. The entrypoint applies iptables
    // before exec'ing the command. We use `bash -c` so we can read
    // the curl exit code + http_code in one step.
    const { stdout, stderr } = await execFileAsync(
      'docker',
      [
        'run', '--rm',
        '--cap-add=NET_ADMIN',
        '-e', `MENDEL_ALLOWLIST=${ALLOWED_HOST}`,
        '--entrypoint=/usr/local/bin/setup-allowlist.sh',
        tag,
        'bash', '-c',
        `curl -sS -o /dev/null -w 'HTTP %{http_code}\\n' --max-time 8 https://${ALLOWED_HOST}`,
      ],
      { timeout: 30_000 },
    )
    // The "[allowlist] allowlist applied" message goes to stderr by
    // design (so it doesn't pollute the wrapper's JSON stdout) — the
    // parity tests pin this contract.
    expect(stderr).toMatch(/\[allowlist\] allowlist applied/)
    expect(stdout).toMatch(/HTTP 200/)
  }, 60_000)

  it('with MENDEL_ALLOWLIST=example.com + CAP_NET_ADMIN, a non-allowlisted host times out (default-DROP)', async () => {
    // curl exit 28 is "operation timeout reached"; HTTP 000 is curl's
    // "no response received" sentinel. Either confirms egress was
    // dropped by iptables — the §5 r12 contract.
    let curlExit = 0
    let stdout = ''
    let stderr = ''
    try {
      const r = await execFileAsync(
        'docker',
        [
          'run', '--rm',
          '--cap-add=NET_ADMIN',
          '-e', `MENDEL_ALLOWLIST=${ALLOWED_HOST}`,
          '--entrypoint=/usr/local/bin/setup-allowlist.sh',
          tag,
          'bash', '-c',
          `curl -sS -o /dev/null -w 'HTTP %{http_code}\\n' --max-time 5 https://${BLOCKED_HOST}`,
        ],
        { timeout: 30_000 },
      )
      stdout = r.stdout
      stderr = r.stderr
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number }
      stdout = e.stdout ?? ''
      stderr = e.stderr ?? ''
      curlExit = e.code ?? 0
    }
    expect(stderr).toMatch(/\[allowlist\] allowlist applied/)
    // Either: HTTP 000 in stdout (curl reports "no response"), OR
    // curl exited with 28 (timeout). Both are valid "filtered" signals.
    expect(stdout.includes('HTTP 000') || curlExit === 28).toBe(true)
  }, 60_000)

  it('with MENDEL_ALLOWLIST EMPTY (default), the entrypoint logs back-compat and leaves bridge open', async () => {
    // Empty allowlist = pre-polish behavior = no filter applied.
    // The block-host curl should now succeed (HTTP 200 from icanhazip).
    const { stdout, stderr } = await execFileAsync(
      'docker',
      [
        'run', '--rm',
        '-e', 'MENDEL_ALLOWLIST=',
        '--entrypoint=/usr/local/bin/setup-allowlist.sh',
        tag,
        'bash', '-c',
        `curl -sS -o /dev/null -w 'HTTP %{http_code}\\n' --max-time 8 https://${BLOCKED_HOST}`,
      ],
      { timeout: 30_000 },
    )
    expect(stderr).toMatch(/\[allowlist\] MENDEL_ALLOWLIST empty - leaving bridge network open/)
    expect(stdout).toMatch(/HTTP 200/)
  }, 60_000)
})
