'use client'

/**
 * Fix #7 — /connect is a pre-auth screen; rendering the full AppNav sidebar
 * there is confusing UX. Hide the sidebar (and its left margin) for /connect
 * while keeping it on every other (app) route.
 */

import { usePathname } from 'next/navigation'
import { AppNav } from '@/components/shared/nav'
import { CRTOverlay } from '@/components/shared/crt-overlay'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isPreAuth = pathname === '/connect'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-0)' }}>
      <CRTOverlay />
      {!isPreAuth && <AppNav />}
      <main
        style={{
          flex: 1,
          marginLeft: isPreAuth ? 0 : '220px',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {children}
      </main>
    </div>
  )
}
