'use client'

/**
 * S3 — New Scan (DESIGN.md §11 S3). Rest mode.
 *
 * Audit rebuild 2026-05-27: was a one-input form centered in ~60% empty
 * canvas. Now a two-column layout — left: input + constraints panel + "What
 * Mendel Will Do" preview; right: recent-scans rail for quick re-scan.
 * Mobile stacks single column. Constraints panel is real bordered amber per
 * DESIGN.md §11 S3 must-have (kept from prior audit).
 */

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { PanelFrame } from '@/components/phase-d/PanelFrame'
import { useToast } from '@/components/shared/toast'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { TIER_1_HOSTS, Tier2HostSchema } from '@/lib/sandbox/iptables-allowlist'

/* v1.5 W#8 Push 2 — tier-2 allowlist default, written by Settings. Read here
   as the per-scan starting point; per-scan edits do NOT mutate the saved
   default (we never write this key back from /scan/new). */
const TIER2_PREF_KEY = 'mendel:pref:tier2AllowlistHosts'
const TIER2_MAX_HOSTS = 32

function readTier2Default(): string[] {
  if (typeof window === 'undefined') return []
  const raw = localStorage.getItem(TIER2_PREF_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: string[] = []
    for (const v of parsed) {
      if (typeof v !== 'string') continue
      const check = Tier2HostSchema.safeParse(v.trim().toLowerCase())
      if (check.success && !out.includes(check.data)) out.push(check.data)
    }
    return out.slice(0, TIER2_MAX_HOSTS)
  } catch {
    return []
  }
}

interface RecentScan {
  id: string
  repoUrl: string
  status: string
  startedAt: string
  issuesFound?: number
  prsOpened?: number
}

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

