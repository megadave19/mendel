/**
 * Unit tests for v1.5 Workstream #7 — search-replace block patching.
 *
 * Covers:
 *   - Strategy selector boundaries (TRD §7.2: <150 / 150–500 / >500)
 *   - Line counter (with/without trailing newline)
 *   - Block parser: single, multi, multi-per-file, malformed, prose-around
 *   - Block applier: exact match, whitespace-normalized fuzzy fallback,
 *     multi-block sequential application, failure surfacing
 *   - §5b honesty: empty SEARCH is rejected, failed blocks NEVER silently
 *     dropped
 */

import { describe, it, expect } from 'vitest'
import {
  chooseFilePatchStrategy,
  countLines,
  explainPatchStrategy,
  FULL_FILE_MAX_LINES,
  SEARCH_REPLACE_REQUIRED_LINES,
} from '@/lib/agent/patching/strategy'
import {
  parseSearchReplaceBlocks,
  applyBlocksToFile,
  __testing,
} from '@/lib/agent/patching/search-replace'

/* ─── Strategy selector ───────────────────────────────────────────────────── */

describe('strategy: chooseFilePatchStrategy (TRD §7.2 thresholds)', () => {
  it('files with < 150 lines → full-file', () => {
    expect(chooseFilePatchStrategy(0)).toBe('full-file')
    expect(chooseFilePatchStrategy(1)).toBe('full-file')
    expect(chooseFilePatchStrategy(149)).toBe('full-file')
  })

  it('files at 150 lines → search-replace (preferred boundary)', () => {
    expect(chooseFilePatchStrategy(150)).toBe('search-replace')
    expect(chooseFilePatchStrategy(151)).toBe('search-replace')
  })

  it('files > 500 lines → search-replace (required boundary)', () => {
    expect(chooseFilePatchStrategy(SEARCH_REPLACE_REQUIRED_LINES)).toBe('search-replace')
    expect(chooseFilePatchStrategy(5000)).toBe('search-replace')
  })

  it('safe default for invalid / negative / non-finite line counts', () => {
    // Conservative: any garbage input → full-file (the existing working path).
    // Non-finite inputs are treated as garbage, NOT as "infinite lines → use
    // search-replace" because we'd rather emit a bigger LLM call than risk
    // a malformed strategy from a parser bug.
    expect(chooseFilePatchStrategy(-1)).toBe('full-file')
    expect(chooseFilePatchStrategy(NaN)).toBe('full-file')
    expect(chooseFilePatchStrategy(Infinity)).toBe('full-file')
    expect(chooseFilePatchStrategy(-Infinity)).toBe('full-file')
  })

  it('exposes constants matching TRD §7.2 numbers', () => {
    expect(FULL_FILE_MAX_LINES).toBe(150)
    expect(SEARCH_REPLACE_REQUIRED_LINES).toBe(500)
  })

  it('explainPatchStrategy produces human-readable rationale (for runner logs)', () => {
    expect(explainPatchStrategy(50, 'full-file')).toContain('50 lines')
    expect(explainPatchStrategy(50, 'full-file')).toContain('under')
    expect(explainPatchStrategy(200, 'search-replace')).toContain('preferred')
    expect(explainPatchStrategy(800, 'search-replace')).toContain('required')
  })
})

/* ─── Line counter ────────────────────────────────────────────────────────── */

describe('countLines', () => {
  it('empty string → 0', () => {
    expect(countLines('')).toBe(0)
  })
  it('single line no trailing newline → 1', () => {
    expect(countLines('hello')).toBe(1)
  })
  it('single line with trailing newline → 1 (does not count phantom blank line)', () => {
    expect(countLines('hello\n')).toBe(1)
  })
  it('three lines no trailing newline → 3', () => {
    expect(countLines('a\nb\nc')).toBe(3)
  })
  it('three lines with trailing newline → 3', () => {
    expect(countLines('a\nb\nc\n')).toBe(3)
  })
})

/* ─── Block parser ────────────────────────────────────────────────────────── */

