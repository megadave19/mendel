import { AppNav } from '@/components/shared/nav'
import { CRTOverlay } from '@/components/shared/crt-overlay'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-0)' }}>
      <CRTOverlay />
      <AppNav />
      <main style={{
        flex: 1,
        marginLeft: '220px',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {children}
      </main>
    </div>
  )
}
