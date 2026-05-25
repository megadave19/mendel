'use client'

import { useEffect } from 'react'

/**
 * Fix #13 (audit-2) — sets the browser tab title from client components
 * (Next App Router doesn't allow `export const metadata` from 'use client'
 * files). Static crawler-facing meta still comes from the root layout.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const prev = document.title
    document.title = title.endsWith('Mendel') ? title : `${title} · Mendel`
    return () => {
      document.title = prev
    }
  }, [title])
}