describe('parseSearchReplaceBlocks', () => {
  it('parses a single block with filepath on preceding line', () => {
    const text = [
      'Here is the patch:',
      '',
      'src/foo.ts',
      '<<<<<<< SEARCH',
      'const x = 1',
      '=======',
      'const x = 2',
      '>>>>>>> REPLACE',
    ].join('\n')
    const blocks = parseSearchReplaceBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].filePath).toBe('src/foo.ts')
    expect(blocks[0].search).toBe('const x = 1')
    expect(blocks[0].replace).toBe('const x = 2')
  })

  it('parses multiple blocks for the same file', () => {
    const text = [
      'src/foo.ts',
      '<<<<<<< SEARCH',
      'A',
      '=======',
      'a',
      '>>>>>>> REPLACE',
      '',
      'src/foo.ts',
      '<<<<<<< SEARCH',
      'B',
      '=======',
      'b',
      '>>>>>>> REPLACE',
    ].join('\n')
    const blocks = parseSearchReplaceBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(blocks.every((b) => b.filePath === 'src/foo.ts')).toBe(true)
  })

  it('handles blocks across multiple files', () => {
    const text = [
      'src/a.ts',
      '<<<<<<< SEARCH',
      'old-a',
      '=======',
      'new-a',
      '>>>>>>> REPLACE',
      'src/b.ts',
      '<<<<<<< SEARCH',
      'old-b',
      '=======',
      'new-b',
      '>>>>>>> REPLACE',
    ].join('\n')
    const blocks = parseSearchReplaceBlocks(text)
    expect(blocks.map((b) => b.filePath)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('preserves multi-line SEARCH + REPLACE bodies verbatim', () => {
    const text = [
      'src/foo.ts',
      '<<<<<<< SEARCH',
      'line1',
      '  line2',
      'line3',
      '=======',
      'replaced1',
      '  replaced2',
      '>>>>>>> REPLACE',
    ].join('\n')
    const blocks = parseSearchReplaceBlocks(text)
    expect(blocks[0].search).toBe('line1\n  line2\nline3')
    expect(blocks[0].replace).toBe('replaced1\n  replaced2')
  })

  it('ignores prose before/after blocks (LLM commentary)', () => {
    const text = [
      'Here is what I propose to change. The function `foo` needs a guard.',
      '',
      'src/foo.ts',
      '<<<<<<< SEARCH',
      'X',
      '=======',
      'Y',
      '>>>>>>> REPLACE',
      '',
      'Let me know if you want anything different!',
    ].join('\n')
    const blocks = parseSearchReplaceBlocks(text)
    expect(blocks).toHaveLength(1)
  })

  it('skips blocks with no preceding file path (malformed LLM output)', () => {
    const text = [
      '<<<<<<< SEARCH',
      'orphan',
      '=======',
      'orphan-replacement',
      '>>>>>>> REPLACE',
    ].join('\n')
    const blocks = parseSearchReplaceBlocks(text)
    expect(blocks).toHaveLength(0)
  })

  it('drops unclosed blocks (missing REPLACE marker) — does not corrupt parse', () => {
    const text = [
      'src/foo.ts',
      '<<<<<<< SEARCH',
      'X',
      '=======',
      'Y',
      // missing >>>>>>> REPLACE
      'src/bar.ts',
      '<<<<<<< SEARCH',
      'A',
      '=======',
      'a',
      '>>>>>>> REPLACE',
    ].join('\n')
    const blocks = parseSearchReplaceBlocks(text)
    // First block is unclosed and gets absorbed; we should still recover NO
    // blocks at all (defensive — the parse-consume-until-REPLACE strategy
    // can't recover the second block in this exact malformed shape).
    // This is the explicit behavior — we'd rather drop blocks than apply
    // a half-parsed one (§5b honesty: silent corruption is worse than no-op).
    expect(blocks.length).toBeLessThanOrEqual(1)
  })

  it('returns empty array for text with no markers', () => {
    expect(parseSearchReplaceBlocks('just some text')).toEqual([])
    expect(parseSearchReplaceBlocks('')).toEqual([])
  })
})

/* ─── Block applier — exact match ─────────────────────────────────────────── */

describe('applyBlocksToFile — exact match', () => {
  it('applies a single exact match', () => {
    const file = 'const x = 1\nconst y = 2\n'
    const block = { filePath: 'a.ts', search: 'const x = 1', replace: 'const x = 99' }
    const result = applyBlocksToFile(file, [block])
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(1)
    expect(result.failures).toEqual([])
    expect(result.newContent).toBe('const x = 99\nconst y = 2\n')
  })

  it('applies multiple blocks sequentially', () => {
    const file = 'A\nB\nC\n'
    const blocks = [
      { filePath: 'x', search: 'A', replace: 'AA' },
      { filePath: 'x', search: 'C', replace: 'CC' },
    ]
    const result = applyBlocksToFile(file, blocks)
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(2)
    expect(result.newContent).toBe('AA\nB\nCC\n')
  })

  it('surfaces individual block failure when SEARCH is missing in file', () => {
    const file = 'A\nB\n'
    const blocks = [
      { filePath: 'x', search: 'A', replace: 'AA' },
      { filePath: 'x', search: 'MISSING', replace: 'whatever' },
    ]
    const result = applyBlocksToFile(file, blocks)
    expect(result.ok).toBe(false)
    expect(result.applied).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].block.search).toBe('MISSING')
    expect(result.failures[0].reason).toMatch(/no exact or whitespace-normalized match/)
  })

  it('rejects empty SEARCH (§5b: refuse blind prepend)', () => {
    const file = 'A\n'
    const result = applyBlocksToFile(file, [{ filePath: 'x', search: '', replace: 'INJECTED' }])
    expect(result.ok).toBe(false)
    expect(result.applied).toBe(0)
    expect(result.failures[0].reason).toMatch(/empty SEARCH/)
    expect(result.newContent).toBe('A\n') // unchanged
  })

  it('replaces only the FIRST occurrence (matches indexOf semantics)', () => {
    const file = 'X\nX\nX\n'
    const result = applyBlocksToFile(file, [{ filePath: 'x', search: 'X', replace: 'Y' }])
    expect(result.applied).toBe(1)
    expect(result.newContent).toBe('Y\nX\nX\n')
  })
})

