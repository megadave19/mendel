/**
 * Semantic API Diffing (v1.5) — TRD §6.4
 *
 * Three-tier pipeline (all tiers now shipped):
 *   1. Primary: download tarballs of old + new versions; extract `.d.ts`;
 *      use the TypeScript compiler API to walk declaration trees; build a
 *      symbol table with full signatures; compute deterministic diff.
 *   2. Fallback (v1.5.1): for JS + JSDoc packages with no shipped `.d.ts`,
 *      synthesize declarations via the tsc compiler (allowJs + declaration +
 *      emitDeclarationOnly), then reuse the Tier-1 walker. Tier value:
 *      'api-extractor'. (See STATE.md 2026-05-28 for the tooling-name
 *      deviation rationale — tsc emit is the engine api-extractor sits on.)
 *   3. Last resort: AST-level diff of JS source files (no JSDoc types).
 *
 * The `analysisTier` field on the output feeds confidence calculation —
 * `ast-only` deserves lower confidence than `dts`.
 *
 * SAFETY:
 *   - Tarballs extracted into a scoped temp dir under `./workspace/semantic-diff/`.
 *     Cleaned up after each run. CLAUDE.md §5 Rule 13: file ops stay within
 *     `./workspace` and `./logs`.
 *   - Network egress is to npmjs.org only (registry tarballs).
 *   - Symbols are walked via the TS compiler API — declarations are NEVER
 *     executed. The forbidden-pattern rule in CLAUDE.md §11 is observed.
 *   - Per-version operation has a hard timeout (60s) so a malformed package
 *     can't hang the agent.
 */

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { z } from 'zod'
import ts from 'typescript'
import { parse as parseEsTree, type TSESTree } from '@typescript-eslint/typescript-estree'
import type { ReferenceIndex, UsageSite } from './ast-parser'

/* ─── Output schema — TRD §6.4 verbatim ───────────────────────────────────── */

/**
 * v2.2 / F23a — `'griffe'` joins the enum as a peer of `'dts'`. The Python
 * adapter pulls both versions of a package, walks the public + private
 * surface with griffe's `find_breaking_changes`, and reports that as
 * tier `'griffe'`. Scoring math is identical to `'dts'` (both are
 * declaration-walking analyzers with exhaustive coverage of what they
 * see) — the distinct enum value exists for HONESTY: the UI + PR body
 * tells the reviewer WHICH analyzer ran, instead of laundering Python
 * findings through a TypeScript label. (Pre-F23a the adapter shipped
 * `'dts'` as a proxy; the V2_PLAN.md §F23a sub-gate item flagged
 * extending the enum here as the right fix.)
 *
 * v2.2 / F23b sub-phase 2 — `'apidiff'` joins for the Go adapter, by the
 * same logic. apidiff (golang.org/x/exp/cmd/apidiff) is the canonical
 * Go API-diff tool and the gold standard for the language. Scoring math
 * is identical to `'dts'`/`'griffe'`. The Go adapter emits this tier
 * when the sandbox image is built; otherwise it honest-falls-back to
 * `'ast-only'` + a clear reason in unanalyzableSymbols.
 */
export const AnalysisTierSchema = z.enum(['dts', 'griffe', 'apidiff', 'api-extractor', 'ast-only'])
export type AnalysisTier = z.infer<typeof AnalysisTierSchema>

export const SignatureChangeSchema = z.object({
  symbol: z.string(),
  before: z.string(),
  after: z.string(),
})
export type SignatureChange = z.infer<typeof SignatureChangeSchema>

export const AffectedSiteSchema = z.object({
  symbol: z.string(),
  files: z.array(z.string()),
})
export type AffectedSite = z.infer<typeof AffectedSiteSchema>

export const UnanalyzableSymbolSchema = z.object({
  symbol: z.string(),
  reason: z.string(),
})
export type UnanalyzableSymbol = z.infer<typeof UnanalyzableSymbolSchema>

export const SemanticDiffSchema = z.object({
  removedExports: z.array(z.string()),
  signatureChanges: z.array(SignatureChangeSchema),
  newDeprecations: z.array(z.string()),
  affectedSitesInRepo: z.array(AffectedSiteSchema),
  coveragePercent: z.number().min(0).max(100),
  unanalyzableSymbols: z.array(UnanalyzableSymbolSchema),
  analysisTier: AnalysisTierSchema,
})
export type SemanticDiff = z.infer<typeof SemanticDiffSchema>

