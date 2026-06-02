/**
 * Regression tests for getProvider() — the LLM provider resolver.
 *
 * Root cause of the MeteoalarmCard scan failure (2026-06): the resolver
 * was `LLM_PROVIDER === 'github-models' ? 'github-models' : 'gemini'`,
 * which SILENTLY routed the very natural value `LLM_PROVIDER=github` to
 * gemini — so the scan died with "GEMINI_API_KEY is not set" while only
 * the GitHub-models token was configured.
 *
 * These tests pin the alias set + the loud-failure contract so a future
 * edit can't re-introduce the silent mis-route.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { getProvider } from '@/lib/llm'

const original = process.env.LLM_PROVIDER
afterEach(() => {
  if (original === undefined) delete process.env.LLM_PROVIDER
  else process.env.LLM_PROVIDER = original
})

function withProvider(value: string | undefined): ReturnType<typeof getProvider> {
  if (value === undefined) delete process.env.LLM_PROVIDER
  else process.env.LLM_PROVIDER = value
  return getProvider()
}

describe('getProvider — github-models aliases', () => {
  for (const v of ['github-models', 'github', 'gh-models', 'githubmodels', 'GitHub', 'GITHUB-MODELS', '  github  ']) {
    it(`maps "${v}" → github-models`, () => {
      expect(withProvider(v)).toBe('github-models')
    })
  }
})

describe('getProvider — gemini aliases + default', () => {
  for (const v of ['gemini', 'google', 'GEMINI']) {
    it(`maps "${v}" → gemini`, () => {
      expect(withProvider(v)).toBe('gemini')
    })
  }
  it('unset → gemini (back-compat default)', () => {
    expect(withProvider(undefined)).toBe('gemini')
  })
  it('empty string → gemini', () => {
    expect(withProvider('')).toBe('gemini')
  })
})

describe('getProvider — unrecognized value fails LOUDLY (no silent mis-route)', () => {
  it('throws on a typo instead of silently picking gemini', () => {
    expect(() => withProvider('gpt')).toThrow(/not recognized/)
    expect(() => withProvider('openai')).toThrow(/not recognized/)
    expect(() => withProvider('claude')).toThrow(/not recognized/)
  })
  it('the error names both valid options', () => {
    try {
      withProvider('bogus')
      throw new Error('should have thrown')
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err)
      expect(m).toContain('gemini')
      expect(m).toContain('github-models')
    }
  })
})
