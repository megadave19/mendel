'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Skull } from '@/components/mascot/skull'

export default function SettingsPage() {
  const [pat, setPat] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const stored = sessionStorage.getItem('mendel_pat')
    if (stored) {
      setHasToken(true)
      // Show masked preview
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
    <div style={{ padding: '2.5rem 2rem', minHeight: '100vh', maxWidth: '600px' }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ marginBottom: '2.5rem' }}
      >
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.5625rem',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--accent-primary)',
          marginBottom: '0.5rem',
        }}>Mendel</p>
        <h1 style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.875rem',
          fontWeight: 700,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
          marginBottom: '0.25rem',
        }}>Settings</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Manage your GitHub token and preferences.
        </p>
      </motion.div>

      {/* PAT section */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5 }}
        style={{
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-1)',
          padding: '1.5rem',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
          <Skull state={hasToken ? 'idle' : 'waiting'} size={40} />
          <div>
            <h2 style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.875rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginBottom: '0.25rem',
            }}>GitHub Personal Access Token</h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {hasToken ? 'Token active — stored in session only' : 'No token connected'}
            </p>
          </div>
          {hasToken && (
            <span style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.5625rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--accent-primary)',
              border: '1px solid var(--accent-primary)',
              padding: '0.25rem 0.5rem',
            }}>
              Active
            </span>
          )}
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{
              display: 'block',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.5625rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: '0.5rem',
            }}>
              Token {hasToken ? '(click to update)' : ''}
            </label>
            <input
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder={hasToken ? '••••••••••••••••' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%',
                background: 'var(--bg-2)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8125rem',
                padding: '0.75rem 1rem',
                outline: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="submit"
              disabled={!pat.trim() || pat.includes('•')}
              className="btn-primary"
              style={{ flex: 1 }}
            >
              {saved ? 'Saved ✓' : 'Save Token'}
            </button>
            {hasToken && (
              <button
                type="button"
                onClick={handleRevoke}
                style={{
                  padding: '0.5rem 1rem',
                  border: '1px solid var(--accent-danger)',
                  color: 'var(--accent-danger)',
                  background: 'transparent',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.625rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Revoke
              </button>
            )}
          </div>
        </form>
      </motion.div>

      {/* Info section */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        style={{
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-1)',
          padding: '1.5rem',
        }}
      >
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.5625rem',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: '1rem',
        }}>About Mendel v1.0</p>
        {[
          ['All PRs', 'Open as Drafts — you manually mark ready'],
          ['Confidence', 'Medium — changelog parsing only, no semantic diff'],
          ['Sandbox', 'Two-phase Docker: install (bridge) → verify (none)'],
          ['Token storage', 'Session only — never persisted to disk or server'],
          ['Max deps', '3 per scan in v1.0'],
        ].map(([key, val]) => (
          <div key={key} style={{ display: 'flex', gap: '1rem', marginBottom: '0.5rem' }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.6875rem',
              color: 'var(--accent-secondary)',
              minWidth: '100px',
              flexShrink: 0,
            }}>{key}</span>
            <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{val}</span>
          </div>
        ))}
      </motion.div>
    </div>
  )
}