/* ─── Internal: symbol table per-version ──────────────────────────────────── */

interface ExportedSymbol {
  /** Symbol name as exported. */
  name: string
  /** Normalized signature string (whitespace + ordering canonicalized). */
  signature: string
  /** Kind for diff messaging — function / class / interface / type / variable / enum. */
  kind: string
  /** True if the declaration carries an `@deprecated` JSDoc tag. */
  deprecated: boolean
}

const PER_VERSION_TIMEOUT_MS = 60_000
const REGISTRY_BASE = 'https://registry.npmjs.org'

/* ─── npm tarball fetch + extract ─────────────────────────────────────────── */

/** Resolve the tarball URL for a given (package, version) from npm registry. */
async function resolveTarballUrl(pkg: string, version: string): Promise<string | null> {
  const url = `${REGISTRY_BASE}/${encodeURIComponent(pkg)}/${encodeURIComponent(version)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  const data = (await res.json()) as { dist?: { tarball?: string } }
  return data?.dist?.tarball ?? null
}

/** Download tarball bytes to a target file. */
async function downloadTarball(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`tarball fetch failed: ${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(dest, buf)
}

/** Extract a .tgz into a directory using system tar with a hard timeout. */
function extractTarball(tarPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', tarPath, '-C', destDir, '--strip-components=1'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr?.on('data', (d) => { stderr += d.toString() })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('tar extract timed out'))
    }, 30_000)
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`tar exit ${code}: ${stderr.trim().slice(0, 200)}`))
    })
  })
}

/**
 * Fetch + extract a given version into a temp dir. Returns the absolute
 * path to the extracted package root (where package.json lives).
 */
async function fetchPackageVersion(pkg: string, version: string, workspaceDir: string): Promise<string> {
  const tarUrl = await resolveTarballUrl(pkg, version)
  if (!tarUrl) throw new Error(`registry: no tarball for ${pkg}@${version}`)
  const safe = version.replace(/[^a-z0-9.-]/gi, '_')
  const tarPath = join(workspaceDir, `${safe}.tgz`)
  const extractDir = join(workspaceDir, `extracted-${safe}`)
  await mkdir(extractDir, { recursive: true })
  await downloadTarball(tarUrl, tarPath)
  await extractTarball(tarPath, extractDir)
  return extractDir
}

/* ─── .d.ts discovery ─────────────────────────────────────────────────────── */

/** Walk a package directory and collect all `.d.ts` files (excluding `node_modules`). */
async function findDtsFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const stack: string[] = [root]
  while (stack.length) {
    const dir = stack.pop()!
    try {
      const items = await readdir(dir)
      for (const name of items) {
        if (name === 'node_modules' || name === '.git') continue
        const full = join(dir, name)
        const s = await stat(full)
        if (s.isDirectory()) stack.push(full)
        else if (name.endsWith('.d.ts') && !name.endsWith('.test.d.ts')) out.push(full)
      }
    } catch {
      /* unreadable dir — skip */
    }
  }
  return out
}

/** Walk a package directory and collect all JS-family source files
 *  (used by Tier-3 AST fallback). Filters out test files + d.ts. */
async function findJsFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const stack: string[] = [root]
  while (stack.length) {
    const dir = stack.pop()!
    try {
      const items = await readdir(dir)
      for (const name of items) {
        if (name === 'node_modules' || name === '.git' || name === 'test' || name === 'tests' || name === '__tests__') continue
        const full = join(dir, name)
        const s = await stat(full)
        if (s.isDirectory()) stack.push(full)
        else if (
          /\.(js|mjs|cjs)$/.test(name) &&
          !/\.(test|spec)\.(js|mjs|cjs)$/.test(name) &&
          !name.endsWith('.min.js')
        ) {
          out.push(full)
        }
      }
    } catch {
      /* unreadable dir — skip */
    }
  }
  return out
}

/* ─── Tier 1: .d.ts walker via TypeScript compiler API ────────────────────── */

/**
 * Build a symbol table for one extracted package version. We create a TS
 * program rooted at the discovered `.d.ts` files, then walk the type
 * checker's exports of each source file.
 *
 * Returns { table, unanalyzable } — unanalyzable surfaces symbols we could
 * see by name but couldn't normalize a signature for (rare; usually
 * computed-property exports).
 */
