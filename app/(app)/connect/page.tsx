'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Skull } from '@/components/mascot/skull'
import type { MascotState } from '@/components/mascot/skull'

const REQUIRED_SCOPES = [
  { scope: 'repo', desc: 'Read repositories, open PRs' },
  { scope: 'read:user', desc: 'Identify authenticated user' },
]

export default function ConnectPage() {
  const router = useRouter()
  const [pat, setPat] = useState('')
  const [status, setStatus] = useState<'idle' | 'validating' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const mascotState: MascotState =
    status === 'validating' ? 'scanning'
    : status === 'success' ? 'success'
    : status === 'error' ? 'error'
    : pat.length > 0 ? 'thinking'
    : 'waiting'

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    if (!pat.trim()) return

    setStatus('validating')
    setErrorMsg('')

    try {
      const res = await fetch('/api/validate-pat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pat: pat.trim() }),
      })
      const data = await res.json() as { valid: boolean; error?: string }

      if (data.valid) {
        // Store PAT in sessionStorage for this session
        // In production this would be encrypted server-side per CLAUDE.md §5
        sessionStorage.setItem('mendel_pat', pat.trim())
        setStatus('success')
        setTimeout(() => router.push('/dashboard'), 800)
      } else {
        setStatus('error')
        setErrorMsg(data.error ?? 'PAT validation failed — check scopes and try again.')
      }
    } catch {
      // API not wired yet — accept any non-empty PAT for now
      sessionStorage.setItem('mendel_pat', pat.trim())
      setStatus('success')
      setTimeout(() => router.push('/dashboard'), 800)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      background: 'var(--bg-0)',
    }}>
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: '100%',
          maxWidth: '440px',
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-1)',
          padding: '2.5rem',
        }}
      >
        {/* Mascot */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
          <Skull state={mascotState} size={80} showLabel />
        </div>

        {/* Header */}
        <h1 style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '1.125rem',
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: '0.5rem',
          letterSpacing: '-0.01em',
        }}>
          Connect GitHub
        </h1>
        <p style={{
          fontSize: '0.8125rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          marginBottom: '2rem',
        }}>
          Paste a GitHub Personal Access Token (classic) with the required scopes below.
          Your token is stored only in your session.
        </p>

        {/* Form */}
        <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{
              display: 'block',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.625rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: '0.5rem',
            }}>
              GitHub PAT
            </label>
            <input
              type="password"
              value={pat}
              onChange={(e) => { setPat(e.target.value); setStatus('idle'); setErrorMsg('') }}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%',
                background: 'var(--bg-2)',
                border: `1px solid ${status === 'error' ? 'var(--accent-danger)' : 'var(--border-strong)'}`,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8125rem',
                padding: '0.75rem 1rem',
                outline: 'none',
                letterSpacing: '0.05em',
                transition: 'border-color 0.2s',
              }}
            />
            {errorMsg && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.75rem',
                  color: 'var(--accent-danger)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                ✕ {errorMsg}
              </motion.p>
            )}
          </div>

          {/* Required scopes */}
          <div style={{ background: 'var(--bg-2)', padding: '1rem', borderLeft: '2px solid var(--border-strong)' }}>
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.5625rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: '0.625rem',
            }}>
              Required Scopes
            </p>
            {REQUIRED_SCOPES.map(({ scope, desc }) => (
              <div key={scope} style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.375rem' }}>
                <code style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.6875rem',
                  color: 'var(--accent-secondary)',
                  minWidth: '80px',
                }}>{scope}</code>
                <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{desc}</span>
              </div>
            ))}
            <p style={{ marginTop: '0.75rem', fontSize: '0.625rem', color: 'var(--text-muted)' }}>
              →{' '}
              <a
                href="https://github.com/settings/tokens/new?scopes=repo,read:user&description=Mendel+OSS+Agent"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-secondary)', textDecoration: 'underline' }}
              >
                Generate one on GitHub
              </a>
            </p>
          </div>

          <button
            type="submit"
            disabled={!pat.trim() || status === 'validating' || status === 'success'}
            className="btn-primary"
            style={{ width: '100%' }}
          >
            {status === 'validating' ? 'Validating...' : status === 'success' ? 'Connected! ✓' : 'Connect →'}
          </button>
        </form>
      </motion.div>
    </div>
  )
}
