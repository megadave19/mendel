'use client'

/**
 * S2 — Connect (Pre-auth PAT entry). Per DESIGN.md §11 S2 it's specified as a
 * modal but we ship it as a standalone route because /scan/new gates on it
 * and modal-from-route is messy in App Router.
 *
 * Audit rebuild 2026-05-27: was a tiny centered card floating in ~80% empty
 * black canvas (worst Nixtio violation in the app, per CLAUDE.md anti-patterns).
 * Now a split layout: left = product hero with "what Mendel does" + journey
 * preview; right = the auth form (unchanged in functional behavior). Mobile
 * stacks to single column.
 */

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { BonesMascot, type MascotPose } from '@/components/BonesMascot'
import { useDocumentTitle } from '@/hooks/use-document-title'

const REQUIRED_SCOPES = [
  { scope: 'repo', desc: 'Read repositories, open PRs' },
  { scope: 'read:user', desc: 'Identify authenticated user' },
]

const JOURNEY: { step: string; label: string; detail: string; accent: string }[] = [
  { step: '01', label: 'Connect',  detail: 'Paste a GitHub PAT, stays in-session only',          accent: 'var(--accent-secondary)' },
  { step: '02', label: 'Scan',     detail: 'Mendel reads your manifest + parses changelogs',     accent: 'var(--accent-secondary)' },
  { step: '03', label: 'Diagnose', detail: 'Identifies breaking-change deps, cites evidence',    accent: 'var(--accent-primary)' },
  { step: '04', label: 'Patch',    detail: 'Generates migration patches, verifies in sandbox',   accent: 'var(--accent-primary)' },
  { step: '05', label: 'Deliver',  detail: 'Opens a Draft PR — you review + merge',              accent: 'var(--accent-primary)' },
]

const PROMISES = [
  'Token stored only in your browser session',
  'Never transmitted to anyone but GitHub',
  'All PRs open as Drafts — never auto-merged',
  'Open source, open prompt logs',
]

// Suspense wrapper — useSearchParams in the child requires it for static prerender.
export default function ConnectPage() {
  return (
    <Suspense fallback={null}>
      <ConnectForm />
    </Suspense>
  )
}

