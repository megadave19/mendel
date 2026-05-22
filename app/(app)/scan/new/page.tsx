'use client'

/**
 * S3 — New Scan (DESIGN.md §11 S3). Rest mode.
 * One-input scan starter. Constraints render as a real bordered amber warning
 * panel (anti-ref §13: not flat text). On submit the button morphs to
 * INITIALIZING… then navigates to the live console.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { PanelFrame } from '@/components/phase-d/PanelFrame'

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const clean = url.trim().replace(/\.git$/, '')
    const match = clean.match(/github\.com[/:]([\w.-]+)\/([\w.-]+)/)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  } catch {
    return null
  }
}

const CONSTRAINTS = [
  'Public repositories only',
  'Single-package repos (no monorepos)',
  'TypeScript projects preferred',
  'Max 3 deps patched per scan',
]

export default function NewScanPage() {
  const router = useRouter()
  const [repoUrl, setRepoUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'starting' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const parsed = parseGitHubUrl(repoUrl)
  const isValid = !!parsed

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    if (!parsed) return
    setStatus('starting')
    setErrorMsg('')
    const pat = sessionStorage.getItem('mendel_pat') ?? ''
    try {
      const res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`, pat }),
      })
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`)
      }
      const { id } = (await res.json()) as { id: string }
      router.push(`/scan/${id}`)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start scan')
    }
  }

  const borderColor = status === 'error' ? 'var(--accent-danger)' : isValid ? 'var(--accent-primary)' : 'var(--border-strong)'

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem 2rem' }}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{ width: '100%', maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
      >
        {/* Header (one mascot per screen — the sidebar carries it) */}
        <div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
            Mendel // New Scan
          </p>
          <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            Scan a Repository
          </h1>
        </div>

        <form onSubmit={handleScan} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <PanelFrame title="GitHub Repository URL" accent={isValid ? 'var(--accent-primary)' : 'var(--text-muted)'}>
            <div style={{ display: 'flex' }}>
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => { setRepoUrl(e.target.value); setStatus('idle'); setErrorMsg('') }}
                placeholder="https://github.com/owner/repo"
                autoFocus
                spellCheck={false}
                style={{
                  flex: 1, background: 'var(--bg-3, #222)', color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', padding: '0.875rem 1rem',
                  outline: 'none',
                  borderTop: `1px solid ${borderColor}`, borderBottom: `1px solid ${borderColor}`,
                  borderLeft: `1px solid ${borderColor}`, borderRight: 'none', transition: 'border-color 0.2s',
                }}
              />
              <button type="submit" disabled={!isValid || status === 'starting'} className="btn-primary" style={{ borderRadius: 0, padding: '0.875rem 1.5rem', whiteSpace: 'nowrap' }}>
                {status === 'starting' ? 'INITIALIZING…' : 'Scan →'}
              </button>
            </div>
            {parsed && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: '0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--accent-primary)' }}>
                ✓ {parsed.owner} / {parsed.repo}
              </motion.p>
            )}
            {errorMsg && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: '0.625rem', fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--accent-danger)' }}>
                ✕ {errorMsg}
              </motion.p>
            )}
          </PanelFrame>

          {/* Constraints — real bordered amber warning panel */}
          <div style={{ border: '1px solid var(--accent-warning)', background: 'rgba(255,184,77,0.05)', padding: '1rem 1.1rem' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--accent-warning)', marginBottom: '0.625rem' }}>
              ⚠ Constraints · v1.0
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem 1rem' }}>
              {CONSTRAINTS.map((c) => (
                <p key={c} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.4rem' }}>
                  <span style={{ color: 'var(--accent-warning)' }}>·</span> {c}
                </p>
              ))}
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
