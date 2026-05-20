'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Skull } from '@/components/mascot/skull'
import type { MascotState } from '@/components/mascot/skull'

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

export default function NewScanPage() {
  const router = useRouter()
  const [repoUrl, setRepoUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'starting' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const parsed = parseGitHubUrl(repoUrl)
  const isValid = !!parsed

  const mascotState: MascotState =
    status === 'starting' ? 'scanning'
    : status === 'error' ? 'error'
    : isValid ? 'thinking'
    : 'idle'

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
        body: JSON.stringify({
          repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
          pat,
        }),
      })

      if (!res.ok) {
        const body = await res.json() as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const { id } = await res.json() as { id: string }
      router.push(`/scan/${id}`)
    } catch (err) {
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start scan')
    }
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '3rem 2rem',
    }}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{ width: '100%', maxWidth: '540px' }}
      >
        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.5625rem',
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--accent-primary)',
            marginBottom: '0.5rem',
          }}>
            New Scan
          </p>
          <h1 style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '2rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
            marginBottom: '0.5rem',
          }}>
            Scan a Repository
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Paste a public GitHub repo URL. Mendel will detect stale deps,
            generate patches, and open a Draft PR.
          </p>
        </div>

        {/* Mascot */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
          <Skull state={mascotState} size={72} showLabel />
        </div>

        {/* Form */}
        <form onSubmit={handleScan} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
              GitHub Repository URL
            </label>
            <div style={{ display: 'flex', gap: '0', position: 'relative' }}>
              <input
                type="url"
                value={repoUrl}
                onChange={(e) => { setRepoUrl(e.target.value); setStatus('idle'); setErrorMsg('') }}
                placeholder="https://github.com/owner/repo"
                autoFocus
                spellCheck={false}
                style={{
                  flex: 1,
                  background: 'var(--bg-2)',
                  border: `1px solid ${status === 'error' ? 'var(--accent-danger)' : isValid ? 'var(--accent-primary)' : 'var(--border-strong)'}`,
                  borderRight: 'none',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8125rem',
                  padding: '0.875rem 1rem',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
              />
              <button
                type="submit"
                disabled={!isValid || status === 'starting'}
                className="btn-primary"
                style={{ borderRadius: 0, padding: '0.875rem 1.5rem', whiteSpace: 'nowrap' }}
              >
                {status === 'starting' ? '...' : 'Scan →'}
              </button>
            </div>

            {/* Parsed preview */}
            {parsed && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{
                  marginTop: '0.5rem',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.6875rem',
                  color: 'var(--accent-primary)',
                }}
              >
                ✓ {parsed.owner} / {parsed.repo}
              </motion.p>
            )}

            {errorMsg && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{
                  marginTop: '0.5rem',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.6875rem',
                  color: 'var(--accent-danger)',
                }}
              >
                ✕ {errorMsg}
              </motion.p>
            )}
          </div>

          {/* Constraints */}
          <div style={{
            background: 'var(--bg-2)',
            padding: '1rem',
            borderLeft: '2px solid var(--border-subtle)',
          }}>
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.5625rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: '0.5rem',
            }}>Constraints (v1.0)</p>
            {[
              'Public repositories only',
              'Single-package repos (no monorepos)',
              'TypeScript projects preferred',
              'Max 3 deps patched per scan',
            ].map((c) => (
              <p key={c} style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                · {c}
              </p>
            ))}
          </div>
        </form>
      </motion.div>
    </div>
  )
}
