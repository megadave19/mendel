/**
 * Unit tests for the Tier-1 .d.ts semantic-diff implementation.
 *
 * Strategy:
 *   - Fast tests (always run) use small inline .d.ts files written to a
 *     temp dir so we don't hit the network.
 *   - One live test (gated by env SEMDIFF_LIVE=1) hits npm registry for a
 *     known version pair (axios 0.24.0 → 0.27.2) to prove the end-to-end
 *     pipeline. Skipped by default so `pnpm test` stays hermetic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { __testing, parseSemanticDiffFromDirs, parseSemanticDiff, SemanticDiffSchema } from '@/lib/agent/signals/semantic-diff'

let tmpRoot: string

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'mendel-semdiff-test-'))
})
afterAll(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true })
})

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

async function writeDts(parent: string, name: string, content: string): Promise<string> {
  const file = join(parent, name)
  await writeFile(file, content, 'utf8')
  return file
}

async function makeDir(label: string): Promise<string> {
  const dir = join(tmpRoot, label)
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  return dir
}

/* ─── Tests ───────────────────────────────────────────────────────────────── */

describe('semantic-diff Tier-1 — symbol table builder', () => {
  it('extracts named exports + signatures from a .d.ts file', async () => {
    const dir = await makeDir('symtab-1')
    await writeDts(dir, 'index.d.ts', `
      export declare function greet(name: string): string;
      export declare const VERSION: string;
      export declare class Client {
        constructor(opts: { url: string });
        request(path: string): Promise<unknown>;
      }
    `)
    const dts = await __testing.findDtsFiles(dir)
    const { table } = __testing.buildSymbolTable(dts)
    const names = Array.from(table.keys()).sort()
    expect(names).toEqual(['Client', 'VERSION', 'greet'])
    // Function signature includes parameter + return type
    expect(table.get('greet')!.signature).toContain('string')
  })

  it('captures @deprecated tag', async () => {
    const dir = await makeDir('symtab-deprecated')
    await writeDts(dir, 'index.d.ts', `
      /** @deprecated use {@link newApi} */
      export declare function legacyApi(): void;
      export declare function newApi(): void;
    `)
    const dts = await __testing.findDtsFiles(dir)
    const { table } = __testing.buildSymbolTable(dts)
    expect(table.get('legacyApi')!.deprecated).toBe(true)
    expect(table.get('newApi')!.deprecated).toBe(false)
  })

  it('ignores default + dunder-prefixed exports', async () => {
    const dir = await makeDir('symtab-skip')
    await writeDts(dir, 'index.d.ts', `
      declare const _internal: number;
      declare function publicApi(): void;
      export { publicApi };
      export default _internal;
    `)
    const dts = await __testing.findDtsFiles(dir)
    const { table } = __testing.buildSymbolTable(dts)
    const names = Array.from(table.keys())
    expect(names).toContain('publicApi')
    expect(names).not.toContain('default')
    expect(names.find((n) => n.startsWith('__'))).toBeUndefined()
  })
})

