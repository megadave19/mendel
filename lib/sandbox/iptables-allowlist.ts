/**
 * v1.5 Workstream #8 — Iptables network allowlist (TRD §8.2 + CLAUDE.md §5 Rule 12).
 *
 * Phase A `--network=bridge` is too permissive: any postinstall script can
 * exfiltrate data or pull arbitrary code over the open egress channel. v1.5
 * tightens this with a tier-based allowlist applied via iptables OUTPUT
 * chain inside the container.
 *
 *   Tier-1 (default): npm registry + GitHub raw + common mirrors. Always on.
 *   Tier-2 (opt-in per scan): extra hosts the user explicitly allows. Logged.
 *
 * This module is pure config — it builds the allowlist string passed to the
 * container as MENDEL_ALLOWLIST env. The container's entrypoint script
 * (docker/setup-allowlist.sh) reads it, resolves hosts to IPs, and applies
 * iptables rules before dropping to the non-root node user.
 *
 * Safety:
 *   - Default-deny policy on OUTPUT (DROP). Only explicitly allowed
 *     destinations work.
 *   - Tier-2 hosts must be valid hostnames (alphanumeric + . + -); rejected
 *     otherwise so a malicious scan config can't inject arbitrary iptables
 *     flags.
 *   - DNS (port 53) is implicitly allowed so hostname resolution works.
 *     This is the documented trade-off — DNS exfiltration is theoretically
 *     possible but practically requires a controlled resolver to harvest,
 *     which a public OSS scan target won't have.
 */

import { z } from 'zod'

/**
 * Tier-1 default allowlist. Sufficient for ~99% of TypeScript/JS package
 * installs. If a package needs something outside this list, the user opts
 * in via tier-2 per scan.
 */
export const TIER_1_HOSTS: readonly string[] = [
  // npm registry + common alternates
  'registry.npmjs.org',
  'registry.yarnpkg.com',
  // Node binaries (some postinstalls download arch-specific binaries)
  'nodejs.org',
  'dl.yarnpkg.com',
  // GitHub: clone, raw, codeload, release artifacts
  'github.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'api.github.com',
  // Common CDN for binary postinstalls (sharp, esbuild, swc, etc.)
  'unpkg.com',
] as const

/**
 * Strict hostname regex — rejects anything that could be misread as an
 * iptables flag, shell metachar, or IP-with-injection.
 *
 * Allowed: lowercase alphanumeric, hyphen, dot. 1–253 chars total. Each
 * label 1–63 chars. Must contain at least one dot (rules out shell-like
 * single tokens).
 */
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/** IPv4 detector — reject anything that looks like a raw IP. We require
 *  hostnames so the entrypoint script can resolve them at setup time (which
 *  also lets npm CDN IP shifts work). */
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/

export const Tier2HostSchema = z.string()
  .toLowerCase()
  .refine((s) => !IPV4_RE.test(s), { message: 'IP addresses are not allowed — supply a hostname' })
  .refine((s) => HOSTNAME_RE.test(s), { message: 'Invalid hostname — must be lowercase, dot-separated, alphanumeric + hyphen only' })

export const Tier2AllowlistSchema = z.array(Tier2HostSchema).max(32, {
  message: 'Tier-2 allowlist cannot exceed 32 hosts (sanity cap)',
})

export interface BuildAllowlistOptions {
  /** Extra hosts the user opted into for this scan. Validated + dedup'd. */
  tier2?: string[]
}

export interface BuiltAllowlist {
  /** All allowed hosts (tier-1 ∪ tier-2). Used by the container entrypoint. */
  hosts: string[]
  /** Tier-2 hosts that survived validation. */
  tier2Accepted: string[]
  /** Tier-2 entries rejected with their reasons. */
  tier2Rejected: Array<{ value: string; reason: string }>
}

/**
 * Build the effective allowlist for one Phase A run. Pure function —
 * does no IO. Caller passes the result to executor.runPhaseA via env.
 *
 * Honest framing: if a user supplies an invalid tier-2 hostname, we DON'T
 * silently drop it (caller could keep ignoring failures). We return it
 * in `tier2Rejected` so the runner can log + surface to UI.
 */
export function buildAllowlist(opts: BuildAllowlistOptions = {}): BuiltAllowlist {
  const tier2Accepted: string[] = []
  const tier2Rejected: Array<{ value: string; reason: string }> = []

  if (opts.tier2 && opts.tier2.length > 0) {
    // Per-host validation so we can report each failure individually rather
    // than failing the entire scan on a single bad entry.
    for (const raw of opts.tier2) {
      const trimmed = (raw ?? '').trim().toLowerCase()
      const parsed = Tier2HostSchema.safeParse(trimmed)
      if (parsed.success) {
        // Reject duplicates with tier-1 (already allowed)
        if ((TIER_1_HOSTS as readonly string[]).includes(parsed.data)) {
          tier2Rejected.push({ value: raw, reason: 'already in tier-1 default allowlist' })
        } else if (tier2Accepted.includes(parsed.data)) {
          tier2Rejected.push({ value: raw, reason: 'duplicate in tier-2 list' })
        } else {
          tier2Accepted.push(parsed.data)
        }
      } else {
        tier2Rejected.push({
          value: raw,
          reason: parsed.error.issues[0]?.message ?? 'invalid hostname',
        })
      }
    }
    // Apply the array-level cap (max 32) AFTER per-host validation
    if (tier2Accepted.length > 32) {
      const excess = tier2Accepted.splice(32)
      for (const e of excess) tier2Rejected.push({ value: e, reason: 'exceeds 32-host sanity cap' })
    }
  }

  // Final hosts: tier-1 base + accepted tier-2. Order-preserving dedup
  // (tier-1 first so it can't be displaced by user input).
  const hosts: string[] = [...TIER_1_HOSTS]
  for (const h of tier2Accepted) if (!hosts.includes(h)) hosts.push(h)

  return { hosts, tier2Accepted, tier2Rejected }
}

/**
 * Serialize the allowlist for the container env var. Format is a simple
 * space-separated list, since the entrypoint script reads it via `read -a`.
 * We validate every host already, so there are no shell-quoting concerns.
 */
export function serializeAllowlistEnv(allowlist: BuiltAllowlist): string {
  return allowlist.hosts.join(' ')
}

/** Test-only exports. */
export const __testing = { HOSTNAME_RE }
