'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { Skull } from '@/components/mascot/skull'
import type { MascotState } from '@/components/mascot/skull'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '◈' },
  { href: '/scan/new', label: 'New Scan', icon: '⟳' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
]

interface NavProps {
  mascotState?: MascotState
}

export function AppNav({ mascotState = 'idle' }: NavProps) {
  const pathname = usePathname()

  return (
    <nav style={{
      width: '220px',
      minHeight: '100vh',
      background: 'var(--bg-1)',
      borderRight: '1px solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      padding: '1.5rem 0',
      position: 'fixed',
      top: 0,
      left: 0,
      zIndex: 50,
    }}>
      {/* Logo */}
      <div style={{ padding: '0 1.25rem 2rem' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
          <Skull state="idle" size={28} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: '0.875rem',
            letterSpacing: '0.1em',
            color: 'var(--accent-primary)',
          }}>
            MENDEL
          </span>
        </Link>
      </div>

      {/* Nav items */}
      <div style={{ flex: 1, padding: '0 0.75rem' }}>
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.5625rem',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          padding: '0 0.5rem',
          marginBottom: '0.5rem',
        }}>Navigation</p>

        {NAV_ITEMS.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.625rem 0.75rem',
                marginBottom: '0.125rem',
                borderRadius: '2px',
                textDecoration: 'none',
                background: active ? 'rgba(198,255,61,0.06)' : 'transparent',
                borderLeft: active ? '2px solid var(--accent-primary)' : '2px solid transparent',
                transition: 'background 0.15s, border-color 0.15s',
              }}
            >
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.875rem',
                color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
              }}>{icon}</span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                fontWeight: 500,
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                letterSpacing: '0.05em',
              }}>{label}</span>
              {active && (
                <motion.div
                  layoutId="nav-indicator"
                  style={{
                    marginLeft: 'auto',
                    width: '4px',
                    height: '4px',
                    borderRadius: '50%',
                    background: 'var(--accent-primary)',
                  }}
                />
              )}
            </Link>
          )
        })}
      </div>

      {/* Mascot in sidebar */}
      <div style={{
        padding: '1.5rem 1.25rem',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.75rem',
      }}>
        <Skull state={mascotState} size={56} showLabel />
      </div>

      {/* Confidence badge */}
      <div style={{ padding: '0.75rem 1rem 0.5rem' }}>
        <span className="confidence-badge" style={{ fontSize: '0.5rem', width: '100%', justifyContent: 'center' }}>
          All PRs → Drafts
        </span>
      </div>
    </nav>
  )
}
