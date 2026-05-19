import { describe, expect, it } from 'vitest'
import { z } from 'zod'

// Mirror the schema from lib/env.ts — tests schema logic without touching process.env
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ENCRYPTION_KEY: z.string().min(32),
  GITHUB_PAT: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

describe('env schema', () => {
  it('accepts a valid environment', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'file:./prisma/dev.db',
      ENCRYPTION_KEY: 'a'.repeat(32),
      NODE_ENV: 'development',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing DATABASE_URL', () => {
    const result = envSchema.safeParse({
      ENCRYPTION_KEY: 'a'.repeat(32),
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.DATABASE_URL).toBeDefined()
    }
  })

  it('rejects ENCRYPTION_KEY shorter than 32 chars', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'file:./prisma/dev.db',
      ENCRYPTION_KEY: 'too-short',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.ENCRYPTION_KEY).toBeDefined()
    }
  })

  it('accepts optional GITHUB_PAT and GEMINI_API_KEY as absent', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'file:./prisma/dev.db',
      ENCRYPTION_KEY: 'a'.repeat(32),
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.GITHUB_PAT).toBeUndefined()
      expect(result.data.GEMINI_API_KEY).toBeUndefined()
    }
  })

  it('defaults NODE_ENV to development when absent', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'file:./prisma/dev.db',
      ENCRYPTION_KEY: 'a'.repeat(32),
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development')
    }
  })

  it('rejects invalid NODE_ENV values', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'file:./prisma/dev.db',
      ENCRYPTION_KEY: 'a'.repeat(32),
      NODE_ENV: 'staging',
    })
    expect(result.success).toBe(false)
  })
})
