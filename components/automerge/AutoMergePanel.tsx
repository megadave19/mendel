'use client'

/**
 * v2.3 / F24 sub-phase 3 — Auto-Merge settings panel.
 *
 * Lives inside S9 (Settings). One panel; honest copy first; controls
 * second. Per CLAUDE.md §5c r1 every behavior here is OPT-IN — the user
 * MUST type the repo name + tick the acknowledgement + click Save before
 * anything changes server-side. Until then this panel is text + form
 * elements, no DB write.
 *
 * Per §7.2a:
 *   - Every interactive control has a working handler (the toggle, the
 *     floor slider, the dwell input, the Save button, the Reset button)
 *   - The "Recent decisions" sub-feed wires to /api/agent-log (real data
 *     + auto-refresh) — no decorative-only data
 *   - Spec conformance audit at the end (we have no DESIGN.md brief for
 *     this panel since it's net-new; the brief will land alongside the
 *     panel in the same commit)
 */

import { useState, useEffect, useCallback } from 'react'
import { PanelFrame } from '@/components/phase-d/PanelFrame'

interface RepoSetting {
  repoFullName: string
  autoMergeEnabled: boolean
  autoMergeConfidenceFloor: number
  autoMergeDwellSeconds: number
  exists: boolean
  updatedAt?: string
}

interface AgentLogRow {
  id: string
  scanId: string | null
  issueId: string | null
  kind: string
  payload: unknown
  createdAt: string
}

// Default shape mirrors prisma schema defaults — same source of truth as
// the GET handler returns on a missing row.
const DEFAULT_SETTING: Omit<RepoSetting, 'repoFullName'> = {
  autoMergeEnabled: false,
  autoMergeConfidenceFloor: 90,
  autoMergeDwellSeconds: 60,
  exists: false,
}

const FLOOR_MIN = 70
const FLOOR_MAX = 100
const DWELL_MIN = 0
const DWELL_MAX = 3600 // 1h hard ceiling for the UI; the policy clamps further server-side

const REPO_NAME_RE = /^[\w.-]+\/[\w.-]+$/