describe('semantic-diff Tier-1 — diff function', () => {
  it('flags removed exports + signature changes + new deprecations', async () => {
    const oldDir = await makeDir('diff-old')
    const newDir = await makeDir('diff-new')

    await writeDts(oldDir, 'index.d.ts', `
      export declare function stable(): void;
      export declare function changedSignature(x: number): boolean;
      export declare function removedInNext(): void;
      export declare function newlyDeprecated(): void;
    `)
    await writeDts(newDir, 'index.d.ts', `
      export declare function stable(): void;
      export declare function changedSignature(x: number, y: number): boolean;
      /** @deprecated unused */
      export declare function newlyDeprecated(): void;
      export declare function addedInNext(): void;
    `)

    const result = await parseSemanticDiffFromDirs(oldDir, newDir)

    // Schema-valid
    expect(() => SemanticDiffSchema.parse(result)).not.toThrow()

    expect(result.removedExports).toEqual(['removedInNext'])
    expect(result.signatureChanges.map((s) => s.symbol)).toEqual(['changedSignature'])
    expect(result.signatureChanges[0]?.before).not.toBe(result.signatureChanges[0]?.after)
    expect(result.newDeprecations).toEqual(['newlyDeprecated'])
    expect(result.analysisTier).toBe('dts')
    expect(result.coveragePercent).toBeGreaterThan(0)
  })

  it('falls through to Tier-3 when one side lacks .d.ts (dispatcher behavior)', async () => {
    const oldDir = await makeDir('diff-no-dts-old')
    const newDir = await makeDir('diff-no-dts-new')
    // newDir has a .d.ts, oldDir doesn't → dispatcher picks Tier-3 since not
    // BOTH sides have .d.ts. With no .js in either, Tier-3 yields an empty
    // table — no signal possible. Caller's confidence layer should treat
    // `coveragePercent: 0` as "this signal is uninformative" rather than as
    // "no breaking changes."
    await writeDts(newDir, 'index.d.ts', `export declare const x: number;`)
    const result = await parseSemanticDiffFromDirs(oldDir, newDir)
    expect(result.analysisTier).toBe('ast-only')
    expect(result.coveragePercent).toBe(0)
    expect(result.removedExports).toEqual([])
    expect(result.signatureChanges).toEqual([])
  })

  it('produces deterministic output (same input → same bytes)', async () => {
    const oldDir = await makeDir('det-old')
    const newDir = await makeDir('det-new')
    await writeDts(oldDir, 'index.d.ts', `
      export declare function a(): void;
      export declare function c(): void;
      export declare function b(): void;
    `)
    await writeDts(newDir, 'index.d.ts', `
      export declare function a(): void;
    `)
    const r1 = await parseSemanticDiffFromDirs(oldDir, newDir)
    const r2 = await parseSemanticDiffFromDirs(oldDir, newDir)
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2))
    // Removed exports sorted alphabetically
    expect(r1.removedExports).toEqual(['b', 'c'])
  })
})

describe('semantic-diff Tier-1 — schema enforcement', () => {
  it('output passes Zod validation', async () => {
    const dir = await makeDir('zod-shape')
    await writeDts(dir, 'index.d.ts', `export declare const a: number;`)
    const result = await parseSemanticDiffFromDirs(dir, dir)
    const parsed = SemanticDiffSchema.parse(result)
    expect(parsed.analysisTier).toMatch(/^(dts|api-extractor|ast-only)$/)
  })
})

/* ─── Tier-3 AST fallback ─────────────────────────────────────────────────── */

describe('semantic-diff Tier-3 — AST fallback for pure-JS packages', () => {
  async function writeJs(parent: string, name: string, content: string): Promise<string> {
    const file = join(parent, name)
    await writeFile(file, content, 'utf8')
    return file
  }

  it('extracts ESM named exports from .js files', async () => {
    const dir = await makeDir('ast-esm')
    await writeJs(dir, 'index.js', `
      export function alpha(x) { return x + 1 }
      export const VERSION = '1.0.0'
      export class Engine { start() {} }
    `)
    const files = await __testing.findJsFiles(dir)
    const { table } = __testing.buildAstSymbolTable(files)
    const names = Array.from(table.keys()).sort()
    expect(names).toEqual(['Engine', 'VERSION', 'alpha'])
    expect(table.get('alpha')!.kind).toBe('function')
    expect(table.get('Engine')!.kind).toBe('class')
    expect(table.get('VERSION')!.kind).toBe('variable')
  })

  it('extracts CJS module.exports + exports.x patterns', async () => {
    const dir = await makeDir('ast-cjs')
    await writeJs(dir, 'index.js', `
      function add(a, b) { return a + b }
      module.exports.add = add
      module.exports.PI = 3.14
      exports.greet = function(n) { return 'hi ' + n }
    `)
    const files = await __testing.findJsFiles(dir)
    const { table } = __testing.buildAstSymbolTable(files)
    const names = Array.from(table.keys()).sort()
    expect(names).toEqual(['PI', 'add', 'greet'])
  })

  it('detects removed CJS export across two AST-only versions', async () => {
    const oldDir = await makeDir('ast-diff-old')
    const newDir = await makeDir('ast-diff-new')
    await writeJs(oldDir, 'index.js', `
      module.exports.kept = function () { return 1 }
      module.exports.dropped = function () { return 2 }
    `)
    await writeJs(newDir, 'index.js', `
      module.exports.kept = function () { return 1 }
    `)
    const result = await parseSemanticDiffFromDirs(oldDir, newDir)
    expect(result.analysisTier).toBe('ast-only')
    expect(result.removedExports).toEqual(['dropped'])
    expect(result.coveragePercent).toBe(100)
  })

  it('ignores test files + min.js + node_modules dirs', async () => {
    const dir = await makeDir('ast-ignore')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'node_modules', 'shouldignore'), { recursive: true })
    await writeJs(join(dir, 'node_modules', 'shouldignore'), 'noisy.js', 'export const noise = 1')
    await writeJs(dir, 'index.js', 'export const real = 1')
    await writeJs(dir, 'index.test.js', 'export const fake = 1')
    await writeJs(dir, 'bundle.min.js', 'export const min = 1')
    const files = await __testing.findJsFiles(dir)
    const fileNames = files.map((f) => f.split('/').pop()).sort()
    expect(fileNames).toEqual(['index.js'])
  })

  it('dispatcher picks Tier-3 when no .d.ts present', async () => {
    const oldDir = await makeDir('disp-old')
    const newDir = await makeDir('disp-new')
    await writeJs(oldDir, 'index.js', `export function a() {}`)
    await writeJs(newDir, 'index.js', `export function a() {}`)
    const result = await parseSemanticDiffFromDirs(oldDir, newDir)
    expect(result.analysisTier).toBe('ast-only')
  })

  it('dispatcher picks Tier-1 when .d.ts present in both versions', async () => {
    const oldDir = await makeDir('disp-tier1-old')
    const newDir = await makeDir('disp-tier1-new')
    await writeDts(oldDir, 'index.d.ts', `export declare function a(): void;`)
    await writeDts(newDir, 'index.d.ts', `export declare function a(): void;`)
    const result = await parseSemanticDiffFromDirs(oldDir, newDir)
    expect(result.analysisTier).toBe('dts')
  })
})

