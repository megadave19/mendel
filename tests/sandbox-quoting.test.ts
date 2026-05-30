/**
 * Regression test for the 2026-05-31 shell-quoting bug that silently failed
 * Phase A on every cache hit.
 *
 * The old `sh -c "${shellCommand}"` interpolation broke when shellCommand
 * contained `"` (it did: the CACHE_HIT echo). After 4 rounds of theorizing,
 * persisting phaseA.stdout to the DB finally surfaced:
 *   /bin/sh: -c: line 0: syntax error near unexpected token `('
 *   sh -c "echo "CACHE_HIT: skipping install (cache volume X already populated)""
 *
 * shArg single-quotes everything (so `"`, `(`, `$`, `;`, … are all literal)
 * and uses the standard `'\''` trick to escape any embedded `'`.
 */

import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { shArg } from '@/lib/sandbox/executor'

describe('shArg — shell-safe argument quoting', () => {
  it("wraps in single quotes (so double-quotes + parens become literal)", () => {
    expect(shArg('echo "CACHE_HIT: skipping install (cache volume X already populated)"'))
      .toBe(`'echo "CACHE_HIT: skipping install (cache volume X already populated)"'`)
  })

  it("escapes embedded single quotes via the standard '\\'' trick", () => {
    expect(shArg(`don't`)).toBe(`'don'\\''t'`)
  })

  it('the wrapped value, fed through `sh -c`, prints the original string byte-for-byte', () => {
    // The actual regression: the failing payload had `"` and `(` in it. Run it.
    const payload = 'CACHE_HIT: skipping install (cache volume "X" already populated)'
    const cmd = `printf %s ${shArg(payload)}`
    const out = execSync(cmd, { encoding: 'utf-8' })
    expect(out).toBe(payload)
  })

  it('round-trips a payload containing every shell metachar', () => {
    const payload = `weird ${'`'}$( ; | & > < " ' ) chars`
    const out = execSync(`printf %s ${shArg(payload)}`, { encoding: 'utf-8' })
    expect(out).toBe(payload)
  })
})
