'use client'

/**
 * S9 — Settings (DESIGN.md §11 S9). Rest mode.
 * Bordered panels: PAT (status pill + save/revoke), Preferences (reduce-motion,
 * mascot, sound[v1.5-disabled]), About. PAT stays session-only (trust copy kept).
 */

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { PanelFrame } from '@/components/phase-d/PanelFrame'

const ABOUT: [string, string][] = [
  ['All PRs', 'Open as Drafts — you manually mark ready'],
  ['Confidence', 'Medium — changelog parsing only, no semantic diff'],
  ['Sandbox', 'Two-phase Docker: install (bridge) → verify (none)'],
  ['Token storage', 'Session only — never persisted to disk or server'],
  ['Max deps', '3 per scan in v1.0'],
]

export default function SettingsPage() {
  const [pat, setPat] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [saved, setSaved] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [mascotOn, setMascotOn] = useState(true)

  useEffect(() => {
    const stored = sessionStorage.getItem('mendel_pat')
    if (stored) {
      setHasToken(true)
      setPat(stored.slice(0, 4) + '•'.repeat(Math.max(0, stored.length - 8)) + stored.slice(-4))
    }
  }, [])

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!pat.includes('•')) {
      sessionStorage.setItem('mendel_pat', pat.trim())
      setHasToken(true)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  function handleRevoke() {
    sessionStorage.removeItem('mendel_pat')
    setPat('')
    setHasToken(false)
  }

  return (
    <div style={{ minHeight: '100vh', padding: '2.25rem 2rem', maxWidth: '720px' }}>
      {/* Header (one mascot per screen — the sidebar carries it) */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} style={{ marginBottom: '1.75rem' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>Mendel // Settings</p>
        <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>Settings</h1>
      </motion.div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* PAT panel */}
        <PanelFrame
          title="GitHub Personal Access Token"
          accent={hasToken ? 'var(--accent-primary)' : 'var(--text-muted)'}
          meta={
            <span style={{ color: hasToken ? 'var(--accent-primary)' : 'var(--text-muted)', border: `1px solid ${hasToken ? 'var(--accent-primary)' : 'var(--border-strong)'}`, padding: '0.1rem 0.4rem' }}>
              {hasToken ? 'ACTIVE' : 'NONE'}
            </span>
          }
        >
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.875rem' }}>
            {hasToken ? 'Token active — stored in session only.' : 'No token connected. Stored in session only, never on disk or server.'}
          </p>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <input
              type="password" value={pat} onChange={(e) => setPat(e.target.value)}
              placeholder={hasToken ? '••••••••••••••••' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
              autoComplete="off" spellCheck={false}
              style={{ width: '100%', background: 'var(--bg-3, #222)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', padding: '0.75rem 1rem', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="submit" disabled={!pat.trim() || pat.includes('•')} className="btn-primary" style={{ flex: 1 }}>
                {saved ? 'Saved ✓' : 'Save Token'}
              </button>
              {hasToken && (
                <button type="button" onClick={handleRevoke} style={{ padding: '0.5rem 1rem', border: '1px solid var(--accent-danger)', color: 'var(--accent-danger)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
                  Revoke
                </button>
              )}
            </div>
          </form>
        </PanelFrame>

        {/* Preferences panel */}
        <PanelFrame title="Preferences">
          <Toggle label="Reduce motion" on={reduceMotion} onToggle={() => setReduceMotion((v) => !v)} />
          <Toggle label="Mascot (Bones)" on={mascotOn} onToggle={() => setMascotOn((v) => !v)} />
          <Toggle label="Sound" on={false} disabled note="v1.5" />
        </PanelFrame>

        {/* About panel */}
        <PanelFrame title="About Mendel v1.0">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {ABOUT.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: '1rem' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--accent-secondary)', minWidth: '110px', flexShrink: 0 }}>{k}</span>
                <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{v}</span>
              </div>
            ))}
          </div>
        </PanelFrame>
      </div>
    </div>
  )
}

function Toggle({ label, on, onToggle, disabled, note }: { label: string; on: boolean; onToggle?: () => void; disabled?: boolean; note?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', opacity: disabled ? 0.5 : 1 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {label}
        {note && <span style={{ fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', border: '1px solid var(--border-strong)', padding: '0.05rem 0.3rem' }}>{note}</span>}
      </span>
      <button
        type="button" onClick={onToggle} disabled={disabled} aria-pressed={on}
        style={{ width: 40, height: 20, borderRadius: 999, border: `1px solid ${on ? 'var(--accent-primary)' : 'var(--border-strong)'}`, background: on ? 'var(--accent-primary)' : 'transparent', position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all 160ms' }}
      >
        <span style={{ position: 'absolute', top: 2, left: on ? 22 : 2, width: 14, height: 14, borderRadius: '50%', background: on ? 'var(--bg-0)' : 'var(--text-muted)', transition: 'left 160ms' }} />
      </button>
    </div>
  )
}
