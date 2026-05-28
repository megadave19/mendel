'use client'

/**
 * Fix #7 — /connect is a pre-auth screen; rendering the full AppNav sidebar
 * there is confusing UX. Hide the sidebar (and its left margin) for /connect
 * while keeping it on every other (app) route.
 */

import { usePathname } from 'next/navigation'
import { AppNav } from '@/components/shared/nav'
import { CRTOverlay } from '@/components/shared/crt-overlay'
import { MascotPhaseProvider } from '@/components/mascot-phase-context'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isPreAuth = pathname === '/connect'

  return (
    <MascotPhaseProvider>
      <div className="app-shell" style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-0)' }}>
        <CRTOverlay />
        {!isPreAuth && <AppNav />}
        <main
          id="main"
          className={isPreAuth ? undefined : 'app-main'}
          style={{
            flex: 1,
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {children}
        </main>
      </div>
    </MascotPhaseProvider>
  )
}
