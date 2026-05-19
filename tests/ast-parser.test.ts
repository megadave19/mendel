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
