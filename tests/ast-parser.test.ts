import { describe, expect, it } from 'vitest'
import { parse } from '@typescript-eslint/typescript-estree'

// Test the AST parser using real-looking TypeScript code snippets — not synthetic.
// Uses @typescript-eslint/typescript-estree directly to test parsing is working.

function parseCode(code: string) {
  return parse(code, { jsx: true, loc: true, range: true, tolerant: true })
}

function collectImports(ast: ReturnType<typeof parseCode>, packageName: string) {
  const names: string[] = []
  for (const node of ast.body) {
    if (node.type !== 'ImportDeclaration') continue
    if (node.source.value !== packageName) continue
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier') {
        names.push(
          spec.imported.type === 'Identifier'
            ? spec.imported.name
            : (spec.imported as { value: string }).value,
        )
      } else if (spec.type === 'ImportDefaultSpecifier') {
        names.push('default')
      }
    }
  }
  return names
}

describe('ast-parser', () => {
  it('parses named imports from a package', () => {
    const code = `
      import { useQuery, useMutation } from '@tanstack/react-query'
      import { z } from 'zod'

      const schema = z.object({ id: z.string() })
    `
    const ast = parseCode(code)
    const tanstackImports = collectImports(ast, '@tanstack/react-query')
    expect(tanstackImports).toContain('useQuery')
    expect(tanstackImports).toContain('useMutation')

    const zodImports = collectImports(ast, 'zod')
    expect(zodImports).toContain('z')
  })

  it('parses default imports', () => {
    const code = `import React from 'react'`
    const ast = parseCode(code)
    const names = collectImports(ast, 'react')
    expect(names).toContain('default')
  })

  it('parses TypeScript generics without error', () => {
    const code = `
      import { create } from 'zustand'

      interface BearState {
        bears: number
        increase: (by: number) => void
      }

      const useStore = create<BearState>()((set) => ({
        bears: 0,
        increase: (by) => set((state) => ({ bears: state.bears + by })),
      }))
    `
    const ast = parseCode(code)
    expect(ast.body.length).toBeGreaterThan(0)
    const imports = collectImports(ast, 'zustand')
    expect(imports).toContain('create')
  })

  it('parses TSX with JSX syntax', () => {
    const code = `
      import { useQuery } from '@tanstack/react-query'

      function MyComponent() {
        const { data, isLoading } = useQuery({
          queryKey: ['todos'],
          queryFn: () => fetch('/api/todos').then(r => r.json()),
        })
        return <div>{isLoading ? 'Loading...' : data?.length}</div>
      }
    `
    const ast = parseCode(code)
    expect(ast.body.length).toBeGreaterThan(0)
  })

  it('throws on broken syntax (our parseFile wrapper returns null instead)', () => {
    // @typescript-eslint/typescript-estree throws TSError on unrecoverable syntax errors.
    // Our parseFile() wrapper catches this and returns null — tested in ast-parser.ts.
    const code = `
      import { z } from 'zod'
      const schema = z.object({
    `
    expect(() => parseCode(code)).toThrow()
  })

  it('finds identifier usages in code', () => {
    const code = `
      import { create } from 'zustand'
      const useStore = create(() => ({ count: 0 }))
      const useAnotherStore = create(() => ({ name: '' }))
    `
    const ast = parseCode(code)
    const identifiers: string[] = []
    function visit(node: { type: string; name?: string; [key: string]: unknown }) {
      if (node.type === 'Identifier' && node.name === 'create') {
        identifiers.push(node.name)
      }
      for (const val of Object.values(node)) {
        if (Array.isArray(val)) val.forEach((v) => v && typeof v === 'object' && visit(v as { type: string; name?: string }))
        else if (val && typeof val === 'object' && 'type' in val) visit(val as { type: string; name?: string })
      }
    }
    visit(ast as unknown as { type: string; name?: string })
    // 'create' appears: 1 import + 2 call sites = at least 2 usage nodes
    expect(identifiers.length).toBeGreaterThanOrEqual(2)
  })
})

/**
 * v2.2.x regression — path contract for findPackageUsageSites.
 *
 * buildReferenceIndex walks the tree with absolute paths, so usage-site
 * filePaths are ABSOLUTE. The runner MUST relativize them to pkgRoot
 * before handing them to patchFileSmart (which does
 * path.join(pkgRoot, filePath)). The MeteoalarmCard scan exposed the
 * miss: every AST file was joined as path.join(pkgRoot, <absolute>) →
 * garbage → "skip … not found" → Fix #4 silently disabled.
 *
 * This test pins: (a) usage-site paths are absolute under the repo root,
 * and (b) path.relative(root, filePath) yields the repo-relative path the
 * patcher expects.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { buildReferenceIndex, findPackageUsageSites } from '@/lib/agent/signals/ast-parser'

describe('findPackageUsageSites — path contract (v2.2.x regression)', () => {
  it('returns ABSOLUTE paths under the repo root; path.relative gives the patcher-relative path', () => {
    const root = mkdtempSync(nodePath.join(tmpdir(), 'mendel-ast-'))
    try {
      mkdirSync(nodePath.join(root, 'src'), { recursive: true })
      writeFileSync(
        nodePath.join(root, 'src', 'editor.ts'),
        `import { computeStateDisplay } from 'custom-card-helpers'\nexport const x = computeStateDisplay()\n`,
      )
      const index = buildReferenceIndex(root)
      const sites = findPackageUsageSites(index, 'custom-card-helpers')
      expect(sites.length).toBeGreaterThan(0)
      const fp = sites[0].filePath
      // (a) absolute, under root — the property the runner must account for
      expect(nodePath.isAbsolute(fp)).toBe(true)
      expect(fp.startsWith(root)).toBe(true)
      // (b) relativizing yields the patcher-relative path (src/editor.ts) —
      // exactly what the runner fix does before calling patchFileSmart.
      expect(nodePath.relative(root, fp)).toBe(nodePath.join('src', 'editor.ts'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
