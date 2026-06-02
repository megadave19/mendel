'use client'

/**
 * v2.3 / F25 sub-phase 2 — Monitor settings panel.
 *
 * Lives inside S9 (Settings) alongside AutoMergePanel. Per-repo monitor
 * schedule + enable toggle + lastFired/lastError surface + recent
 * `monitor.fire` log feed. Required acknowledgement copy gates Save when
 * enabling — same opt-in discipline as the auto-merge panel.
 *
 * Per §7.2a:
 *   - Every interactive control has a working handler (Load, Save,
 *     Delete, enable toggle, cron input, PAT input)
 *   - The fire-log feed wires to /api/agent-log?kind=monitor. — real
 *     data, not decorative
 *   - The PAT input has a Show/Hide toggle + autocomplete-off + clean
 *     wipe after save (we never echo the plaintext after the PUT)
 *
 * **Security UI rules:**
 *   - We NEVER request or display the encryptedPat. The server returns
 *     `hasPat: boolean`; the UI shows a "PAT stored" pill when true and
 *     a "PAT required" pill when false.
 *   - On save, the plaintext PAT is sent ONCE in the PUT body, then
 *     immediately wiped from React state.
 */

import { useState, useCallback } from 'react'
import { PanelFrame } from '@/components/phase-d/PanelFrame'

interface MonitorSchedule {
  repoFullName: string
  repoUrl: string
  cronExpression: string
  enabled: boolean
  hasPat: boolean
  lastFiredAt: string | null
  lastErrorAt: string | null
  lastError: string | null
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

const REPO_NAME_RE = /^[\w.-]+\/[\w.-]+$/

const DEFAULT_SCHEDULE = (repoFullName: string): MonitorSchedule => ({
  repoFullName,
  repoUrl: `https://github.com/${repoFullName}`,
  cronExpression: '0 */6 * * *',
  enabled: false,
  hasPat: false,
  lastFiredAt: null,
  lastErrorAt: null,
  lastError: null,
  exists: false,
})

export function MonitorPanel() {
  const [repoFullName, setRepoFullName] = useState('')
  const [schedule, setSchedule] = useState<MonitorSchedule | null>(null)
  const [pat, setPat] = useState('')
  const [revealPat, setRevealPat] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ack, setAck] = useState(false)
  const [recent, setRecent] = useState<AgentLogRow[]>([])