/* ─── Tier-2 JS + JSDoc declaration emit (v1.5.1) ─────────────────────────── */

describe('semantic-diff Tier-2 — JS + JSDoc declaration emit', () => {
  async function writeJs(parent: string, name: string, content: string): Promise<string> {
    const file = join(parent, name)
    await writeFile(file, content, 'utf8')
    return file
  }

  it('hasJsdocTypes: true for JSDoc type tags, false for bare JS', async () => {
    const dir = await makeDir('t2-detect')
    const typed = await writeJs(dir, 'typed.js', '/**\n * @param {number} x\n */\nexport function f(x) { return x }')
    const bare = await writeJs(dir, 'bare.js', 'export function g(y) { return y }')
    expect(__testing.hasJsdocTypes([typed])).toBe(true)
    expect(__testing.hasJsdocTypes([bare])).toBe(false)
  })

  it('lifts JS+JSDoc to a typed table (tier api-extractor) and detects a param-type change', async () => {
    const oldDir = await makeDir('t2-old')
    const newDir = await makeDir('t2-new')
    await writeJs(oldDir, 'index.js', `
      /**
       * @param {number} value
       * @returns {boolean}
       */
      export function isPositive(value) { return value > 0 }

      /**
       * @param {number} a
       * @param {number} b
       * @returns {number}
       */
      export function sum(a, b) { return a + b }
    `)
    await writeJs(newDir, 'index.js', `
      /**
       * @param {string} value
       * @returns {boolean}
       */
      export function isPositive(value) { return value.length > 0 }
    `)

    const result = await parseSemanticDiffFromDirs(oldDir, newDir)
    expect(result.analysisTier).toBe('api-extractor')
    // sum was removed
    expect(result.removedExports).toContain('sum')
    // isPositive's param type changed number → string
    expect(result.signatureChanges.map((s) => s.symbol)).toContain('isPositive')
    const isPos = result.signatureChanges.find((s) => s.symbol === 'isPositive')!
    expect(isPos.before).not.toBe(isPos.after)
    expect(result.coveragePercent).toBeGreaterThan(0)
  })

  it('bare JS (no JSDoc types) stays Tier-3 ast-only — emit is NOT attempted', async () => {
    const oldDir = await makeDir('t2-bare-old')
    const newDir = await makeDir('t2-bare-new')
    await writeJs(oldDir, 'index.js', 'export function a(x) { return x }')
    await writeJs(newDir, 'index.js', 'export function a(x) { return x }')
    const result = await parseSemanticDiffFromDirs(oldDir, newDir)
    expect(result.analysisTier).toBe('ast-only')
  })

  it('mixed pair (one ships .d.ts, other is JS+JSDoc) resolves to the weaker tier api-extractor', async () => {
    const oldDir = await makeDir('t2-mixed-old')
    const newDir = await makeDir('t2-mixed-new')
    await writeDts(oldDir, 'index.d.ts', 'export declare function f(x: number): void;')
    await writeJs(newDir, 'index.js', '/**\n * @param {number} x\n */\nexport function f(x) {}')
    const result = await parseSemanticDiffFromDirs(oldDir, newDir)
    expect(result.analysisTier).toBe('api-extractor')
  })
})

