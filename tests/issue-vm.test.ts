import { describe, it, expect, beforeAll } from 'vitest'
import type { Issue } from '@prisma/client'

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'test-key-32-chars-exactly-padded!'
  process.env.DATABASE_URL = 'file:./prisma/dev.db'
})

const dep = { name: 'axios', currentVersion: '0.24.0', latestVersion: '1.7.9' } as never
const breakingChanges = [
  { symbol: 'default export', changeType: 'removed', description: 'CJS default removed', sourceUrl: 'https://github.com/axios/axios/releases/tag/v1.0.0' },
] as never
const diagnosis = { summary: 'default import breaks', impact: 'runtime error on import', filesToModify: ['src/client.ts'] } as never
const patches = [
  { filePath: 'package.json', explanation: 'bump axios', newContent: '' },
  { filePath: 'src/client.ts', explanation: 'fix import', newContent: '' },
] as never

describe('issue-vm: persist → map round-trip', () => {
  it('persistIssueData enforces §5b (medium confidence + Not-Analyzed) and round-trips to IssueVM', async () => {
    const { persistIssueData, dbIssueToVM } = await import('@/lib/agent/issue-vm')

    const data = persistIssueData({
      scanId: 'scan-1',
      dep,
      breakingChanges,
      diagnosis,
      patches,
      verificationPassed: true,
      prUrl: 'https://github.com/megadave19/mendel-test/pull/2',
    })

    // §5b: confidence is medium, never high.
    expect(JSON.parse(data.confidence)).toEqual({ level: 'medium' })
    // §5b: Not-Analyzed disclosures present.
    expect(JSON.parse(data.notAnalyzed).length).toBeGreaterThan(0)

    // Simulate the persisted DB row → map back to the frontend VM.
    const dbRow = {
      id: 'issue-1',
      diagnosis: data.diagnosis,
      patch: data.patch,
      verification: data.verification,
      notAnalyzed: data.notAnalyzed,
      prUrl: data.prUrl,
    } as unknown as Issue

    const vm = dbIssueToVM(dbRow)
    expect(vm.dep).toBe('axios')
    expect(vm.currentVersion).toBe('0.24.0')
    expect(vm.latestVersion).toBe('1.7.9')
    expect(vm.confidence).toBe('medium')
    expect(vm.verificationPassed).toBe(true)
    expect(vm.prUrl).toContain('/pull/2')
    expect(vm.evidence[0].url).toContain('axios')
    expect(vm.diff.length).toBeGreaterThan(0) // manifest bump at minimum
    expect(vm.notAnalyzed.length).toBeGreaterThan(0)
  })

  it('dbIssueToVM falls back safely on malformed/empty blobs', async () => {
    const { dbIssueToVM } = await import('@/lib/agent/issue-vm')
    const vm = dbIssueToVM({ id: 'x', diagnosis: 'not-json', patch: null, verification: '', notAnalyzed: '[]', prUrl: null } as unknown as Issue)
    expect(vm.confidence).toBe('medium')
    expect(Array.isArray(vm.diff)).toBe(true)
    expect(vm.prUrl).toBeUndefined()
  })
})