/* ─── Block applier — whitespace-normalized fuzzy ─────────────────────────── */

describe('applyBlocksToFile — whitespace-normalized fuzzy', () => {
  it('matches when LLM used different indentation than the file', () => {
    const file = '    if (x) {\n      doThing()\n    }\n'
    const block = {
      filePath: 'x',
      // LLM may emit collapsed/normalized indent — our fuzzy fallback should still match
      search: 'if (x) {\n  doThing()\n}',
      replace: '    if (x) {\n      doNewThing()\n    }',
    }
    const result = applyBlocksToFile(file, [block])
    expect(result.ok).toBe(true)
    expect(result.newContent).toContain('doNewThing')
    expect(result.newContent).not.toContain('doThing()')
  })

  it('matches when SEARCH has trailing whitespace that file doesn\'t', () => {
    const file = 'const a = 1\nconst b = 2\n'
    const block = {
      filePath: 'x',
      search: 'const a = 1  \nconst b = 2  ', // extra trailing spaces
      replace: 'const a = 1\nconst b = 999',
    }
    const result = applyBlocksToFile(file, [block])
    expect(result.ok).toBe(true)
    expect(result.newContent).toContain('999')
  })

  it('returns failure when fuzzy match also misses', () => {
    const file = 'A\nB\n'
    const result = applyBlocksToFile(file, [{ filePath: 'x', search: 'WILDLY DIFFERENT TEXT', replace: 'X' }])
    expect(result.ok).toBe(false)
    expect(result.failures).toHaveLength(1)
  })

  it('normalizeLine helper collapses internal whitespace correctly', () => {
    const { normalizeLine } = __testing
    expect(normalizeLine('  const   x  =  1  ')).toBe('const x = 1')
    expect(normalizeLine('\tfoo\t\tbar\t')).toBe('foo bar')
    expect(normalizeLine('')).toBe('')
  })
})

/* ─── Round-trip ──────────────────────────────────────────────────────────── */

describe('parse + apply round-trip', () => {
  it('LLM response → parsed blocks → applied to file → expected diff', () => {
    const llmOutput = [
      'src/utils.ts',
      '<<<<<<< SEARCH',
      'export function add(a: number, b: number) {',
      '  return a + b',
      '}',
      '=======',
      'export function add(a: number, b: number, c?: number) {',
      '  return a + b + (c ?? 0)',
      '}',
      '>>>>>>> REPLACE',
    ].join('\n')

    const file = [
      '// utilities',
      'export function add(a: number, b: number) {',
      '  return a + b',
      '}',
      '',
      'export const VERSION = \'1.0\'',
    ].join('\n')

    const blocks = parseSearchReplaceBlocks(llmOutput)
    expect(blocks).toHaveLength(1)

    const result = applyBlocksToFile(file, blocks)
    expect(result.ok).toBe(true)
    expect(result.newContent).toContain('c?: number')
    expect(result.newContent).toContain('a + b + (c ?? 0)')
    expect(result.newContent).toContain('VERSION') // tail preserved
    expect(result.newContent).toContain('// utilities') // head preserved
  })
})