  const handleLoad = useCallback(async () => {
    setError(null)
    if (!REPO_NAME_RE.test(repoFullName)) {
      setError('Repo must be "owner/name" with GitHub-safe characters.')
      return
    }
    setLoading(true)
    try {
      const [s, l] = await Promise.all([
        fetch(`/api/monitor-schedules/${encodeURIComponent(repoFullName)}`).then((r) => r.json()),
        fetch(`/api/agent-log?kind=monitor.&limit=30`).then((r) => r.json()),
      ])
      if (s?.error) throw new Error(s.error)
      setSchedule(s as MonitorSchedule)
      setAck(false)
      setPat('')
      setRevealPat(false)
      const rows: AgentLogRow[] = Array.isArray(l?.rows) ? l.rows : []
      const ownerName = repoFullName.toLowerCase()
      setRecent(
        rows.filter((row) => {
          const p = row.payload as { repoFullName?: string } | null
          return p?.repoFullName?.toLowerCase() === ownerName
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [repoFullName])

  const handleSave = useCallback(async () => {
    if (!schedule) return
    if (schedule.enabled && !ack) {
      setError('Tick the acknowledgement to enable the monitor.')
      return
    }
    if (!schedule.exists && !pat) {
      setError('A new monitor schedule needs a PAT.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/monitor-schedules/${encodeURIComponent(schedule.repoFullName)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repoUrl: schedule.repoUrl,
          cronExpression: schedule.cronExpression,
          enabled: schedule.enabled,
          pat: pat || undefined,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: 'save failed' }))) as { error?: string }
        throw new Error(body.error ?? `save failed (HTTP ${res.status})`)
      }
      const next = (await res.json()) as MonitorSchedule
      setSchedule(next)
      // CRITICAL: wipe the plaintext PAT from React state immediately
      // after a successful save. We never echo it back; reveal toggle resets.
      setPat('')
      setRevealPat(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [schedule, pat, ack])

  const handleDelete = useCallback(async () => {
    if (!schedule || !schedule.exists) return
    if (!confirm(`Delete monitor schedule for ${schedule.repoFullName}? This cannot be undone.`)) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/monitor-schedules/${encodeURIComponent(schedule.repoFullName)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: 'delete failed' }))) as { error?: string }
        throw new Error(body.error ?? `delete failed (HTTP ${res.status})`)
      }
      // Row removed — reset to the schema defaults view.
      setSchedule(DEFAULT_SCHEDULE(schedule.repoFullName))
      setAck(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [schedule])

  return (
    <PanelFrame
      title="Continuous Monitor (v2.3 / F25)"
      accent="var(--accent-secondary)"
      meta={<span style={metaStyle()}>OPT-IN · DEFAULT OFF</span>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={infoBlockStyle()}>
          <p style={pStyle()}>
            The monitor worker (<code style={codeStyle()}>pnpm monitor</code>) runs your scheduled
            scans headless. Per CLAUDE.md §5b + §5 r17:
          </p>
          <ul style={ulStyle()}>
            <li>Default OFF. A new schedule is created disabled — flip it on explicitly.</li>
            <li>Cron expressions are validated server-side (5 fields; no <code style={codeStyle()}>@daily</code>).</li>
            <li>Minimum gap of 5 minutes between fires of the same repo (anti-rate-limit clamp). At most 2 concurrent scans.</li>
            <li>Your PAT is stored AES-256-GCM-encrypted. It is never logged, never returned in REST responses, and is only decrypted at fire time.</li>
            <li>Every skipped fire is logged with the binding reason. The feed below shows recent decisions.</li>
          </ul>
        </div>

        {/* Repo picker. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <label style={labelStyle()} htmlFor="monitor-repo">Repo (owner/name)</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              id="monitor-repo"
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
        {schedule && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', borderTop: '1px dashed var(--border-strong)', paddingTop: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={kvLabelStyle()}>{schedule.repoFullName}</span>
              <span style={smallMutedStyle()}>
                {schedule.exists
                  ? `existing · last fired ${schedule.lastFiredAt?.slice(0, 19).replace('T', ' ') ?? 'never'}`
                  : 'no row yet · using schema defaults'}
              </span>
            </div>

            {/* Last-error surface — only when an error exists, in red, so
                the user can see a failing monitor without digging. */}
            {schedule.lastError && (
              <div role="alert" style={errorBlockStyle()}>
                <span style={{ color: 'var(--accent-danger)' }}>Last error</span>
                <span style={smallMutedStyle()}>
                  {schedule.lastErrorAt?.slice(0, 19).replace('T', ' ') ?? ''}
                </span>
                <p style={pStyle({ marginTop: '0.25rem', color: 'var(--text-primary)' })}>
                  {schedule.lastError}
                </p>
              </div>
            )}

            {/* Master toggle */}
            <label style={toggleRowStyle()}>
              <input
                type="checkbox"
                checked={schedule.enabled}
                onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })}
              />
              <span>Enable scheduled scans for this repo</span>
            </label>

            {/* Cron expression */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={labelStyle()} htmlFor="monitor-cron">Cron expression (5 fields)</label>
              <input
                id="monitor-cron"
                type="text"
                value={schedule.cronExpression}
                onChange={(e) => setSchedule({ ...schedule, cronExpression: e.target.value })}
                spellCheck={false}
                style={inputStyle()}
              />
              <span style={smallMutedStyle()}>
                Examples: <code style={codeStyle()}>0 */6 * * *</code> (every 6h) ·{' '}
                <code style={codeStyle()}>0 0 * * *</code> (daily midnight) ·{' '}
                <code style={codeStyle()}>0 9-17 * * 1-5</code> (hourly weekdays). Server clamps to a 5-minute floor between fires.
              </span>
            </div>

            {/* PAT field — required on CREATE; optional on UPDATE */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <label style={labelStyle()} htmlFor="monitor-pat">
                PAT {schedule.hasPat ? '(stored · leave blank to keep)' : '(required for new schedule)'}
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', position: 'relative' }}>
                <input
                  id="monitor-pat"
                  type={revealPat ? 'text' : 'password'}
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder={schedule.hasPat ? '••••••••••••••••' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
                  autoComplete="off"
                  spellCheck={false}
                  style={inputStyle()}
                />
                <button
                  type="button"
                  onClick={() => setRevealPat((v) => !v)}
                  style={buttonStyle('var(--text-secondary)')}
                  aria-label={revealPat ? 'Hide PAT' : 'Show PAT'}
                >
                  {revealPat ? 'Hide' : 'Show'}
                </button>
              </div>
              <span style={smallMutedStyle()}>
                Encrypted AES-256-GCM at rest. Never logged, never returned, decrypted only at fire time.
              </span>
            </div>

            {/* Required acknowledgement when enabling */}
            {schedule.enabled && (
              <label style={toggleRowStyle({ color: 'var(--accent-warning)' })}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                <span>
                  I understand Mendel will run scans on this repo on its own schedule, decrypting
                  my PAT at each fire to call GitHub on my behalf.
                </span>
              </label>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || (schedule.enabled && !ack)}
                style={buttonStyle('var(--accent-primary)')}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {schedule.exists && (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={saving}
                  style={buttonStyle('var(--accent-danger)')}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <p style={{ color: 'var(--accent-danger)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }} role="alert">
            {error}
          </p>
        )}

        {/* Recent fires for THIS repo. */}
        {schedule && recent.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={kvLabelStyle()}>Recent monitor events ({recent.length})</span>
            <ul style={ulStyle({ listStyle: 'none', paddingLeft: 0, margin: 0 })}>
              {recent.slice(0, 10).map((row) => (
                <li key={row.id} style={logRowStyle()}>
                  <code style={codeStyle()}>{row.kind}</code>{' '}
                  <span style={smallMutedStyle()}>{row.createdAt.slice(0, 19).replace('T', ' ')}</span>
                  <p style={pStyle({ marginTop: '0.25rem' })}>{summariseMonitorPayload(row)}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </PanelFrame>
  )
}

// ── Pure helper (tested in monitor-panel.test.ts) ────────────────────────────

/** One-line summary of a monitor.* event for the Recent feed. Pure. */
export function summariseMonitorPayload(row: { kind: string; payload: unknown }): string {
  const p = row.payload as Record<string, unknown> | null
  if (!p || typeof p !== 'object') return '(no payload)'
  if (row.kind === 'monitor.fire') {
    if (p.fired === true) {
      const scanId = (p.scanId as string | undefined) ?? ''
      return scanId ? `fired → scan ${scanId}` : 'fired'
    }
    return `skipped: ${p.reason ?? '(no reason)'}`
  }
  if (row.kind === 'monitor.error') {
    return `error: ${p.error ?? '(no error)'}`
  }
  return JSON.stringify(p).slice(0, 120)
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function metaStyle() {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.5625rem',
    letterSpacing: '0.18em',
    color: 'var(--accent-secondary)',
    border: '1px solid var(--accent-secondary)',
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

function errorBlockStyle() {
  return {
    background: 'var(--bg-2)',
    border: '1px solid var(--accent-danger)',
    padding: '0.625rem 0.75rem',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.6875rem',
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
