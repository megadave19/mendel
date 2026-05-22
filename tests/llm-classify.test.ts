import { describe, it, expect, afterEach } from 'vitest'
import { classifyError, getProvider } from '@/lib/llm'

describe('getProvider', () => {
  afterEach(() => {
    delete process.env.LLM_PROVIDER
  })

  it('defaults to gemini (existing behavior/quality unchanged)', () => {
    delete process.env.LLM_PROVIDER
    expect(getProvider()).toBe('gemini')
  })

  it('selects github-models only when explicitly set', () => {
    process.env.LLM_PROVIDER = 'github-models'
    expect(getProvider()).toBe('github-models')
  })

  it('falls back to gemini for any unrecognized value', () => {
    process.env.LLM_PROVIDER = 'something-else'
    expect(getProvider()).toBe('gemini')
  })
})

/**
 * Locks the retry-classification fix: a daily-quota 429 must FAIL FAST (not loop
 * for minutes burning more quota), while per-minute/overload errors stay transient.
 */
describe('classifyError', () => {
  it('treats daily free-tier exhaustion as fail-fast (daily-quota)', () => {
    expect(classifyError('429 Too Many Requests: RESOURCE_EXHAUSTED, quota exceeded for GenerateRequestsPerDay')).toBe('daily-quota')
    expect(classifyError('You exceeded your current quota. Limit: GenerateRequestsPerDayPerProjectPerModel-FreeTier')).toBe('daily-quota')
  })

  it('treats a 429 WITH a short retry hint as transient (per-minute limit)', () => {
    expect(classifyError('429 RESOURCE_EXHAUSTED. Please retry in 23.5s')).toBe('transient')
  })

  it('treats 503 / overload / network as transient', () => {
    expect(classifyError('503 Service Unavailable: model is overloaded')).toBe('transient')
    expect(classifyError('The model is experiencing high demand')).toBe('transient')
    expect(classifyError('fetch failed')).toBe('transient')
  })

  it('treats JSON / schema errors as schema (retry with feedback)', () => {
    expect(classifyError('Unexpected token < in JSON at position 0')).toBe('schema')
    expect(classifyError('Expected string, received number')).toBe('schema')
  })

  it('treats auth / unknown as fatal', () => {
    expect(classifyError('401 API key not valid')).toBe('fatal')
    expect(classifyError('something unexpected')).toBe('fatal')
  })
})