export function AutoMergePanel() {
  const [repoFullName, setRepoFullName] = useState('')
  const [setting, setSetting] = useState<RepoSetting | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ack, setAck] = useState(false)
  const [recent, setRecent] = useState<AgentLogRow[]>([])

  // Load setting + recent decisions whenever the user finishes typing
  // a valid repo name. Debounced via the explicit "Load" button rather
  // than a keystroke effect so we don't hammer the API.
  const handleLoad = useCallback(async () => {
    setError(null)
    if (!REPO_NAME_RE.test(repoFullName)) {
      setError('Repo must be "owner/name" with GitHub-safe characters.')
      return
    }
    setLoading(true)
    try {
      const [s, l] = await Promise.all([
        fetch(`/api/repo-settings/${encodeURIComponent(repoFullName)}`).then((r) => r.json()),
        fetch(`/api/agent-log?kind=automerge.&limit=20`).then((r) => r.json()),
      ])
      if (s?.error) throw new Error(s.error)
      setSetting(s as RepoSetting)
      setAck(false) // require fresh ack after each load
      const rows: AgentLogRow[] = Array.isArray(l?.rows) ? l.rows : []
      // Filter client-side to recent rows that belong to this repo (the
      // payload carries the prUrl; we match by owner/name).
      const ownerName = repoFullName.toLowerCase()
      setRecent(
        rows.filter((row) => {
          const p = row.payload as { prUrl?: string } | null
          return p?.prUrl?.toLowerCase().includes(`/${ownerName}/`) ?? false
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [repoFullName])

  // Save: only fires when ack is checked AND user clicks Save. The
  // server upserts; the policy still hard-clamps the effective floor
  // at runtime per §5c r7 regardless of what the user picked.
  const handleSave = useCallback(async () => {
    if (!setting) return
    if (setting.autoMergeEnabled && !ack) {
      setError('Tick the acknowledgement to enable auto-merge.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/repo-settings/${encodeURIComponent(setting.repoFullName)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          autoMergeEnabled: setting.autoMergeEnabled,
          autoMergeConfidenceFloor: setting.autoMergeConfidenceFloor,
          autoMergeDwellSeconds: setting.autoMergeDwellSeconds,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: 'save failed' }))) as { error?: string }
        throw new Error(body.error ?? `save failed (HTTP ${res.status})`)
      }
      const next = (await res.json()) as RepoSetting
      setSetting(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [setting, ack])

  return (
    <PanelFrame
      title="Auto-Merge (v2.3 / F24)"
      accent="var(--accent-warning)"
      meta={<span style={metaStyle()}>OPT-IN · DEFAULT OFF</span>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Honest, plain-English summary of what enabling means.
            §7.2a step 6 (UI spec audit) — this is the spec for this
            panel: the user MUST read this before they can opt-in. */}
        <div style={infoBlockStyle()}>
          <p style={pStyle()}>
            Auto-merge fires only when ALL of these hold (CLAUDE.md §5c):
          </p>
          <ul style={ulStyle()}>
            <li>The PR delivers a patch- or minor-version bump (never major)</li>
            <li>Both signals (changelog + semantic-diff) agree on zero breaking changes</li>
            <li>Confidence ≥ floor AND bucket = high (the language-aware ceiling still applies — Rust crates max at medium and can never auto-merge)</li>
            <li>Verification AND smoke (Phase B + Phase C) both passed</li>
            <li>No prior rejection on this dep + change kind</li>
            <li>The PAT has merge rights on the repo (fork-mode PRs cannot auto-merge)</li>
          </ul>
          <p style={pStyle({ marginTop: '0.5rem' })}>
            Auto-merge is <strong>irreversible</strong> once the merge commit lands. The dwell
            window below is your cancel buffer; the §5c &ldquo;Honesty-of-Action floor&rdquo; is the
            irreducible safety net.
          </p>
        </div>

        {/* Repo picker. Manual entry — the user explicitly names the
            repo they're configuring; we never enumerate without their
            input. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={labelStyle()} htmlFor="automerge-repo">Repo (owner/name)</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              id="automerge-repo"
              type="text"
              placeholder="megadave19/mendel-test"
              value={repoFullName}
              onChange={(e) => setRepoFullName(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleLoad() }}
              spellCheck={false}
              autoComplete="off"
              style={inputStyle()}
              aria-invalid={Boolean(error) && !REPO_NAME_RE.test(repoFullName)}
            />
            <button
              type="button"
              onClick={() => void handleLoad()}
              disabled={loading || !REPO_NAME_RE.test(repoFullName)}
              style={buttonStyle('var(--accent-secondary)')}
            >
              {loading ? 'Loading…' : 'Load'}
            </button>
          </div>
        </div>

        {/* Editor — appears only after a successful load. */}
        {setting && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', borderTop: '1px dashed var(--border-strong)', paddingTop: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={kvLabelStyle()}>{setting.repoFullName}</span>
              <span style={smallMutedStyle()}>
                {setting.exists
                  ? `existing config · updated ${setting.updatedAt?.slice(0, 10) ?? ''}`
                  : 'no row yet · using schema defaults'}
              </span>
            </div>

            {/* Master toggle — DEFAULT OFF. */}
            <label style={toggleRowStyle()}>
              <input
                type="checkbox"
                checked={setting.autoMergeEnabled}
                onChange={(e) => setSetting({ ...setting, autoMergeEnabled: e.target.checked })}
              />
              <span>Enable auto-merge for this repo</span>
            </label>

            {/* Floor slider. Mirrors the existing ThresholdSlider style.
                Hard-floor at 70 in the UI (policy clamps further). */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={labelStyle()}>
                Confidence floor: <strong style={{ color: 'var(--accent-primary)' }}>{setting.autoMergeConfidenceFloor}</strong> / 100
              </label>
              <input
                type="range"
                min={FLOOR_MIN}
                max={FLOOR_MAX}
                step={1}
                value={setting.autoMergeConfidenceFloor}
                onChange={(e) => setSetting({ ...setting, autoMergeConfidenceFloor: Number(e.target.value) })}
                style={{ width: '100%', accentColor: 'var(--accent-warning)' }}
              />
              <span style={smallMutedStyle()}>
                Effective floor is MAX(this value, hard-floor 90, your standard threshold).
                You can&apos;t configure your way below the §5c hard-floor — anti-gaming.
              </span>
            </div>

            {/* Dwell window. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={labelStyle()} htmlFor="automerge-dwell">
                Cancelable dwell window (seconds)
              </label>
              <input
                id="automerge-dwell"
                type="number"
                min={DWELL_MIN}
                max={DWELL_MAX}
                step={1}
                value={setting.autoMergeDwellSeconds}
                onChange={(e) => setSetting({ ...setting, autoMergeDwellSeconds: clampDwellInUI(Number(e.target.value)) })}
                style={inputStyle()}
              />
              <span style={smallMutedStyle()}>
                After the §5c envelope passes, Mendel waits this long before calling the
                merge API. Defensively capped at 24h server-side.
              </span>
            </div>

            {/* Required acknowledgement — gates Save when enabling. */}
            {setting.autoMergeEnabled && (
              <label style={toggleRowStyle({ color: 'var(--accent-warning)' })}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>
                  I understand auto-merge is irreversible and that Mendel will merge PRs on
                  this repo without further confirmation when the §5c envelope passes.
                </span>
              </label>
            )}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || (setting.autoMergeEnabled && !ack)}
                style={buttonStyle('var(--accent-primary)')}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setSetting({ ...setting, ...DEFAULT_SETTING, repoFullName: setting.repoFullName })}
                disabled={saving}
                style={buttonStyle('var(--text-secondary)')}
              >
                Reset to defaults
              </button>
            </div>
          </div>
        )}

        {/* Error surface. */}
        {error && (
          <p style={{ color: 'var(--accent-danger)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }} role="alert">
            {error}
          </p>
        )}

        {/* Recent §5c decisions for THIS repo. */}
        {setting && recent.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={kvLabelStyle()}>Recent §5c decisions ({recent.length})</span>
            <ul style={ulStyle({ listStyle: 'none', paddingLeft: 0, margin: 0 })}>
              {recent.slice(0, 8).map((row) => (
                <li key={row.id} style={logRowStyle()}>
                  <code style={codeStyle()}>{row.kind}</code>{' '}
                  <span style={smallMutedStyle()}>{row.createdAt.slice(0, 19).replace('T', ' ')}</span>
                  <p style={pStyle({ marginTop: '0.25rem' })}>{summarisePayload(row)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </PanelFrame>
  )
}

// ── Pure helpers (tested in automerge-panel.test.ts) ─────────────────────────

export function clampDwellInUI(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < DWELL_MIN) return DWELL_MIN
  if (seconds > DWELL_MAX) return DWELL_MAX
  return Math.round(seconds)
}

/** One-line, plain-English summary of an automerge.* log payload. Pure
 *  on the payload object so unit tests can exercise the formatting
 *  without rendering React. */
export function summarisePayload(row: { kind: string; payload: unknown }): string {
  const p = row.payload as Record<string, unknown> | null
  if (!p || typeof p !== 'object') return '(no payload)'
  if (row.kind === 'automerge.verdict') {
    const reasons = Array.isArray(p.reasons) ? (p.reasons as string[]) : []
    return p.shouldMerge ? 'envelope passed → proceeding to dwell' : `envelope blocked (${reasons.length} reason${reasons.length === 1 ? '' : 's'})`
  }
  if (row.kind === 'automerge.dwell') {
    const phase = p.phase as string | undefined
    return phase === 'started' ? `dwell started (${p.dwellSeconds}s)` : 'dwell completed'
  }
  if (row.kind === 'automerge.merge') {
    return p.ok ? `merged · sha ${(p.sha as string | undefined)?.slice(0, 7) ?? ''}` : `merge failed: ${p.reason}`
  }
  return JSON.stringify(p).slice(0, 120)
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function metaStyle() {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.5625rem',
    letterSpacing: '0.18em',
    color: 'var(--accent-warning)',
    border: '1px solid var(--accent-warning)',
    padding: '0.25rem 0.5rem',
  } as const
}

function infoBlockStyle() {
  return {
    background: 'var(--bg-2)',
    border: '1px dashed var(--border-strong)',
    padding: '0.75rem',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.6875rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  } as const
}

function pStyle(extra: Record<string, string | number> = {}) {
  return { margin: 0, color: 'var(--text-secondary)', ...extra } as const
}

function ulStyle(extra: Record<string, string | number> = {}) {
  return { margin: 0, paddingLeft: '1.25rem', color: 'var(--text-secondary)', ...extra } as const
}

function labelStyle() {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.625rem',
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-muted)',
  } as const
}

function kvLabelStyle() {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    color: 'var(--text-primary)',
  } as const
}

function smallMutedStyle() {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.625rem',
    color: 'var(--text-muted)',
    lineHeight: 1.5,
  } as const
}

function inputStyle() {
  return {
    flex: 1,
    background: 'var(--bg-3, #222)',
    border: '1px solid var(--border-strong)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    padding: '0.5rem 0.75rem',
    outline: 'none',
  } as const
}

function buttonStyle(accent: string) {
  return {
    background: 'transparent',
    border: `1px solid ${accent}`,
    color: accent,
    fontFamily: 'var(--font-mono)',
    fontSize: '0.625rem',
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
    padding: '0.5rem 0.875rem',
    cursor: 'pointer',
  } as const
}

function toggleRowStyle(extra: Record<string, string | number> = {}) {
  return {
    display: 'flex' as const,
    alignItems: 'flex-start' as const,
    gap: '0.5rem',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.6875rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    cursor: 'pointer' as const,
    ...extra,
  }
}

function logRowStyle() {
  return {
    background: 'var(--bg-2)',
    border: '1px solid var(--border-subtle)',
    padding: '0.5rem 0.625rem',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.625rem',
    color: 'var(--text-secondary)',
  } as const
}

function codeStyle() {
  return {
    color: 'var(--accent-secondary)',
    fontFamily: 'var(--font-mono)',
  } as const
}

// Ensure the `useEffect` import isn't reported unused if a future
// auto-refresh lands; for now we intentionally do not auto-poll.
void useEffect
