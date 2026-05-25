'use client'

/**
 * S9 — Settings (DESIGN.md §11 S9). Rest mode.
 *
 * Audit-2 fixes applied here:
 *  - #2:  Preferences toggles REMOVED (they were decorative — owner call).
 *  - #8:  Save now actually validates via /api/validate-pat (was accept-any-string).
 *  - #14: PAT input has a show/hide toggle.
 *  - #12: Save / revoke fire toasts (silent successes felt broken).
 */

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { PanelFrame } from '@/components/phase-d/PanelFrame'
import { useToast } from '@/components/shared/toast'
import { useDocumentTitle } from '@/hooks/use-document-title'

const ABOUT: [string, string][] = [
  ['All PRs', 'Open as Drafts — you manually mark ready'],
  ['Confidence', 'Medium — changelog parsing only, no semantic diff'],
  ['Sandbox', 'Two-phase Docker: install (bridge) → verify (none)'],
  ['Token storage', 'Session only — never persisted to disk or server'],
  ['Max deps', '3 per scan in v1.0'],
]

interface ValidationInfo { login?: string; scopes?: string[] }

export default function SettingsPage() {
  useDocumentTitle('Settings')
  const toast = useToast()
  const [pat, setPat] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [info, setInfo] = useState<ValidationInfo | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('mendel_pat')
    if (stored) {
      setHasToken(true)
      setPat(stored.slice(0, 4) + '•'.repeat(Math.max(0, stored.length - 8)) + stored.slice(-4))
    }
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (pat.includes('•')) return
    setSaving(true)
    try {
      const res = await fetch('/api/validate-pat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pat: pat.trim() }),
      })
      const data = (await res.json()) as { valid: boolean; error?: string; login?: string; scopes?: string[] }
      if (!data.valid) {
        toast.error(data.error ?? 'PAT rejected by GitHub.')
        return
      }
      sessionStorage.setItem('mendel_pat', pat.trim())
      setHasToken(true)
      setInfo({ login: data.login, scopes: data.scopes })
      toast.success(data.login ? `Token saved · authenticated as ${data.login}` : 'Token saved.')
    } catch (err) {
      toast.error(`Validation failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  function handleRevoke() {
    sessionStorage.removeItem('mendel_pat')
    setPat('')
    setHasToken(false)
    setInfo(null)
    toast.info('Token revoked from this session.')
  }

  return (
    <div id="main" style={{ minHeight: '100vh', padding: '2.25rem 2rem', maxWidth: '720px' }}>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} style={{ marginBottom: '1.75rem' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>Mendel // Settings</p>
        <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>Settings</h1>
      </motion.div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
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
            <div style={{ position: 'relative' }}>
              <input
                type={revealed ? 'text' : 'password'} value={pat} onChange={(e) => setPat(e.target.value)}
                placeholder={hasToken ? '••••••••••••••••' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
                autoComplete="off" spellCheck={false}
                aria-label="GitHub personal access token"
                style={{ width: '100%', background: 'var(--bg-3, #222)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', padding: '0.75rem 3.25rem 0.75rem 1rem', outline: 'none' }}
              />
              <button
                type="button"
                onClick={() => setRevealed((v) => !v)}
                aria-label={revealed ? 'Hide token' : 'Show token'}
                style={{ position: 'absolute', right: 8, top: 8, padding: '0.3rem 0.55rem', background: 'transparent', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}
              >
                {revealed ? 'Hide' : 'Show'}
              </button>
            </div>
            {info?.login && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--accent-primary)' }}>
                ✓ Authenticated as <strong>{info.login}</strong>
                {info.scopes && info.scopes.length > 0 && (
                  <span style={{ color: 'var(--text-muted)' }}> · scopes: {info.scopes.join(', ')}</span>
                )}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="submit" disabled={!pat.trim() || pat.includes('•') || saving} className="btn-primary" style={{ flex: 1 }}>
                {saving ? 'Validating…' : 'Save Token'}
              </button>
              {hasToken && (
                <button type="button" onClick={handleRevoke} aria-label="Revoke saved token" style={{ padding: '0.5rem 1rem', border: '1px solid var(--accent-danger)', color: 'var(--accent-danger)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
                  Revoke
                </button>
              )}
            </div>
          </form>
        </PanelFrame>

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