function ConnectForm() {
  useDocumentTitle('Connect GitHub')
  const router = useRouter()
  const params = useSearchParams()
  // Fix #3 (audit-2): honor ?return= so we deep-link back to /scan/new etc.
  const returnTo = params.get('return') ?? '/dashboard'
  const [pat, setPat] = useState('')
  const [status, setStatus] = useState<'idle' | 'validating' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const pose: MascotPose =
    status === 'validating' ? 'scanning'
    : status === 'success' ? 'success'
    : status === 'error' ? 'error'
    : pat.length > 0 ? 'thinking'
    : 'idle'

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
      const data = (await res.json()) as { valid: boolean; error?: string }

      if (data.valid) {
        sessionStorage.setItem('mendel_pat', pat.trim())
        setStatus('success')
        setTimeout(() => router.push(returnTo), 800)
      } else {
        setStatus('error')
        setErrorMsg(data.error ?? 'PAT rejected by GitHub.')
      }
    } catch (err) {
      // Fix #1: do NOT fall through to "accept anything" on network error —
      // that was the false-trust bug. Surface the failure and block submit.
      setStatus('error')
      setErrorMsg(
        `Could not reach validation endpoint: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', display: 'flex', flexDirection: 'column' }}>
      {/* Slim top bar — adds branding so the page doesn't read as "raw form". */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1.25rem 2rem', borderBottom: '1px solid var(--border-subtle)',
      }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}>
          <span aria-hidden style={{ width: 6, height: 6, background: 'var(--accent-primary)', boxShadow: 'var(--glow-primary)' }} />
          <span style={{
            fontFamily: 'var(--font-mono)', fontWeight: 700,
            fontSize: '0.8125rem', letterSpacing: '0.18em',
            color: 'var(--accent-primary)',
          }}>MENDEL</span>
        </Link>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>
          v1.0 · draft-only · medium confidence
        </span>
      </header>

      {/* Split layout: left product hero · right auth form */}
      <div className="connect-grid" style={{
        flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 480px',
        minHeight: 0,
      }}>
        {/* ── LEFT: product hero ─────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{
            padding: '3.5rem 3rem',
            display: 'flex', flexDirection: 'column', gap: '2.5rem',
            borderRight: '1px solid var(--border-subtle)',
            overflowY: 'auto',
          }}
        >
          <div>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
              letterSpacing: '0.25em', textTransform: 'uppercase',
              color: 'var(--accent-primary)', marginBottom: '0.75rem',
            }}>
              Autonomous OSS Maintenance
            </p>
            <h1 style={{
              fontFamily: 'var(--font-mono)', fontSize: '2.5rem', fontWeight: 700,
              color: 'var(--text-primary)', letterSpacing: '-0.02em',
              lineHeight: 1.15, marginBottom: '1rem',
            }}>
              Stale deps in.<br />
              <span style={{ color: 'var(--accent-primary)', textShadow: 'var(--glow-primary)' }}>
                Draft PRs out.
              </span>
            </h1>
            <p style={{
              fontSize: '0.9375rem', color: 'var(--text-secondary)',
              lineHeight: 1.6, maxWidth: '50ch',
            }}>
              Mendel reads your repository, finds dependencies with breaking-change
              upgrades available, generates migration patches with cited evidence,
              verifies them in an isolated sandbox, and opens a Draft PR — always honest
              about what it didn&apos;t check.
            </p>
          </div>

          {/* Journey timeline — replaces the empty void with the actual product narrative */}
          <div>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.5rem',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              color: 'var(--text-muted)', marginBottom: '1rem',
            }}>
              ─── The journey ───
            </p>
            <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {JOURNEY.map((j, i) => (
                <motion.li
                  key={j.step}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.15 + i * 0.06 }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2.5rem 5.5rem minmax(0, 1fr)',
                    alignItems: 'baseline', gap: '0.875rem',
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.625rem',
                    color: 'var(--text-muted)', letterSpacing: '0.1em',
                  }}>{j.step}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                    color: j.accent, fontWeight: 700,
                    letterSpacing: '0.12em', textTransform: 'uppercase',
                  }}>{j.label}</span>
                  <span style={{
                    fontSize: '0.8125rem', color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                  }}>{j.detail}</span>
                </motion.li>
              ))}
            </ol>
          </div>

          {/* Promises — trust panel. The "token stored only in session" claim
              from the spec is the headline. */}
          <div style={{
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-1)',
            padding: '1.25rem 1.25rem',
          }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.5rem',
              letterSpacing: '0.22em', textTransform: 'uppercase',
              color: 'var(--accent-primary)', marginBottom: '0.75rem',
            }}>
              ▸ What Mendel won&apos;t do
            </p>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {PROMISES.map((p) => (
                <li key={p} style={{
                  display: 'flex', alignItems: 'baseline', gap: '0.5rem',
                  fontSize: '0.75rem', color: 'var(--text-secondary)',
                }}>
                  <span style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>✓</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </motion.section>

        {/* ── RIGHT: auth form ────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{
            padding: '3.5rem 3rem',
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
            background: 'var(--bg-1)',
          }}
        >
          {/* Mascot — connect is pre-auth, sidebar is hidden, so mascot lives here */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.75rem' }}>
            <BonesMascot pose={pose} size={140} />
          </div>

          <h2 style={{
            fontFamily: 'var(--font-mono)', fontSize: '1.25rem', fontWeight: 700,
            color: 'var(--text-primary)', marginBottom: '0.5rem',
            letterSpacing: '-0.01em',
          }}>
            Connect your GitHub
          </h2>
          <p style={{
            fontSize: '0.8125rem', color: 'var(--text-secondary)',
            lineHeight: 1.6, marginBottom: '1.75rem',
          }}>
            Paste a Personal Access Token (classic). Required scopes are listed below.
            <strong style={{ color: 'var(--text-primary)' }}> Your token is stored only in your browser session</strong> — never on disk, never sent to any server but GitHub.
          </p>

          {/* Form */}
          <form onSubmit={handleConnect} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={{
                display: 'block',
                fontFamily: 'var(--font-mono)', fontSize: '0.625rem',
                letterSpacing: '0.15em', textTransform: 'uppercase',
                color: 'var(--text-muted)', marginBottom: '0.5rem',
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
                aria-label="GitHub Personal Access Token"
                style={{
                  width: '100%',
                  background: 'var(--bg-2)',
                  border: `1px solid ${status === 'error' ? 'var(--accent-danger)' : 'var(--border-strong)'}`,
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)', fontSize: '0.8125rem',
                  padding: '0.75rem 1rem',
                  outline: 'none', letterSpacing: '0.05em',
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
                fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
                letterSpacing: '0.15em', textTransform: 'uppercase',
                color: 'var(--text-muted)', marginBottom: '0.625rem',
              }}>
                Required Scopes
              </p>
              {REQUIRED_SCOPES.map(({ scope, desc }) => (
                <div key={scope} style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.375rem' }}>
                  <code style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
                    color: 'var(--accent-secondary)', minWidth: '80px',
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
        </motion.section>
      </div>
    </div>
  )
}
