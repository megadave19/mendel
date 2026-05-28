/**
 * Unit tests for v1.5 Workstream #8 — iptables network allowlist builder.
 *
 * Covers: tier-1 always present, tier-2 validation, dedup, sanity cap,
 * injection rejection, serialization.
 */

import { describe, it, expect } from 'vitest'
import {
  buildAllowlist,
  serializeAllowlistEnv,
  TIER_1_HOSTS,
  Tier2HostSchema,
  Tier2AllowlistSchema,
} from '@/lib/sandbox/iptables-allowlist'

describe('iptables-allowlist: tier-1 defaults', () => {
  it('always includes npm registry + github + node downloads', () => {
    const list = buildAllowlist()
    expect(list.hosts).toContain('registry.npmjs.org')
    expect(list.hosts).toContain('github.com')
    expect(list.hosts).toContain('nodejs.org')
    expect(list.hosts).toContain('codeload.github.com')
  })
  it('tier-1 list is non-empty', () => {
    expect(TIER_1_HOSTS.length).toBeGreaterThan(0)
  })
})

describe('iptables-allowlist: tier-2 valid hostnames', () => {
  it('accepts valid extra hostnames', () => {
    const list = buildAllowlist({ tier2: ['cdn.example.com', 'foo.bar.io'] })
    expect(list.tier2Accepted).toEqual(['cdn.example.com', 'foo.bar.io'])
    expect(list.tier2Rejected).toEqual([])
    expect(list.hosts).toContain('cdn.example.com')
    expect(list.hosts).toContain('foo.bar.io')
  })

  it('normalizes case + trims whitespace', () => {
    const list = buildAllowlist({ tier2: ['  CDN.Example.COM  ', 'Foo.Bar.IO'] })
    expect(list.tier2Accepted).toEqual(['cdn.example.com', 'foo.bar.io'])
  })

  it('preserves order: tier-1 first, then tier-2', () => {
    const list = buildAllowlist({ tier2: ['z.example.com'] })
    expect(list.hosts.indexOf('registry.npmjs.org')).toBeLessThan(list.hosts.indexOf('z.example.com'))
  })
})

describe('iptables-allowlist: rejection of bad input', () => {
  it('rejects single-label hostnames (no dot)', () => {
    const list = buildAllowlist({ tier2: ['localhost'] })
    expect(list.tier2Accepted).toEqual([])
    expect(list.tier2Rejected).toHaveLength(1)
    expect(list.tier2Rejected[0].value).toBe('localhost')
  })

  it('rejects hostnames containing shell metacharacters (injection guard)', () => {
    const malicious = [
      'evil.com; rm -rf /',
      'evil.com && wget x',
      'evil.com $(curl x)',
      'evil.com | nc -l 4444',
      'evil.com\nrm -rf /',
      'evil.com\t-A INPUT -j ACCEPT',
    ]
    for (const m of malicious) {
      const list = buildAllowlist({ tier2: [m] })
      expect(list.tier2Accepted).toEqual([])
      expect(list.tier2Rejected).toHaveLength(1)
    }
  })

  it('rejects IP addresses (must be hostnames)', () => {
    const list = buildAllowlist({ tier2: ['192.168.1.1', '10.0.0.0'] })
    expect(list.tier2Accepted).toEqual([])
    expect(list.tier2Rejected).toHaveLength(2)
  })

  it('rejects empty + whitespace-only entries', () => {
    const list = buildAllowlist({ tier2: ['', '   '] })
    expect(list.tier2Accepted).toEqual([])
    expect(list.tier2Rejected).toHaveLength(2)
  })

  it('rejects hostnames over 253 chars (DNS limit)', () => {
    const tooLong = 'a'.repeat(254) + '.com'
    const list = buildAllowlist({ tier2: [tooLong] })
    expect(list.tier2Accepted).toEqual([])
    expect(list.tier2Rejected).toHaveLength(1)
  })

  it('reports each bad entry with a reason', () => {
    const list = buildAllowlist({ tier2: ['valid.com', 'bad;', 'also-valid.com'] })
    expect(list.tier2Accepted).toEqual(['valid.com', 'also-valid.com'])
    expect(list.tier2Rejected).toHaveLength(1)
    expect(list.tier2Rejected[0].reason).toBeTruthy()
  })
})

describe('iptables-allowlist: dedup', () => {
  it('rejects tier-2 host that duplicates a tier-1 entry with explanatory reason', () => {
    const list = buildAllowlist({ tier2: ['registry.npmjs.org'] })
    expect(list.tier2Accepted).toEqual([])
    expect(list.tier2Rejected).toHaveLength(1)
    expect(list.tier2Rejected[0].reason).toMatch(/tier-1/i)
    // tier-1 still present in hosts
    expect(list.hosts.filter((h) => h === 'registry.npmjs.org')).toHaveLength(1)
  })

  it('rejects duplicates within tier-2 input', () => {
    const list = buildAllowlist({ tier2: ['cdn.example.com', 'cdn.example.com', 'CDN.Example.COM'] })
    expect(list.tier2Accepted).toEqual(['cdn.example.com'])
    expect(list.tier2Rejected.length).toBeGreaterThan(0)
  })
})

describe('iptables-allowlist: sanity cap', () => {
  it('enforces 32-host tier-2 cap', () => {
    // Generate 35 unique valid hostnames
    const hosts = Array.from({ length: 35 }, (_, i) => `host${i}.example.com`)
    const list = buildAllowlist({ tier2: hosts })
    expect(list.tier2Accepted.length).toBe(32)
    expect(list.tier2Rejected.length).toBe(3)
    expect(list.tier2Rejected[0].reason).toMatch(/32-host/)
  })
})

describe('iptables-allowlist: serialization for container env', () => {
  it('serializes as space-separated hostnames', () => {
    const list = buildAllowlist({ tier2: ['cdn.example.com'] })
    const env = serializeAllowlistEnv(list)
    expect(env).toContain('registry.npmjs.org')
    expect(env).toContain('cdn.example.com')
    expect(env.split(' ').every((h) => h.length > 0)).toBe(true)
  })

  it('serialized output never contains shell metachars (defensive)', () => {
    const list = buildAllowlist({ tier2: ['cdn.example.com'] })
    const env = serializeAllowlistEnv(list)
    expect(env).not.toMatch(/[;&|`$()<>"'\\\n\r\t]/)
  })
})

describe('iptables-allowlist: schema exports', () => {
  it('Tier2HostSchema accepts valid + rejects invalid in isolation', () => {
    expect(Tier2HostSchema.safeParse('foo.com').success).toBe(true)
    expect(Tier2HostSchema.safeParse('foo').success).toBe(false)
    expect(Tier2HostSchema.safeParse('foo;bar').success).toBe(false)
  })

  it('Tier2AllowlistSchema enforces array cap', () => {
    const long = Array.from({ length: 40 }, (_, i) => `h${i}.com`)
    expect(Tier2AllowlistSchema.safeParse(long).success).toBe(false)
    expect(Tier2AllowlistSchema.safeParse(long.slice(0, 32)).success).toBe(true)
  })
})
