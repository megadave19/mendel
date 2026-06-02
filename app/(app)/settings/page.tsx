'use client'

/**
 * S9 — Settings (DESIGN.md §11 S9). Rest mode.
 *
 * Audit rebuild 2026-05-27: was 720px-max-width column with PAT + About panels,
 * leaving ~50% of the screen empty + a tiny "ACTIVE/NONE" label instead of a
 * proper status pill (spec called for ACTIVE/REVOKED pill).
 *
 * Now: two-column dense layout. Left = PAT + About (existing, polished).
 * Right = Diagnostics (LLM provider, env, sandbox config, token info) +
 * Preferences (real working toggles for reduce-motion + mascot; sound chip
 * visibly disabled per new §7.2a step 4 since it's a v1.5 feature).
 */

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { PanelFrame } from '@/components/phase-d/PanelFrame'
import { AutoMergePanel } from '@/components/automerge/AutoMergePanel'
import { MonitorPanel } from '@/components/monitor/MonitorPanel'
import { useToast } from '@/components/shared/toast'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { TIER_1_HOSTS, Tier2HostSchema } from '@/lib/sandbox/iptables-allowlist'
import { notifyPrefChange } from '@/hooks/use-user-prefs'

const ABOUT: [string, string][] = [
  ['All PRs', 'Open as Drafts — you manually mark ready'],
  ['Confidence', 'Medium — changelog parsing only, no semantic diff'],
  ['Sandbox', 'Two-phase Docker: install (bridge) → verify (none)'],
  ['Token storage', 'Session only — never persisted to disk or server'],
  ['Max deps', '3 per scan in v1.0'],
]

interface ValidationInfo { login?: string; scopes?: string[] }

/* Preferences — written to localStorage so they survive reloads.
   Read globally elsewhere via getPref() if/when wired into components.
   Keys are deliberately namespaced to avoid collisions. */
/* 2026-05-31 — `mascot` key aligned to `mendel:pref:mascot` to match the
   reader hook in hooks/use-user-prefs.ts + public/prefs-init.js. The old
   `mendel:pref:mascotEnabled` was never read by any consumer (the §7.2a
   dead-control bug); changing it now affects no live behavior. */
const PREF_KEY = {
  reduceMotion:        'mendel:pref:reduceMotion',
  mascot:              'mendel:pref:mascot',
  /* v1.5 Workstream #4 — calibrated confidence threshold (40–100). Read by
     /scan/new before POST so the runner gets a per-scan override. */
  confidenceThreshold: 'mendel:pref:confidenceThreshold',
  /* v1.5 Workstream #8 Push 2 — tier-2 sandbox allowlist hosts (JSON array of
     strings). Read by /scan/new as the default before POST so users don't
     have to re-enter common hosts. Per-scan override is non-destructive (the
     saved default stays). Validation uses the same Tier2HostSchema as the
     server, so client + server can't drift. */
  tier2AllowlistHosts: 'mendel:pref:tier2AllowlistHosts',
} as const

const THRESHOLD_MIN = 40
const THRESHOLD_MAX = 100
const THRESHOLD_DEFAULT = 70

/** Hard cap mirrored from Tier2AllowlistSchema (server). */
const TIER2_MAX_HOSTS = 32

function getBoolPref(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const v = localStorage.getItem(key)
  if (v === null) return fallback
  return v === '1'
}

function getNumberPref(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === 'undefined') return fallback
  const v = localStorage.getItem(key)
  if (v === null) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

/**
 * v1.5 W#8 Push 2 — read a JSON string-array preference. Tolerates legacy
 * non-JSON values (treats as empty) so a corrupt entry can never crash the
 * Settings page. Each entry is re-validated through Tier2HostSchema; invalid
 * entries are dropped silently here (UI surfaces them only on add — the saved
 * list is treated as previously-validated).
 */
