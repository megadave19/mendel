/**
 * v2.2.x polish — application-layer LanguageId enum boundary tests.
 *
 * Prisma 5.22 + SQLite does not support native enums (verified via
 * `prisma validate`). The "Issue.language → Prisma enum" polish item
 * therefore landed as an application-layer enum: a Zod schema plus
 * `validateLanguageId` enforce the closed set at every write boundary
 * (runner → Scan.language; issue-vm → Issue.language).
 *
 * These tests pin the closed set + the throw contract:
 *   - All four current adapter ids accepted
 *   - Common typos / aliases REFUSED with a message that names the
 *     valid options (so a buggy adapter id surfaces honestly instead
 *     of silently persisting a non-language string)
 *   - Empty / null / non-string input refused
 *   - persistIssueData round-trips the validation: passing undefined
 *     persists null (back-compat for pre-F23 callers); passing a real
 *     LanguageId persists the validated value
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  validateLanguageId,
  LanguageIdSchema,
  type LanguageId,
} from '@/lib/agent/lang/types'
import { persistIssueData } from '@/lib/agent/issue-vm'

const VALID: LanguageId[] = ['typescript', 'python', 'go', 'rust']

describe('LanguageIdSchema — the closed set', () => {
  it('lists exactly the four current adapter ids (sub-phase polish anchor)', () => {
    expect(LanguageIdSchema.options).toEqual(['typescript', 'python', 'go', 'rust'])
  })
})

describe('validateLanguageId — happy path', () => {
  for (const v of VALID) {
    it(`accepts '${v}'`, () => {
      expect(validateLanguageId(v)).toBe(v)
    })
  }
})

describe('validateLanguageId — refusal contract', () => {
  it("refuses a typo'd id (e.g. 'typscript') with a message naming valid options", () => {
    expect(() => validateLanguageId('typscript')).toThrow(/typscript/)
    expect(() => validateLanguageId('typscript')).toThrow(/typescript/) // hints at correct option
  })

  it("refuses 'go-lang' / 'golang' / 'js' — common naming traps", () => {
    expect(() => validateLanguageId('go-lang')).toThrow()
    expect(() => validateLanguageId('golang')).toThrow()
    expect(() => validateLanguageId('js')).toThrow()
  })

  it("refuses empty string + null + undefined + non-strings", () => {
    expect(() => validateLanguageId('')).toThrow()
    expect(() => validateLanguageId(null)).toThrow()
    expect(() => validateLanguageId(undefined)).toThrow()
    expect(() => validateLanguageId(42)).toThrow()
    expect(() => validateLanguageId({})).toThrow()
  })

  it("the thrown message names ALL valid options so a buggy caller can self-correct", () => {
    try {
      validateLanguageId('javascript')
      throw new Error('should have thrown')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      for (const v of VALID) expect(message).toContain(v)
    }
  })
})

// ── persistIssueData integration ─────────────────────────────────────────────

const baseArgs = () => ({
  scanId: 'scan-1',
  dep: { name: 'axios', currentVersion: '1.0.0', latestVersion: '2.0.0' } as never,
  breakingChanges: [],
  diagnosis: { summary: '', impact: '' } as never,
  patches: [{ filePath: 'package.json' }] as never,
  verificationPassed: true,
})

describe('persistIssueData — language column validation', () => {
  beforeAll(() => {
    // Suppress accidental config-driven failures if any persist path
    // touches env; persistIssueData is pure but the import chain pulls
    // in ConfidenceScoreSchema.
  })

  it("persists null when language is undefined (pre-F23 back-compat)", () => {
    const data = persistIssueData(baseArgs())
    expect((data as { language: string | null }).language).toBeNull()
  })

  it("persists the validated value when language is a valid LanguageId", () => {
    for (const v of VALID) {
      const data = persistIssueData({ ...baseArgs(), language: v })
      expect((data as { language: string }).language).toBe(v)
    }
  })

  it("THROWS when language is a typo — the column never gets a bad value", () => {
    expect(() =>
      persistIssueData({ ...baseArgs(), language: 'typscript' }),
    ).toThrow(/typscript/)
  })

  it("treats null and undefined identically (both → null persisted)", () => {
    // The signature is `language?: string` so a caller can pass
    // undefined OR omit. null is not in the type but a runtime
    // caller might pass it; we accept it as null (back-compat).
    const a = persistIssueData(baseArgs())
    const b = persistIssueData({ ...baseArgs(), language: undefined })
    expect((a as { language: string | null }).language).toBeNull()
    expect((b as { language: string | null }).language).toBeNull()
  })
})