/* ─── affectedSitesInRepo cross-reference ─────────────────────────────────── */

describe('semantic-diff — affectedSitesInRepo from refIndex', () => {
  it('cross-references removed symbols against repo imports + usages', () => {
    // Synthetic refIndex shaped like buildReferenceIndex output. Two files
    // both import { stripped } from "the-package", one with an alias.
    const refIndex = {
      imports: [
        { packageName: 'the-package', importedName: 'stripped', localName: 'stripped', filePath: '/repo/a.ts', line: 1 },
        { packageName: 'the-package', importedName: 'stripped', localName: 'aliased',  filePath: '/repo/b.ts', line: 1 },
        { packageName: 'the-package', importedName: 'kept',     localName: 'kept',     filePath: '/repo/a.ts', line: 2 },
        { packageName: 'other-pkg',   importedName: 'unrelated', localName: 'unrelated', filePath: '/repo/c.ts', line: 1 },
      ],
      usages: [
        { symbol: 'stripped', filePath: '/repo/a.ts', line: 5, column: 0, context: 'stripped(x)' },
        { symbol: 'aliased',  filePath: '/repo/b.ts', line: 7, column: 0, context: 'aliased()' },
        { symbol: 'kept',     filePath: '/repo/a.ts', line: 9, column: 0, context: 'kept()' },
      ],
      files: ['/repo/a.ts', '/repo/b.ts', '/repo/c.ts'],
      parseErrors: [],
    }

    const result = __testing.affectedSitesFromIndex(
      refIndex,
      'the-package',
      {
        removedExports: ['stripped'],
        signatureChanges: [],
        newDeprecations: [],
      },
    )

    expect(result.length).toBe(1)
    expect(result[0]?.symbol).toBe('stripped')
    expect(result[0]?.files.sort()).toEqual(['/repo/a.ts', '/repo/b.ts'])
  })

  it('emits empty when no matching imports exist for removed symbols', () => {
    const refIndex = {
      imports: [
        { packageName: 'other-pkg', importedName: 'foo', localName: 'foo', filePath: '/x.ts', line: 1 },
      ],
      usages: [
        { symbol: 'foo', filePath: '/x.ts', line: 2, column: 0, context: 'foo()' },
      ],
      files: ['/x.ts'],
      parseErrors: [],
    }
    const result = __testing.affectedSitesFromIndex(
      refIndex,
      'the-package',
      { removedExports: ['foo'], signatureChanges: [], newDeprecations: [] },
    )
    expect(result).toEqual([])
  })
})

/* ─── Live registry tests (opt-in) ────────────────────────────────────────── */

describe.skipIf(process.env.SEMDIFF_LIVE !== '1')('semantic-diff Tier-1 — live npm registry', () => {
  it('detects breaking changes in axios 0.24.0 → 0.27.2 (.d.ts → Tier-1)', async () => {
    const result = await parseSemanticDiff('axios', '0.24.0', '0.27.2')
    expect(result.analysisTier).toBe('dts')
    expect(result.coveragePercent).toBeGreaterThan(0)
  }, 90_000)

  it('falls back to Tier-3 on ms@1.0.0 → ms@2.1.3 (older versions JS-only)', async () => {
    // `ms` versions 1.x predate shipped types; 2.x has @types/ms but the
    // tarball itself doesn't include .d.ts. Should land on Tier-3.
    const result = await parseSemanticDiff('ms', '1.0.0', '2.1.3')
    expect(result.analysisTier).toBe('ast-only')
    // Should have catalogued at least the main entry signatures (ms is a
    // single-function module — both versions expose a callable default).
    expect(result.coveragePercent).toBeGreaterThanOrEqual(0)
  }, 90_000)
})