function getStringArrayPref(key: string): string[] {
  if (typeof window === 'undefined') return []
  const raw = localStorage.getItem(key)
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

export default function SettingsPage() {
  useDocumentTitle('Settings')
  const toast = useToast()
  const [pat, setPat] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [info, setInfo] = useState<ValidationInfo | null>(null)
  const [tokenAge, setTokenAge] = useState<string | null>(null)
  /* §11 S9 spec: "Save button success state (200ms lime fill from left to right,
     then settle)". Toggles for ~600ms post-save then resets. */
  const [justSaved, setJustSaved] = useState(false)
  /* Preferences state, hydrated from localStorage. */
  const [reduceMotion, setReduceMotion] = useState(false)
  const [mascotEnabled, setMascotEnabled] = useState(true)
  /* v1.5 Workstream #4 — calibrated confidence threshold (per-scan override). */
  const [confidenceThreshold, setConfidenceThreshold] = useState(THRESHOLD_DEFAULT)
  /* v1.5 Workstream #8 Push 2 — global tier-2 allowlist default. */
  const [tier2Hosts, setTier2Hosts] = useState<string[]>([])

  useEffect(() => {
    const stored = sessionStorage.getItem('mendel_pat')
    if (stored) {
      setHasToken(true)
      setPat(stored.slice(0, 4) + '•'.repeat(Math.max(0, stored.length - 8)) + stored.slice(-4))
    }
    /* Track when the token was saved this session for the diagnostics panel. */
    const savedAt = sessionStorage.getItem('mendel_pat_saved_at')
    if (savedAt) {
      const ms = Date.now() - parseInt(savedAt, 10)
      if (Number.isFinite(ms) && ms > 0) {
        const min = Math.floor(ms / 60000)
        setTokenAge(min < 60 ? `${min}m ago` : `${Math.floor(min / 60)}h ago`)
      }
    }
    setReduceMotion(getBoolPref(PREF_KEY.reduceMotion, false))
    setMascotEnabled(getBoolPref(PREF_KEY.mascot, true))
    setConfidenceThreshold(getNumberPref(PREF_KEY.confidenceThreshold, THRESHOLD_DEFAULT, THRESHOLD_MIN, THRESHOLD_MAX))
    setTier2Hosts(getStringArrayPref(PREF_KEY.tier2AllowlistHosts))
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
      sessionStorage.setItem('mendel_pat_saved_at', String(Date.now()))
      setHasToken(true)
      setInfo({ login: data.login, scopes: data.scopes })
      setTokenAge('just now')
      /* Fire success-fill animation per §11 S9: 200ms sweep then settle. */
      setJustSaved(true)
      window.setTimeout(() => setJustSaved(false), 600)
      toast.success(data.login ? `Token saved · authenticated as ${data.login}` : 'Token saved.')
    } catch (err) {
      toast.error(`Validation failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  /* Manual re-validate of the existing token without re-typing. */
  const handleValidate = useCallback(async () => {
    const stored = sessionStorage.getItem('mendel_pat')
    if (!stored) return
    setSaving(true)
    try {
      const res = await fetch('/api/validate-pat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pat: stored }),
      })
      const data = (await res.json()) as { valid: boolean; error?: string; login?: string; scopes?: string[] }
      if (data.valid) {
        setInfo({ login: data.login, scopes: data.scopes })
        toast.success(data.login ? `Still valid · ${data.login}` : 'Token still valid.')
      } else {
        toast.error(data.error ?? 'Token no longer valid.')
      }
    } catch (err) {
      toast.error(`Re-validate failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }, [toast])

  function handleRevoke() {
    sessionStorage.removeItem('mendel_pat')
    sessionStorage.removeItem('mendel_pat_saved_at')
    setPat('')
    setHasToken(false)
    setInfo(null)
    setTokenAge(null)
    toast.info('Token revoked from this session.')
  }

  /* Preference toggle handlers — write to localStorage and notify.
     v2.0 fix (§7.2a dead-control): notifyPrefChange() dispatches a same-tab
     custom event so useReduceMotion / useMascotEnabled consumers re-render.
     Previously these toggles updated state + dataset but no component read
     the values, so the controls did nothing user-visible. */
  const toggleReduceMotion = () => {
    const next = !reduceMotion
    setReduceMotion(next)
    localStorage.setItem(PREF_KEY.reduceMotion, next ? '1' : '0')
    document.documentElement.dataset.reduceMotion = next ? '1' : '0'
    notifyPrefChange()
    toast.info(next ? 'Reduced motion enabled.' : 'Reduced motion disabled.')
  }
  const toggleMascot = () => {
    const next = !mascotEnabled
    setMascotEnabled(next)
    localStorage.setItem(PREF_KEY.mascot, next ? '1' : '0')
    document.documentElement.dataset.mascot = next ? '1' : '0'
    notifyPrefChange()
    toast.info(next ? 'Mascot enabled.' : 'Mascot hidden.')
  }

  /* v1.5 Workstream #4 — confidence threshold setter. Writes localStorage
     immediately so the New Scan page reads the latest value. */
  const handleThresholdChange = (next: number) => {
    const clamped = Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, Math.round(next)))
    setConfidenceThreshold(clamped)
    localStorage.setItem(PREF_KEY.confidenceThreshold, String(clamped))
  }

  /* v1.5 W#8 Push 2 — tier-2 allowlist persistence. Validation reuses the
     server's Tier2HostSchema so the client can't save a host the server
     would later reject. Returns an error string on failure (the panel shows
     it inline); null on success. Never silently drops — §5b. */
  const persistTier2 = (next: string[]) => {
    setTier2Hosts(next)
    localStorage.setItem(PREF_KEY.tier2AllowlistHosts, JSON.stringify(next))
  }
  const handleAddTier2 = (raw: string): string | null => {
    const candidate = raw.trim().toLowerCase()
    if (!candidate) return 'Enter a hostname.'
    const parsed = Tier2HostSchema.safeParse(candidate)
    if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Invalid hostname.'
    if ((TIER_1_HOSTS as readonly string[]).includes(parsed.data)) {
      return 'Already covered by the tier-1 default allowlist.'
    }
    if (tier2Hosts.includes(parsed.data)) return 'Already in your allowlist.'
    if (tier2Hosts.length >= TIER2_MAX_HOSTS) return `Limit is ${TIER2_MAX_HOSTS} hosts.`
    persistTier2([...tier2Hosts, parsed.data])
    toast.success(`Added ${parsed.data} to the default allowlist.`)
    return null
  }
  const handleRemoveTier2 = (host: string) => {
    persistTier2(tier2Hosts.filter((h) => h !== host))
    toast.info(`Removed ${host}.`)
  }

  return (
    <div id="main" style={{ minHeight: '100vh', padding: '2.25rem 2rem' }}>
      {/* Strip header — same pattern as Dashboard / New Scan. */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
          Mendel // Settings
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          session-scoped · no cloud sync
        </span>
      </motion.div>

      <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.75rem' }}>
        Settings
      </h1>

      {/* Two-column dense layout. */}
      <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 0.8fr)', gap: '1.25rem' }}>
        {/* === LEFT: PAT + About === */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <PanelFrame
            title="GitHub Personal Access Token"
            accent={hasToken ? 'var(--accent-primary)' : 'var(--text-muted)'}
            /* Fix B-S1: proper filled status pill instead of tiny corner label. */
            meta={<StatusPill active={hasToken} />}
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
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  disabled={!pat.trim() || pat.includes('•') || saving}
                  className="btn-primary"
                  style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}
                >
                  {/* §11 S9 success-fill sweep: 200ms left→right lime fill, then settles. */}
                  {justSaved && (
                    <motion.span
                      aria-hidden
                      initial={{ x: '-100%' }}
                      animate={{ x: '0%' }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      style={{
                        position: 'absolute', inset: 0,
                        background: 'var(--accent-primary)',
                        zIndex: 0,
                      }}
                    />
                  )}
                  <span style={{ position: 'relative', zIndex: 1, color: justSaved ? 'var(--bg-0)' : undefined }}>
                    {saving ? 'Validating…' : justSaved ? 'Saved ✓' : 'Save Token'}
                  </span>
                </button>
                {hasToken && (
                  <>
                    {/* Fix U-S3: manual re-validate of existing token. */}
                    <button
                      type="button" onClick={handleValidate} disabled={saving}
                      aria-label="Re-validate saved token against GitHub"
                      style={{ padding: '0.5rem 1rem', border: '1px solid var(--accent-secondary)', color: 'var(--accent-secondary)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}
                    >
                      Re-validate
                    </button>
                    <button type="button" onClick={handleRevoke} aria-label="Revoke saved token" style={{ padding: '0.5rem 1rem', border: '1px solid var(--accent-danger)', color: 'var(--accent-danger)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: '0.625rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
                      Revoke
                    </button>
                  </>
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
        </section>

        {/* === RIGHT: Diagnostics + Preferences === */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <PanelFrame title="Diagnostics" accent="var(--accent-secondary)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <DiagRow k="Runtime" v="Local dev · Node 20" />
              <DiagRow k="LLM provider" v="Configurable via LLM_PROVIDER env" />
              <DiagRow k="Sandbox" v="Two-phase Docker" />
              <DiagRow k="Token state" v={hasToken ? `Active · saved ${tokenAge ?? 'this session'}` : 'Not connected'} accent={hasToken ? 'var(--accent-primary)' : 'var(--text-muted)'} />
              <DiagRow k="Validated as" v={info?.login ? info.login : '—'} accent={info?.login ? 'var(--accent-primary)' : 'var(--text-muted)'} />
              <DiagRow k="Scopes" v={info?.scopes?.join(', ') || '—'} accent={info?.scopes?.length ? 'var(--accent-secondary)' : 'var(--text-muted)'} />
            </div>
          </PanelFrame>

          <PanelFrame title="Preferences">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* §7.2a step 4: wire it for real, OR render visibly disabled with
                  title="coming soon". Reduce-motion + mascot are wired to
                  localStorage; sound is v1.5 → visibly disabled. */}
              <ToggleRow
                label="Reduce motion"
                desc="Disable animations + particle drift across the app"
                on={reduceMotion}
                onToggle={toggleReduceMotion}
              />
              <ToggleRow
                label="Show mascot"
                desc="Toggle the sidebar Bones mascot"
                on={mascotEnabled}
                onToggle={toggleMascot}
              />
              <ToggleRow
                label="Sound effects"
                desc="UI clicks + scan-done chime"
                on={false}
                onToggle={() => {}}
                disabledReason="v1.5 feature — coming soon"
              />
            </div>
          </PanelFrame>

          {/* v1.5 Workstream #4 — Confidence threshold slider. Writes
              localStorage; New Scan reads it and attaches to the POST body. */}
          <PanelFrame title="Confidence Threshold" accent="var(--accent-primary)">
            <ThresholdSlider
              value={confidenceThreshold}
              min={THRESHOLD_MIN}
              max={THRESHOLD_MAX}
              onChange={handleThresholdChange}
            />
          </PanelFrame>

          {/* v1.5 Workstream #8 Push 2 — sandbox network allowlist. Tier-1 is
              read-only (always on); tier-2 is the user's saved default,
              pre-filled into each new scan and overridable per-scan. */}
          <PanelFrame title="Sandbox Network Allowlist" accent="var(--accent-secondary)">
            <NetworkAllowlistPanel
              tier2Hosts={tier2Hosts}
              onAdd={handleAddTier2}
              onRemove={handleRemoveTier2}
            />
          </PanelFrame>

          {/* v2.3 / F24 sub-phase 3 — Auto-merge opt-in (the §5c
              "Honesty-of-Action floor" UI). Per-repo config + recent
              decisions feed. Default OFF at the schema level; this
              panel is the ONLY way a user can opt in. */}
          <AutoMergePanel />

          {/* v2.3 / F25 sub-phase 2 — Continuous-monitor opt-in. Per-repo
              cron schedule + enable toggle + lastFired/lastError surface
              + recent monitor.fire log feed. Default OFF at the schema
              level. The worker (`pnpm monitor`) reads these rows. */}
          <MonitorPanel />
        </section>
      </div>
    </div>
  )
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

/**
 * v1.5 Workstream #4 — Confidence threshold slider.
 *
 * Functional, not decorative. Writes `mendel:pref:confidenceThreshold` to
 * localStorage immediately; `/scan/new` reads the value and attaches it to
 * the POST body. API → runner uses it to gate PR submission per TRD §9.5.
 *
 * Renders a live preview of what each band means so the user understands
 * the consequence before changing the slider.
 */
function ThresholdSlider({
  value, min, max, onChange,
}: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  // Bucket of the current threshold for color hint.
  const bucketColor =
    value >= 80 ? 'var(--accent-primary)' :
    value >= 60 ? 'var(--accent-warning)' :
                  'var(--accent-danger)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '1.75rem', fontWeight: 700,
          color: bucketColor, fontVariantNumeric: 'tabular-nums',
          textShadow: `0 0 16px ${bucketColor}`, lineHeight: 1,
        }}>
          {value}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.625rem',
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>
          / 100 minimum for standard PR
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Confidence threshold for standard PR submission"
        style={{
          width: '100%', accentColor: 'var(--accent-primary)',
          cursor: 'pointer',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <ThresholdBand color="var(--accent-primary)" label="≥ threshold" detail="open as standard PR (non-Draft)" />
        <ThresholdBand color="var(--accent-warning)" label="40 to threshold − 1" detail="open as Draft PR with low-confidence warning" />
        <ThresholdBand color="var(--accent-danger)"  label="below 40" detail="no PR opened — diagnosis persisted for review" />
      </div>
      <p style={{ fontSize: '0.625rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Applies to your next scan. Calibrated per TRD §9.5. Override server-side via{' '}
        <code style={{ color: 'var(--accent-secondary)' }}>MENDEL_CONFIDENCE_THRESHOLD</code> env var.
      </p>
    </div>
  )
}

function ThresholdBand({ color, label, detail }: { color: string; label: string; detail: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.625rem' }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.625rem',
        letterSpacing: '0.08em', color, minWidth: '8rem',
      }}>
        {label}
      </span>
      <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {detail}
      </span>
    </div>
  )
}

/**
 * v1.5 W#8 Push 2 — sandbox network allowlist editor.
 *
 * Functional, not decorative (§7.2a): tier-2 add/remove writes localStorage,
 * which `/scan/new` reads as the per-scan default. Tier-1 chips are read-only
 * (informational) so the user understands what's already permitted before
 * adding more. Validation mirrors the server's Tier2HostSchema, so an entry
 * accepted here can't be rejected at scan time.
 */
function NetworkAllowlistPanel({
  tier2Hosts, onAdd, onRemove,
}: {
  tier2Hosts: string[]
  onAdd: (raw: string) => string | null
  onRemove: (host: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const err = onAdd(draft)
    if (err) { setError(err); return }
    setDraft('')
    setError(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
        Phase A installs run behind a default-deny iptables egress filter. Tier-1
        hosts are always allowed. Add tier-2 hosts here to set your default for
        every scan — you can still override per-scan on the New Scan page.
      </p>

      {/* Tier-1: read-only chips. */}
      <div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
          Tier-1 · always on
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
          {TIER_1_HOSTS.map((h) => (
            <span key={h} title="Tier-1 default — always allowed, cannot be removed" style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
              color: 'var(--text-secondary)', padding: '0.2rem 0.45rem',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-2)',
            }}>
              {h}
            </span>
          ))}
        </div>
      </div>

      {/* Tier-2: editable. */}
      <div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--accent-secondary)', marginBottom: '0.5rem' }}>
          Tier-2 · your default ({tier2Hosts.length}/{TIER2_MAX_HOSTS})
        </p>
        {tier2Hosts.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            None added. Tier-1 covers ~99% of installs.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.5rem' }}>
            {tier2Hosts.map((h) => (
              <span key={h} style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
                color: 'var(--accent-secondary)', padding: '0.2rem 0.4rem 0.2rem 0.5rem',
                border: '1px solid var(--accent-secondary)', background: 'rgba(61,255,238,0.05)',
              }}>
                {h}
                <button
                  type="button"
                  onClick={() => onRemove(h)}
                  aria-label={`Remove ${h} from allowlist`}
                  style={{ background: 'transparent', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', lineHeight: 1, padding: 0 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
            placeholder="cdn.example.com"
            spellCheck={false}
            autoComplete="off"
            aria-label="Add a tier-2 allowlist host"
            style={{ flex: 1, minWidth: 0, background: 'var(--bg-3, #222)', border: `1px solid ${error ? 'var(--accent-danger)' : 'var(--border-strong)'}`, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', padding: '0.5rem 0.625rem', outline: 'none' }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            style={{ padding: '0.5rem 0.875rem', border: '1px solid var(--accent-secondary)', color: 'var(--accent-secondary)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.1em', textTransform: 'uppercase', cursor: draft.trim() ? 'pointer' : 'not-allowed', opacity: draft.trim() ? 1 : 0.4, flexShrink: 0 }}
          >
            Add
          </button>
        </div>
        {error && (
          <p role="alert" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.625rem', color: 'var(--accent-danger)', marginTop: '0.4rem' }}>
            ✕ {error}
          </p>
        )}
      </div>
    </div>
  )
}

function StatusPill({ active }: { active: boolean }) {
  const color = active ? 'var(--accent-primary)' : 'var(--text-muted)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
      padding: '0.2rem 0.55rem',
      border: `1px solid ${color}`,
      background: active ? color : 'transparent',
      color: active ? 'var(--bg-0)' : color,
      fontFamily: 'var(--font-mono)', fontSize: '0.5rem',
      fontWeight: 700, letterSpacing: '0.16em',
      textTransform: 'uppercase',
      boxShadow: active ? '0 0 12px rgba(198,255,61,0.35)' : 'none',
    }}>
      <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', background: active ? 'var(--bg-0)' : color }} />
      {active ? 'Active' : 'None'}
    </span>
  )
}

function DiagRow({ k, v, accent = 'var(--text-secondary)' }: { k: string; v: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'baseline' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)', minWidth: '90px', flexShrink: 0 }}>
        {k}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: accent, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {v}
      </span>
    </div>
  )
}

function ToggleRow({
  label, desc, on, onToggle, disabledReason,
}: { label: string; desc: string; on: boolean; onToggle: () => void; disabledReason?: string }) {
  const disabled = !!disabledReason
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: disabled ? 'var(--text-muted)' : 'var(--text-primary)', fontWeight: 600 }}>
          {label}
        </p>
        <p style={{ fontSize: '0.625rem', color: 'var(--text-muted)', marginTop: '0.15rem', lineHeight: 1.5 }}>
          {disabled ? disabledReason : desc}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={on}
        aria-disabled={disabled || undefined}
        onClick={() => { if (!disabled) onToggle() }}
        title={disabled ? disabledReason : undefined}
        style={{
          width: 38, height: 22,
          borderRadius: 12,
          border: `1px solid ${on ? 'var(--accent-primary)' : 'var(--border-strong)'}`,
          background: on ? 'var(--accent-primary)' : 'transparent',
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          position: 'relative',
          transition: 'all 180ms ease-out',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 2,
          left: on ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: on ? 'var(--bg-0)' : 'var(--text-muted)',
          transition: 'all 180ms ease-out',
        }} />
      </button>
    </div>
  )
}