function buildSymbolTable(dtsFiles: string[]): { table: Map<string, ExportedSymbol>; unanalyzable: UnanalyzableSymbol[] } {
  const table = new Map<string, ExportedSymbol>()
  const unanalyzable: UnanalyzableSymbol[] = []

  if (dtsFiles.length === 0) return { table, unanalyzable }

  const program = ts.createProgram({
    rootNames: dtsFiles,
    options: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      noEmit: true,
      skipLibCheck: true,
      allowJs: false,
      declaration: false,
      strict: false,
    },
  })
  const checker = program.getTypeChecker()

  for (const file of dtsFiles) {
    const source = program.getSourceFile(file)
    if (!source) continue

    const fileSymbol = checker.getSymbolAtLocation(source)
    if (!fileSymbol) continue

    const exports = checker.getExportsOfModule(fileSymbol)
    for (const sym of exports) {
      const name = sym.getName()
      if (name === 'default' || name.startsWith('__')) {
        // 'default' is a real export but conflates badly across versions; skip
        // for v1.5 first cut. Underscore-prefixed are internal.
        continue
      }

      // Skip duplicates — first one wins (root .d.ts beats nested re-exports).
      if (table.has(name)) continue

      try {
        const decls = sym.getDeclarations() ?? []
        const decl = decls[0]
        const kind = decl ? ts.SyntaxKind[decl.kind] : 'Unknown'
        const signature = normalizeSignature(checker, sym, decl)
        const deprecated = hasDeprecatedTag(sym)
        table.set(name, { name, signature, kind, deprecated })
      } catch (err) {
        unanalyzable.push({ symbol: name, reason: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  return { table, unanalyzable }
}

/** Normalize a symbol's signature to a canonical string. Two same-shape
 *  declarations across versions should produce identical strings here. */
function normalizeSignature(checker: ts.TypeChecker, sym: ts.Symbol, decl: ts.Declaration | undefined): string {
  if (!decl) return `<no-decl> ${sym.getName()}`
  try {
    const type = checker.getTypeOfSymbolAtLocation(sym, decl)
    const raw = checker.typeToString(type, decl, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.WriteArrayAsGenericType)
    return raw.replace(/\s+/g, ' ').trim()
  } catch {
    return decl.getText().replace(/\s+/g, ' ').trim()
  }
}

/** Detect `@deprecated` JSDoc tag on a symbol. */
function hasDeprecatedTag(sym: ts.Symbol): boolean {
  const tags = sym.getJsDocTags?.() ?? []
  return tags.some((t) => t.name === 'deprecated')
}

/* ─── Tier 2: synthesize .d.ts from JS + JSDoc, then reuse the Tier-1 walker ──
 *
 * v1.5.1 / TRD §6.4 "Tier-2 (api-extractor)". A package that ships JS with rich
 * JSDoc type annotations but NO `.d.ts` can still be analyzed at typed-signature
 * fidelity: the TypeScript compiler emits declarations from the JSDoc
 * (`allowJs + declaration + emitDeclarationOnly`), and those synthesized `.d.ts`
 * feed straight into the Tier-1 `buildSymbolTable`. The resulting diff is far
 * sharper than Tier-3's source-slice fingerprints.
 *
 * Implementation note (recorded spec deviation — see STATE.md 2026-05-28):
 * `@microsoft/api-extractor` is a `.d.ts` ROLLUP/report tool — it cannot read
 * raw JS and would require this same `tsc` declaration-emit step first. So we
 * use the tsc compiler (already in the stack) directly, which IS the engine
 * api-extractor sits on. The `analysisTier` value stays `'api-extractor'` so
 * the confidence layer + UI contract is unchanged.
 *
 * Gate: emit is attempted ONLY when the JS actually carries JSDoc TYPE tags
 * (`@param {…}`, `@returns {…}`, `@type {…}`, …). Bare JS with no JSDoc gains
 * nothing from emit (every signature infers to `any`) and is left to Tier-3.
 */

const MAX_EMIT_FILES = 300

/** JSDoc TYPE-tag detector — the `{` distinguishes a type annotation from a
 *  bare prose tag. Presence of any of these means tsc can lift real types. */
const JSDOC_TYPE_RE = /@(?:param|returns?|type|typedef|property|callback|template)\s*\{/

/** True if any of the JS files carries a JSDoc type annotation tsc can use. */
function hasJsdocTypes(jsFiles: string[]): boolean {
  for (const f of jsFiles.slice(0, MAX_EMIT_FILES)) {
    try {
      if (JSDOC_TYPE_RE.test(readFileSync(f, 'utf8'))) return true
    } catch {
      /* unreadable — skip */
    }
  }
  return false
}

/** Emit `.d.ts` from JS+JSDoc into outDir. Returns true if emit ran (we don't
 *  fail on type-diagnostics — declarations still emit). */
function emitDeclarations(jsFiles: string[], rootDir: string, outDir: string): boolean {
  const program = ts.createProgram({
    rootNames: jsFiles.slice(0, MAX_EMIT_FILES),
    options: {
      allowJs: true,
      checkJs: false,
      declaration: true,
      emitDeclarationOnly: true,
      noEmitOnError: false, // emit declarations even when the JS has type errors
      outDir,
      rootDir,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      skipLibCheck: true,
      strict: false,
    },
  })
  return !program.emit().emitSkipped
}

/**
 * Resolve a version's root into a typed symbol table, preferring shipped
 * `.d.ts` (Tier-1) and falling back to JSDoc emit (Tier-2). Returns null when
 * the version offers neither — the caller then drops to Tier-3 AST.
 */
async function buildTypedTable(
  root: string,
): Promise<{ table: Map<string, ExportedSymbol>; unanalyzable: UnanalyzableSymbol[]; tier: 'dts' | 'api-extractor' } | null> {
  const shipped = await findDtsFiles(root)
  if (shipped.length > 0) {
    return { ...buildSymbolTable(shipped), tier: 'dts' }
  }

  const jsFiles = await findJsFiles(root)
  if (jsFiles.length === 0 || !hasJsdocTypes(jsFiles)) return null

  await mkdir(WORKSPACE_ROOT, { recursive: true })
  const emitDir = await mkdtemp(join(WORKSPACE_ROOT, 'emit-'))
  try {
    if (!emitDeclarations(jsFiles, root, emitDir)) return null
    const emittedDts = await findDtsFiles(emitDir)
    if (emittedDts.length === 0) return null
    const built = buildSymbolTable(emittedDts)
    if (built.table.size === 0) return null // emit produced nothing useful
    return { ...built, tier: 'api-extractor' }
  } catch {
    return null
  } finally {
    await rm(emitDir, { recursive: true, force: true }).catch(() => {})
  }
}

/* ─── Tier 3: AST walker via @typescript-eslint/typescript-estree ───────────
 *
 * Handles packages that ship pure JS (no .d.ts, no JSDoc to rollup). We
 * detect exports across both ESM (`export function`, `export const`,
 * `export { x }`) and CJS (`module.exports.x = ...`, `exports.x = ...`)
 * patterns. Signatures come from the source text — not type-checked, so a
 * pure rename with identical impl reads as "no change". That's a known
 * Tier-3 limitation reflected in the lower `analysisTier` confidence.
 */

function buildAstSymbolTable(jsFiles: string[]): { table: Map<string, ExportedSymbol>; unanalyzable: UnanalyzableSymbol[] } {
  const table = new Map<string, ExportedSymbol>()
  const unanalyzable: UnanalyzableSymbol[] = []

  for (const file of jsFiles) {
    let source: string
    try {
      source = readFileSyncShim(file)
    } catch {
      continue
    }

    let ast: TSESTree.Program | null = null
    try {
      ast = parseEsTree(source, { jsx: false, range: true, loc: true, tolerant: true })
    } catch {
      unanalyzable.push({ symbol: `<file:${file}>`, reason: 'AST parse failed' })
      continue
    }

    for (const node of ast.body) {
      collectAstExports(node, source, table, unanalyzable)
    }

    // CJS: scan top-level ExpressionStatement for `module.exports.foo = ...`
    // and `exports.foo = ...`.
    for (const node of ast.body) {
      if (node.type !== 'ExpressionStatement') continue
      collectCjsExports(node.expression, source, table)
    }
  }

  return { table, unanalyzable }
}

/** Synchronous readFile shim — Tier-3 parse is sequential so async would
 *  just queue under itself. Pulled from the top-level fs/promises import? No
 *  — we genuinely want sync here since the AST parser is sync. Import
 *  readFileSync directly. */
import { readFileSync } from 'node:fs'
function readFileSyncShim(path: string): string {
  return readFileSync(path, 'utf8')
}

/** Collect ESM `export ...` declarations into the symbol table. */
function collectAstExports(
  node: TSESTree.Node,
  source: string,
  table: Map<string, ExportedSymbol>,
  unanalyzable: UnanalyzableSymbol[],
): void {
  switch (node.type) {
    case 'ExportNamedDeclaration': {
      if (node.declaration) {
        const decl = node.declaration
        switch (decl.type) {
          case 'FunctionDeclaration':
            if (decl.id) addAstSymbol(table, decl.id.name, sourceSliceOrName(source, decl, decl.id.name), 'function')
            break
          case 'ClassDeclaration':
            if (decl.id) addAstSymbol(table, decl.id.name, sourceSliceOrName(source, decl, decl.id.name), 'class')
            break
          case 'VariableDeclaration':
            for (const d of decl.declarations) {
              if (d.id.type === 'Identifier') {
                addAstSymbol(table, d.id.name, sourceSliceOrName(source, d, d.id.name), 'variable')
              }
            }
            break
          default:
            unanalyzable.push({ symbol: `<${decl.type}>`, reason: 'unsupported export declaration shape' })
        }
      }
      // export { foo, bar as baz }
      for (const spec of node.specifiers) {
        const exportedName = spec.exported.type === 'Identifier' ? spec.exported.name : null
        if (!exportedName) continue
        // signature unknown without resolving the local binding; use the
        // exported name + range as a stable fingerprint.
        addAstSymbol(table, exportedName, `export { ${exportedName} }`, 'reexport')
      }
      break
    }
    case 'ExportAllDeclaration':
      // `export * from './foo'` — can't enumerate without resolution; mark
      // as an opaque re-export.
      addAstSymbol(table, `<re-export-all:${node.source.value}>`, `export * from '${node.source.value}'`, 'reexport-all')
      break
    default:
      // ignore non-export top-level
      break
  }
}

/** Collect CJS `module.exports.foo = ...` and `exports.foo = ...`. */
function collectCjsExports(
  expr: TSESTree.Node,
  source: string,
  table: Map<string, ExportedSymbol>,
): void {
  if (expr.type !== 'AssignmentExpression' || expr.operator !== '=') return
  const left = expr.left
  if (left.type !== 'MemberExpression' || left.computed) return

  // `module.exports.foo = X` (left.object is MemberExpression module.exports)
  // `exports.foo = X` (left.object is Identifier 'exports')
  let isExportsBase = false
  if (
    left.object.type === 'MemberExpression' &&
    !left.object.computed &&
    left.object.object.type === 'Identifier' &&
    left.object.object.name === 'module' &&
    left.object.property.type === 'Identifier' &&
    left.object.property.name === 'exports'
  ) {
    isExportsBase = true
  } else if (left.object.type === 'Identifier' && left.object.name === 'exports') {
    isExportsBase = true
  }
  if (!isExportsBase) return

  if (left.property.type !== 'Identifier') return
  const name = left.property.name
  // Source-slice the right-hand side for a signature fingerprint
  const sig = sourceSliceOrName(source, expr.right, name)
  addAstSymbol(table, name, sig, 'cjs-export')
}

function addAstSymbol(table: Map<string, ExportedSymbol>, name: string, signature: string, kind: string): void {
  if (name === 'default' || name.startsWith('__')) return
  if (table.has(name)) return
  table.set(name, { name, signature, kind, deprecated: false })
}

/** Source-slice a node's text and normalize whitespace. Falls back to name. */
function sourceSliceOrName(source: string, node: TSESTree.Node, fallbackName: string): string {
  if (node.range) {
    const [start, end] = node.range
    return source.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 400)
  }
  return `<${fallbackName}>`
}

/* ─── Diff two symbol tables ──────────────────────────────────────────────── */

interface RawDiff {
  removedExports: string[]
  signatureChanges: SignatureChange[]
  newDeprecations: string[]
}

function diffSymbolTables(oldTable: Map<string, ExportedSymbol>, newTable: Map<string, ExportedSymbol>): RawDiff {
  const removedExports: string[] = []
  const signatureChanges: SignatureChange[] = []
  const newDeprecations: string[] = []

  for (const [name, oldSym] of oldTable) {
    const newSym = newTable.get(name)
    if (!newSym) {
      removedExports.push(name)
      continue
    }
    if (oldSym.signature !== newSym.signature) {
      signatureChanges.push({ symbol: name, before: oldSym.signature, after: newSym.signature })
    }
    if (!oldSym.deprecated && newSym.deprecated) {
      newDeprecations.push(name)
    }
  }

  // Sort everything so output is deterministic — same input → same output bytes.
  removedExports.sort()
  signatureChanges.sort((a, b) => a.symbol.localeCompare(b.symbol))
  newDeprecations.sort()

  return { removedExports, signatureChanges, newDeprecations }
}

/* ─── Coverage % ──────────────────────────────────────────────────────────── */

function computeCoveragePercent(symbolCount: number, unanalyzableCount: number): number {
  const total = symbolCount + unanalyzableCount
  if (total === 0) return 0
  return Math.round(((total - unanalyzableCount) / total) * 100)
}

/* ─── Workspace lifecycle ─────────────────────────────────────────────────── */

const WORKSPACE_ROOT = process.env.MENDEL_SEMDIFF_WORKSPACE ?? join(process.cwd(), 'workspace', 'semantic-diff')

async function makeScopedWorkspace(pkg: string, fromV: string, toV: string): Promise<string> {
  await mkdir(WORKSPACE_ROOT, { recursive: true })
  // CLAUDE.md §5 Rule 13: assert we stay inside ./workspace.
  const root = await mkdtemp(join(WORKSPACE_ROOT, `${sanitize(pkg)}-${sanitize(fromV)}-${sanitize(toV)}-`))
  const rel = relative(WORKSPACE_ROOT, root)
  if (rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new Error(`workspace path escaped: ${root}`)
  }
  return root
}

function sanitize(s: string): string {
  return s.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40)
}

/* ─── Public entry ────────────────────────────────────────────────────────── */

/**
 * Options for parseSemanticDiff.
 */
export interface SemanticDiffOptions {
  /**
   * Optional reference index built from the user's repo (from
   * `buildReferenceIndex` in ast-parser). When supplied, `affectedSitesInRepo`
   * is populated by cross-referencing removed/changed symbols against the
   * user's import + usage sites. Without it, affectedSitesInRepo = [].
   */
  refIndex?: ReferenceIndex
  /** Override the registry timeout in tests. */
  timeoutMs?: number
}

/**
 * Produce a semantic diff between two npm versions of a package.
 *
 * Tier dispatch:
 *   1. If BOTH versions ship `.d.ts` → Tier-1 (TypeScript compiler API)
 *   2. Else → Tier-3 (AST walker over JS sources)
 *   (Tier-2 `api-extractor` fallback is documented as v1.5.1 scope — see
 *    TRD §6.4. The narrow case it covers — JS-only with rich JSDoc — is
 *    rare enough that Tier-3 carries v1.5 first cut.)
 *
 * @throws if network or extraction fails (caller decides whether to swallow)
 */
export async function parseSemanticDiff(
  packageName: string,
  fromVersion: string,
  toVersion: string,
  opts: SemanticDiffOptions = {},
): Promise<SemanticDiff> {
  const ws = await makeScopedWorkspace(packageName, fromVersion, toVersion)
  const timeoutMs = opts.timeoutMs ?? PER_VERSION_TIMEOUT_MS
  try {
    const withTimeout = async <T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      })
      try {
        return await Promise.race([p, timeout])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

    // Fetch + extract both versions in parallel — independent operations.
    const [oldRoot, newRoot] = await Promise.all([
      withTimeout(fetchPackageVersion(packageName, fromVersion, ws), timeoutMs, `fetch ${fromVersion}`),
      withTimeout(fetchPackageVersion(packageName, toVersion, ws), timeoutMs, `fetch ${toVersion}`),
    ])

    return await computeDiffForRoots(oldRoot, newRoot, { refIndex: opts.refIndex, packageName })
  } finally {
    // Always clean up the scoped workspace — the agent should not leave
    // disk artifacts behind even on error paths.
    await rm(ws, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Shared dispatcher used by both public entry points. Resolves each version to
 * the strongest available representation and diffs them:
 *   - both ship .d.ts                         → Tier-1 ('dts')
 *   - either side lifted via JSDoc emit       → Tier-2 ('api-extractor')
 *   - neither resolves to a typed table       → Tier-3 ('ast-only')
 *
 * Tier-1 and Tier-2 both produce tables via `buildSymbolTable`, so they're
 * directly comparable. We only adopt the typed path when BOTH sides resolve to
 * a typed table — a typed-vs-AST diff would be noise. The combined tier is the
 * weaker of the two sides (a shipped-.d.ts vs JSDoc-emitted pair is honestly
 * 'api-extractor', not 'dts').
 */
async function computeDiffForRoots(
  oldRoot: string,
  newRoot: string,
  opts: { refIndex?: ReferenceIndex; packageName?: string } = {},
): Promise<SemanticDiff> {
  const [oldTyped, newTyped] = await Promise.all([buildTypedTable(oldRoot), buildTypedTable(newRoot)])

  let oldBuilt: { table: Map<string, ExportedSymbol>; unanalyzable: UnanalyzableSymbol[] }
  let newBuilt: { table: Map<string, ExportedSymbol>; unanalyzable: UnanalyzableSymbol[] }
  let tier: AnalysisTier

  if (oldTyped && newTyped) {
    oldBuilt = oldTyped
    newBuilt = newTyped
    tier = oldTyped.tier === 'dts' && newTyped.tier === 'dts' ? 'dts' : 'api-extractor'
  } else {
    tier = 'ast-only'
    const [oldJs, newJs] = await Promise.all([findJsFiles(oldRoot), findJsFiles(newRoot)])
    oldBuilt = buildAstSymbolTable(oldJs)
    newBuilt = buildAstSymbolTable(newJs)
  }

  const raw = diffSymbolTables(oldBuilt.table, newBuilt.table)
  // Coverage: based on the OLD version's symbol set (those are the symbols the
  // user's code might reference).
  const coveragePercent = computeCoveragePercent(oldBuilt.table.size, oldBuilt.unanalyzable.length)
  const affectedSitesInRepo =
    opts.refIndex && opts.packageName ? affectedSitesFromIndex(opts.refIndex, opts.packageName, raw) : []

  return SemanticDiffSchema.parse({
    ...raw,
    affectedSitesInRepo,
    coveragePercent,
    unanalyzableSymbols: oldBuilt.unanalyzable,
    analysisTier: tier,
  })
}

/** Cross-reference removed/changed symbols against user's repo. */
function affectedSitesFromIndex(
  refIndex: ReferenceIndex,
  packageName: string,
  raw: RawDiff,
): AffectedSite[] {
  // Build a map: importedName (from the package) → local alias(es) in the repo.
  const localByImported = new Map<string, Set<string>>()
  for (const imp of refIndex.imports) {
    if (imp.packageName !== packageName) continue
    if (!localByImported.has(imp.importedName)) localByImported.set(imp.importedName, new Set())
    localByImported.get(imp.importedName)!.add(imp.localName)
  }

  // Build a usages-by-local-name index for O(1) lookup.
  const filesByLocal = new Map<string, Set<string>>()
  for (const u of refIndex.usages) {
    if (!filesByLocal.has(u.symbol)) filesByLocal.set(u.symbol, new Set())
    filesByLocal.get(u.symbol)!.add(u.filePath)
  }

  // For each removed export / changed signature, look up usage files.
  const symbols = new Set<string>([
    ...raw.removedExports,
    ...raw.signatureChanges.map((s) => s.symbol),
    ...raw.newDeprecations,
  ])

  const out: AffectedSite[] = []
  for (const symbol of symbols) {
    const locals = localByImported.get(symbol)
    if (!locals || locals.size === 0) continue
    const files = new Set<string>()
    for (const local of locals) {
      const f = filesByLocal.get(local)
      if (f) for (const path of f) files.add(path)
    }
    if (files.size > 0) {
      out.push({ symbol, files: Array.from(files).sort() })
    }
  }
  out.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return out
}

/** Re-export for tests + downstream callers that need a `UsageSite` type. */
export type { UsageSite }

/** For tests / debugging: same as `parseSemanticDiff` but reads from local
 *  pre-extracted directories rather than the npm registry. Dispatches Tier-1
 *  → Tier-2 → Tier-3 the same way the public entry does. */
export async function parseSemanticDiffFromDirs(
  oldRoot: string,
  newRoot: string,
): Promise<SemanticDiff> {
  return computeDiffForRoots(oldRoot, newRoot)
}

/** Test-only exports — kept under a single `__testing` namespace so the
 *  public surface stays clean. */
export const __testing = {
  buildSymbolTable,
  buildAstSymbolTable,
  diffSymbolTables,
  findDtsFiles,
  findJsFiles,
  fetchPackageVersion,
  makeScopedWorkspace,
  affectedSitesFromIndex,
  // v1.5.1 Tier-2
  hasJsdocTypes,
  emitDeclarations,
  buildTypedTable,
}
