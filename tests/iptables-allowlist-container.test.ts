/**
 * v1.5 Workstream #8 Push 2 — REAL container egress-filter integration test.
 *
 * The unit tests in iptables-allowlist.test.ts prove the pure config layer
 * (hostname validation, tier merge, serialization). They CANNOT prove the
 * thing that actually matters for security: that the iptables OUTPUT rules,
 * applied by docker/setup-allowlist.sh inside a real container, genuinely
 * block egress to non-allowlisted hosts while permitting allowlisted ones.
 *
 * This test closes that gap. It:
 *   1. Builds (or reuses) the real mendel-sandbox:v1.5 image
 *   2. Runs a container exactly like runPhaseA does — --network=bridge,
 *      --cap-add=NET_ADMIN, MENDEL_ALLOWLIST=<one allowed host>
 *   3. From inside, curls an ALLOWED host and a BLOCKED host
 *   4. Asserts: allowed host connects; blocked host times out (DROP)
 *
 * Gated by DOCKER_INTEGRATION=1 (needs Docker + privileged caps + network).
 * It does NOT run on `pnpm test`. Run via:
 *   pnpm test:docker
 *   # or: DOCKER_INTEGRATION=1 pnpm test iptables-allowlist-container
 *
 * CLAUDE.md §11b.1: Docker orchestration must be verified against a real
 * container, never declared working from code that "looks right".
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
const ENABLE = process.env.DOCKER_INTEGRATION === '1'

// One tier-1 host we permit, one host we deliberately leave OFF the allowlist.
const ALLOWED_HOST = 'registry.npmjs.org'
const BLOCKED_HOST = 'example.com'

describe.skipIf(!ENABLE)('iptables allowlist — real container egress filter', () => {
  beforeAll(async () => {
    const { ensureSandboxImage } = await import('@/lib/sandbox/executor')
    await ensureSandboxImage()
  }, 5 * 60 * 1000)

  it('permits an allowlisted host and blocks a non-allowlisted host (default-DROP)', async () => {
    // Mirror runPhaseA's docker invocation. The entrypoint applies iptables
    // rules from MENDEL_ALLOWLIST, then drops to the node user and runs our
    // probe. We print parseable http_code markers — the conclusive signal:
    // both hosts resolve via DNS (port 53 allowed), so a 000 vs a real HTTP
    // status on the SAME image isolates the iptables egress rule as the only
    // variable. (We deliberately avoid `$?` here — it would be expanded by
    // the host shell in execAsync before reaching the container.)
    const probe = [
      "curl -s -o /dev/null -w 'ALLOWED_%{http_code}\\n' --max-time 20 https://" + ALLOWED_HOST + '/',
      "curl -s -o /dev/null -w 'BLOCKED_%{http_code}\\n' --max-time 8 https://" + BLOCKED_HOST + '/',
      // The blocked curl exits nonzero (28). Swallow it so the container exits
      // 0 and we read stdout normally — the http_code markers are the signal.
      'true',
    ].join(' ; ')

    const cmd = [
      'docker run --rm',
      '--network=bridge',
      '--cap-add=NET_ADMIN',
      `-e MENDEL_ALLOWLIST="${ALLOWED_HOST}"`,
      'mendel-sandbox:v1.5',
      `sh -c "${probe}"`,
    ].join(' ')

    const { stdout, stderr } = await execAsync(cmd, { timeout: 90_000 })
    const out = `${stdout}\n${stderr}`

    // Guard: if the host docker lacks CAP_NET_ADMIN, the entrypoint logs
    // "leaving bridge open" and applies NO filter — both curls would succeed
    // and the test would be meaningless. Fail loudly with the real reason.
    if (/leaving bridge (network )?open/i.test(out)) {
      throw new Error(
        'Allowlist was NOT applied (iptables/CAP_NET_ADMIN unavailable in this ' +
        'docker host). This test requires privileged docker. Entrypoint log:\n' + out,
      )
    }
    expect(out).toMatch(/allowlist applied/i)

    // Allowed host: a real HTTP status (1xx–5xx), i.e. the TCP connection
    // succeeded and TLS completed. 000 would mean it failed to connect.
    expect(out).toMatch(/ALLOWED_[1-5]\d\d/)

    // Blocked host: SYN dropped by default-DROP → curl never gets a response
    // → http_code 000. This is the proof the egress filter actually blocks.
    expect(out).toContain('BLOCKED_000')
    expect(out).not.toMatch(/BLOCKED_[1-5]\d\d/)
  }, 120_000)
})
