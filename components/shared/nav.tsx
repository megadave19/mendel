'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { BonesMascot } from '@/components/BonesMascot'
import { useMascotPhase } from '@/components/mascot-phase-context'
import { useMascotEnabled } from '@/hooks/use-user-prefs'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '◈' },
  { href: '/scan/new', label: 'New Scan', icon: '⟳' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
]

/**
 * AppNav — sidebar shell. Hosts the single Bones mascot for the whole app
 * (DESIGN.md §8: one mascot, present along the journey). The mascot reacts
 * to the current scan phase via MascotPhaseContext; pages call setPhase()
 * from an effect.
 *
 * Previous incarnation rendered TWO instances of an old 2D Skull component
 * (28px in the logo row + 56px in the sidebar slot) AND let other screens
 * render their own standalone 3D MascotWidget — three mascot identities on
 * one screen at worst. Removed.
 */
export function AppNav() {
  // v2.0 — read the Settings "Show mascot" toggle. Closes §7.2a dead-control
  // gap: previously the toggle wrote localStorage but nothing read it.
  const mascotVisible = useMascotEnabled()
  const pathname = usePathname()
  const { phase } = useMascotPhase()

  return (
    <nav
      aria-label="Primary navigation"
      className="nav-sidebar"
      style={{
        background: 'var(--bg-1)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        padding: '1.5rem 0',
        zIndex: 50,
      }}
    >
      {/* Wordmark (no mascot here — the mascot lives in the sidebar slot below). */}
      <div style={{ padding: '0 1.25rem 2rem' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
          <span aria-hidden style={{ width: 6, height: 6, background: 'var(--accent-primary)', boxShadow: 'var(--glow-primary)' }} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: '0.875rem',
            letterSpacing: '0.18em',
            color: 'var(--accent-primary)',
          }}>
            MENDEL
          </span>
        </Link>
      </div>

      {/* Nav items */}
      <div className="nav-sidebar-items" style={{ flex: 1, padding: '0 0.75rem' }}>
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

      {/* Sole mascot for the entire app — reacts to the current phase.
          Hidden when the user disables "Show mascot" in Settings. We render
          nothing (vs. a 0-height placeholder) so the sidebar gracefully
          collapses. Use data-mascot-slot so e2e tests can assert visibility. */}
      {mascotVisible && (
        <div className="nav-sidebar-mascot" data-mascot-slot="visible" style={{
          padding: '1rem 0.5rem 1.25rem',
          borderTop: '1px solid var(--border-subtle)',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.625rem',
        }}>
          <BonesMascot pose={phase} size={180} />
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.5625rem',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
          }}>
            bones · {phase}
          </span>
        </div>
      )}

      {/* Confidence badge — hidden in top-bar mode */}
      <div className="nav-sidebar-badge" style={{ padding: '0.75rem 1rem 0.5rem' }}>
        <span className="confidence-badge" style={{ fontSize: '0.5rem', width: '100%', justifyContent: 'center' }}>
          All PRs → Drafts
        </span>
      </div>
    </nav>
  )
}