function repoName(url: string): string {
  return url.replace(/https?:\/\/github\.com\//, '').replace(/\.git$/, '')
}

function relTime(iso?: string): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

const CONSTRAINTS = [
  'Public repositories only',
  'Single-package repos (no monorepos)',
  'TypeScript projects preferred',
  'Max 3 deps patched per scan',
]

const JOURNEY: { phase: string; what: string; sub: string; accent: string }[] = [
  { phase: 'SCAN',     what: 'Manifest + registry',   sub: 'reads package.json, queries npm for latest', accent: 'var(--accent-secondary)' },
  { phase: 'DIAGNOSE', what: 'Changelog + AST',       sub: 'parses CHANGELOG.md, cross-refs usage',      accent: 'var(--accent-secondary)' },
  { phase: 'PATCH',    what: 'Rewrite + format',      sub: 'generates migration patches, runs Prettier', accent: 'var(--accent-primary)' },
  { phase: 'VERIFY',   what: 'Docker sandbox',        sub: 'two-phase install + test in isolation',      accent: 'var(--accent-warning)' },
  { phase: 'DELIVER',  what: 'Draft PR',              sub: 'opens on GitHub with confidence framing',    accent: 'var(--accent-primary)' },
]

export default function NewScanPage() {
  useDocumentTitle('New Scan')
  const router = useRouter()
  const toast = useToast()
  const [repoUrl, setRepoUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'starting' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [recent, setRecent] = useState<RecentScan[]>([])
  const [recentLoading, setRecentLoading] = useState(true)
  /* v1.5 W#8 Push 2 — per-scan tier-2 allowlist. Seeded from the saved
     Settings default; edits here are scoped to this scan only. */
  const [tier2Hosts, setTier2Hosts] = useState<string[]>([])
  const [allowlistOpen, setAllowlistOpen] = useState(false)
  const [hostDraft, setHostDraft] = useState('')
  const [hostError, setHostError] = useState<string | null>(null)

  // Auth gate (Fix #3 audit-2 — preserved).
  useEffect(() => {
    if (!sessionStorage.getItem('mendel_pat')) {
      toast.info('Connect a GitHub PAT first.')
      router.replace('/connect?return=/scan/new')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Seed per-scan allowlist from the saved Settings default. Auto-expand the
  // advanced section if the user already has a default so it's discoverable.
  useEffect(() => {
    const seed = readTier2Default()
    setTier2Hosts(seed)
    if (seed.length > 0) setAllowlistOpen(true)
  }, [])

  // Pull recent scans for the quick-rescan rail.
  useEffect(() => {
    fetch('/api/scans')
      .then((r) => r.json())
      .then((data: unknown) => {
        if (!Array.isArray(data)) return
        // Dedupe by repoUrl — show unique repos, most-recent first.
        const seen = new Set<string>()
        const dedup: RecentScan[] = []
        for (const s of data as RecentScan[]) {
          if (seen.has(s.repoUrl)) continue
          seen.add(s.repoUrl)
          dedup.push(s)
          if (dedup.length >= 5) break
        }
        setRecent(dedup)
      })
      .catch(() => {})
      .finally(() => setRecentLoading(false))
  }, [])

  const parsed = parseGitHubUrl(repoUrl)
  const isValid = !!parsed

  /* Per-scan allowlist add/remove. Validation mirrors the server's
     Tier2HostSchema so we never POST a host the server would reject. */
  function addHost() {
    const candidate = hostDraft.trim().toLowerCase()
    if (!candidate) { setHostError('Enter a hostname.'); return }
    const v = Tier2HostSchema.safeParse(candidate)
    if (!v.success) { setHostError(v.error.issues[0]?.message ?? 'Invalid hostname.'); return }
    if ((TIER_1_HOSTS as readonly string[]).includes(v.data)) { setHostError('Already in tier-1 default.'); return }
    if (tier2Hosts.includes(v.data)) { setHostError('Already added.'); return }
    if (tier2Hosts.length >= TIER2_MAX_HOSTS) { setHostError(`Limit is ${TIER2_MAX_HOSTS} hosts.`); return }
    setTier2Hosts([...tier2Hosts, v.data])
    setHostDraft('')
    setHostError(null)
  }
  function removeHost(host: string) {
    setTier2Hosts(tier2Hosts.filter((h) => h !== host))
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    if (!parsed) return
    setStatus('starting')
    setErrorMsg('')
    const pat = sessionStorage.getItem('mendel_pat') ?? ''
    // v1.5 Workstream #4: pick up the user's confidence threshold from
    // localStorage (set on Settings). Server validates + clamps; we only
    // attach if the value actually exists to keep the env-default path live.
    const thresholdRaw = typeof window !== 'undefined'
      ? localStorage.getItem('mendel:pref:confidenceThreshold')
      : null
    const confidenceThreshold = thresholdRaw != null && Number.isFinite(Number(thresholdRaw))
      ? Number(thresholdRaw)
      : undefined
    try {
      const res = await fetch('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
          pat,
          ...(confidenceThreshold != null ? { confidenceThreshold } : {}),
          // v1.5 W#8 Push 2 — only attach when non-empty so the server's
          // tier-1-only default path stays live for users who never touch it.
          ...(tier2Hosts.length > 0 ? { tier2AllowlistHosts: tier2Hosts } : {}),
        }),
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
    <div style={{ minHeight: '100vh', padding: '2.25rem 2rem' }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
          Mendel // New Scan
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          paste url → scan
        </span>
      </motion.div>

      <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>
        Scan a Repository
      </h1>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', maxWidth: '60ch', marginBottom: '1.75rem' }}>
        Mendel will read your repo, find stale deps with breaking-change upgrades, generate patches, verify in a sandbox, and open a Draft PR.
      </p>

      {/* Two-column grid: form+constraints+journey · recent rail */}
      <div className="new-scan-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '1.5rem' }}>
        {/* LEFT: form + constraints + journey preview */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <form onSubmit={handleScan}>
            <PanelFrame title="GitHub Repository URL" accent={isValid ? 'var(--accent-primary)' : 'var(--text-muted)'}>
              <div style={{ display: 'flex' }}>
                {/* §11 S3 spec: "On submit: input collapses, button morphs into
                    a loading state ('INITIALIZING…') for 600ms". Input collapse
                    was previously skipped — now animates flex to 0 over 280ms. */}
                <motion.input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => { setRepoUrl(e.target.value); setStatus('idle'); setErrorMsg('') }}
                  placeholder="https://github.com/owner/repo"
                  autoFocus
                  spellCheck={false}
                  initial={false}
                  animate={status === 'starting' ? { flexBasis: 0, paddingLeft: 0, paddingRight: 0, opacity: 0 } : { flexBasis: 'auto', paddingLeft: '1rem', paddingRight: '1rem', opacity: 1 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    flex: 1, background: 'var(--bg-3, #222)', color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', paddingTop: '0.875rem', paddingBottom: '0.875rem',
                    outline: 'none', minWidth: 0,
                    borderTop: `1px solid ${borderColor}`, borderBottom: `1px solid ${borderColor}`,
                    borderLeft: `1px solid ${borderColor}`, borderRight: 'none', transition: 'border-color 0.2s',
                  }}
                />
                <button type="submit" disabled={!isValid || status === 'starting'} className="btn-primary" style={{ borderRadius: 0, padding: '0.875rem 1.5rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
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
          </form>

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

          {/* v1.5 W#8 Push 2 — advanced: per-scan network allowlist override.
              Collapsed by default; seeded from the Settings default. */}
          <div style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-1)' }}>
            <button
              type="button"
              onClick={() => setAllowlistOpen((v) => !v)}
              aria-expanded={allowlistOpen}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '0.875rem 1.1rem', fontFamily: 'var(--font-mono)',
                fontSize: '0.5625rem', fontWeight: 700, letterSpacing: '0.18em',
                textTransform: 'uppercase', color: 'var(--accent-secondary)',
              }}
            >
              <span>Advanced · Network Allowlist{tier2Hosts.length > 0 ? ` (${tier2Hosts.length})` : ''}</span>
              <span aria-hidden style={{ color: 'var(--text-muted)' }}>{allowlistOpen ? '−' : '+'}</span>
            </button>
            {allowlistOpen && (
              <div style={{ padding: '0 1.1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  Phase A runs behind a default-deny egress filter. Tier-1 hosts
                  (npm, GitHub, common CDNs) are always allowed. Add extra hosts
                  only for this scan — your saved default isn&apos;t changed.
                </p>
                {tier2Hosts.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                    {tier2Hosts.map((h) => (
                      <span key={h} style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                        fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
                        color: 'var(--accent-secondary)', padding: '0.2rem 0.4rem 0.2rem 0.5rem',
                        border: '1px solid var(--accent-secondary)', background: 'rgba(61,255,238,0.05)',
                      }}>
                        {h}
                        <button type="button" onClick={() => removeHost(h)} aria-label={`Remove ${h}`} style={{ background: 'transparent', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', lineHeight: 1, padding: 0 }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    value={hostDraft}
                    onChange={(e) => { setHostDraft(e.target.value); setHostError(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHost() } }}
                    placeholder="cdn.example.com"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Add a host to this scan's allowlist"
                    style={{ flex: 1, minWidth: 0, background: 'var(--bg-3, #222)', border: `1px solid ${hostError ? 'var(--accent-danger)' : 'var(--border-strong)'}`, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', padding: '0.5rem 0.625rem', outline: 'none' }}
                  />
                  <button type="button" onClick={addHost} disabled={!hostDraft.trim()} style={{ padding: '0.5rem 0.875rem', border: '1px solid var(--accent-secondary)', color: 'var(--accent-secondary)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: hostDraft.trim() ? 'pointer' : 'not-allowed', opacity: hostDraft.trim() ? 1 : 0.4, flexShrink: 0 }}>Add</button>
                </div>
                {hostError && (
                  <p role="alert" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--accent-danger)' }}>✕ {hostError}</p>
                )}
              </div>
            )}
          </div>

          {/* What Mendel will do — fills the prior empty bottom with real product context */}
          <PanelFrame title="What Mendel Will Do" accent="var(--accent-secondary)">
            <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.625rem', marginTop: '0.25rem' }}>
              {JOURNEY.map((j, i) => (
                <li key={j.phase} style={{
                  display: 'grid',
                  gridTemplateColumns: '2rem 5.5rem minmax(0, 1fr)',
                  gap: '0.875rem', alignItems: 'baseline',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
                    fontWeight: 700, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: j.accent,
                  }}>
                    {j.phase}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                    <span style={{ color: 'var(--text-primary)' }}>{j.what}</span>
                    <span style={{ color: 'var(--text-muted)' }}> · {j.sub}</span>
                  </span>
                </li>
              ))}
            </ol>
          </PanelFrame>
        </section>

        {/* RIGHT: recent-scans rail for quick re-scan */}
        <aside aria-label="Recent scans">
          <div style={{
            border: '1px solid var(--border-subtle)', background: 'var(--bg-1)',
            padding: '1rem 1.1rem',
            display: 'flex', flexDirection: 'column', gap: '0.625rem',
            height: 'fit-content', position: 'sticky', top: '1.5rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                Recent Repos
              </p>
              {recent.length > 0 && (
                <Link href="/dashboard" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--accent-secondary)', textDecoration: 'none' }}>
                  all →
                </Link>
              )}
            </div>
            {recentLoading ? (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)', padding: '1rem 0' }}>loading…</p>
            ) : recent.length === 0 ? (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)', padding: '1rem 0', lineHeight: 1.5 }}>
                No previous scans. Paste any GitHub URL above to start the first one.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {recent.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setRepoUrl(s.repoUrl)
                      setStatus('idle')
                      setErrorMsg('')
                    }}
                    title="Click to load this URL into the input"
                    style={{
                      textAlign: 'left',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-2)',
                      padding: '0.5rem 0.625rem',
                      cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', gap: '0.2rem',
                      fontFamily: 'inherit',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {repoName(s.repoUrl)}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', color: 'var(--text-muted)' }}>
                      {relTime(s.startedAt)} · {s.issuesFound ?? 0} issues · {s.prsOpened ?? 0} prs
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
