import { parse } from '@typescript-eslint/typescript-estree'
import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import type { TSESTree } from '@typescript-eslint/typescript-estree'

export interface ImportSite {
  /** Package the symbol is imported from */
  packageName: string
  /** Named or default import — 'default' for default imports */
  importedName: string
  /** Local alias in the file */
  localName: string
  filePath: string
  line: number
}

export interface UsageSite {
  symbol: string
  filePath: string
  line: number
  column: number
  context: string
}

export interface ReferenceIndex {
  imports: ImportSite[]
  usages: UsageSite[]
  files: string[]
  parseErrors: Array<{ filePath: string; error: string }>
}

// ─── Single-file parsing ──────────────────────────────────────────────────────

function isTs(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)
}

function parseFile(filePath: string): TSESTree.Program | null {
  const code = readFileSync(filePath, 'utf-8')
  try {
    return parse(code, {
      jsx: true,
      range: true,
      loc: true,
      tolerant: true,
    })
  } catch {
    return null
  }
}

// ─── Import extraction ────────────────────────────────────────────────────────

function extractImports(ast: TSESTree.Program, filePath: string): ImportSite[] {
  const sites: ImportSite[] = []

  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue
    const packageName = node.source.value as string

    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportDefaultSpecifier') {
        sites.push({
          packageName,
          importedName: 'default',
          localName: specifier.local.name,
          filePath,
          line: specifier.loc?.start.line ?? 0,
        })
      } else if (specifier.type === 'ImportSpecifier') {
        const importedName =
          specifier.imported.type === 'Identifier'
            ? specifier.imported.name
            : (specifier.imported as TSESTree.StringLiteral).value
        sites.push({
          packageName,
          importedName,
          localName: specifier.local.name,
          filePath,
          line: specifier.loc?.start.line ?? 0,
        })
      } else if (specifier.type === 'ImportNamespaceSpecifier') {
        sites.push({
          packageName,
          importedName: '*',
          localName: specifier.local.name,
          filePath,
          line: specifier.loc?.start.line ?? 0,
        })
      }
    }
  }

  return sites
}

// ─── Usage extraction ─────────────────────────────────────────────────────────

function extractUsages(
  ast: TSESTree.Program,
  localNames: Set<string>,
  filePath: string,
): UsageSite[] {
  const sites: UsageSite[] = []
  const lines = readFileSync(filePath, 'utf-8').split('\n')

  function visit(node: TSESTree.Node | null | undefined): void {
    if (!node || typeof node !== 'object') return

    if (
      node.type === 'Identifier' &&
      localNames.has(node.name) &&
      node.loc
    ) {
      const lineIdx = node.loc.start.line - 1
      sites.push({
        symbol: node.name,
        filePath,
        line: node.loc.start.line,
        column: node.loc.start.column,
        context: lines[lineIdx]?.trim() ?? '',
      })
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        value.forEach((child) => visit(child as TSESTree.Node))
      } else if (value && typeof value === 'object' && 'type' in value) {
        visit(value as TSESTree.Node)
      }
    }
  }

  visit(ast)
  return sites
}

// ─── Repository indexing ──────────────────────────────────────────────────────

function collectTsFiles(dir: string, files: string[] = []): string[] {
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage'])

  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) collectTsFiles(full, files)
    else if (isTs(full)) files.push(full)
  }

  return files
}

export function buildReferenceIndex(repoPath: string): ReferenceIndex {
  const files = collectTsFiles(repoPath)
  const index: ReferenceIndex = { imports: [], usages: [], files, parseErrors: [] }

  for (const filePath of files) {
    const ast = parseFile(filePath)
    if (!ast) {
      index.parseErrors.push({ filePath, error: 'parse failed' })
      continue
    }
    const imports = extractImports(ast, filePath)
    index.imports.push(...imports)
  }

  // Second pass: find usages of every imported local name
  const localNames = new Set(index.imports.map((i) => i.localName))

  for (const filePath of files) {
    const ast = parseFile(filePath)
    if (!ast) continue
    index.usages.push(...extractUsages(ast, localNames, filePath))
  }

  return index
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export function findImportsFrom(index: ReferenceIndex, packageName: string): ImportSite[] {
  return index.imports.filter((i) => i.packageName === packageName)
}

export function findUsagesOf(index: ReferenceIndex, symbolName: string): UsageSite[] {
  return index.usages.filter((u) => u.symbol === symbolName)
}

export function findPackageUsageSites(
  index: ReferenceIndex,
  packageName: string,
): UsageSite[] {
  const imports = findImportsFrom(index, packageName)
  const localNames = new Set(imports.map((i) => i.localName))
  return index.usages.filter((u) => localNames.has(u.symbol))
}
