'use client'

import { use, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Skull } from '@/components/mascot/skull'
import type { MascotState } from '@/components/mascot/skull'
import { useScanStream } from '@/hooks/use-scan-stream'
import type { AgentEvent } from '@/lib/agent/runner'

// ── Terminal line colours ──────────────────────────────────────────────────

function eventColor(event: AgentEvent): string {
  switch (event.type) {
    case 'phase': return 'var(--accent-secondary)'
    case 'issue': return 'var(--accent-warning)'
    case 'verify': return (event as { success: boolean }).success ? 'var(--accent-primary)' : 'var(--accent-danger)'
    case 'pr': return 'var(--accent-primary)'
    case 'done': return 'var(--accent-primary)'
    case 'error': return 'var(--accent-danger)'
    default: return 'var(--text-secondary)'
  }
}

function eventPrefix(event: AgentEvent): string {
  switch (event.type) {
    case 'phase': return `[PHASE] ${(event as { phase: string }).phase}`
    case 'log': return '[LOG]'
    case 'issue': return '[ISSUE]'
    case 'verify': return `[VERIFY/${(event as { phase: string }).phase}]`
    case 'pr': return '[PR]'
    case 'done': return '[DONE]'
    case 'error': return '[ERROR]'
    default: return '[???]'
  }
}

function eventBody(event: AgentEvent): string {
  switch (event.type) {
    case 'phase': return ''
    case 'log': return (event as { message: string }).message
    case 'issue': {
      const e = event as { dep: string; currentVersion: string; latestVersion: string }
      return `${e.dep}: ${e.currentVersion} → ${e.latestVersion}`
    }
    case 'verify': {
      const e = event as { success: boolean; output: string }
      return e.success ? 'passed' : `failed${e.output ? ` — ${e.output.slice(0, 120)}` : ''}`
    }
    case 'pr': return (event as { url: string }).url
    case 'done': return (event as { summary: string }).summary
    case 'error': return (event as { message: string }).message
    default: return JSON.stringify(event)
  }
}

function phaseToMascotState(entries: { event: AgentEvent }[]): MascotState {
  const last = [...entries].reverse().find(
    (e) => e.event.type === 'phase' || e.event.type === 'done' || e.event.type === 'error'
  )
  if (!last) return 'idle'
  if (last.event.type === 'done') return 'success'
  if (last.event.type === 'error') return 'error'
  const phase = (last.event as { phase: string }).phase
  switch (phase) {
    case 'DETECT': return 'scanning'
    case 'DIAGNOSE': return 'diagnosing'
    case 'PATCH': return 'patching'
    case 'VERIFY': return 'verifying'
    case 'SUBMIT': return 'thinking'
    default: return 'scanning'
  }
}

export default function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { entries, connected, done, error } = useScanStream(id)
  const bottomRef = useRef<HTMLDivElement>(null)

  const mascotState = phaseToMascotState(entries)
  const prEntry = entries.find((e) => e.event.type === 'pr')
  const prUrl = prEntry ? (prEntry.event as { url: string }).url : null
  const issues = entries.filter((e) => e.event.type === 'issue')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '1.25rem 2rem',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexShrink: 0,
      }}>
        <Skull state={mascotState} size={40} />
        <div style={{ flex: 1 }}>
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.5625rem',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>Scan · {id.slice(0, 16)}…</p>
          <h1 style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '1rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginTop: '0.25rem',
          }}>Live Agent Console</h1>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <motion.div
              animate={{ opacity: connected && !done ? [1, 0.3, 1] : 1 }}
              transition={{ duration: 1, repeat: connected && !done ? Infinity : 0 }}
              style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: done
                  ? (error ? 'var(--accent-danger)' : 'var(--accent-primary)')
                  : connected ? 'var(--accent-secondary)' : 'var(--text-muted)',
              }}
            />
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.5625rem',
              letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)',
            }}>
              {done ? (error ? 'error' : 'done') : connected ? 'live' : 'connecting'}
            </span>
          </div>
          {issues.length > 0 && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', letterSpacing: '0.1em',
              textTransform: 'uppercase', color: 'var(--accent-warning)',
              border: '1px solid var(--accent-warning)', padding: '0.25rem 0.5rem',
            }}>
              {issues.length} dep{issues.length !== 1 ? 's' : ''} found
            </span>
          )}
          {prUrl && (
            <a href={prUrl} target="_blank" rel="noopener noreferrer" className="btn-primary"
              style={{ padding: '0.375rem 0.875rem', fontSize: '0.5625rem' }}>
              View Draft PR →
            </a>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div style={{
        flex: 1, overflow: 'auto', background: 'var(--bg-0)',
        fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
        padding: '1.25rem 2rem', lineHeight: 1.8,
      }}>
        {!connected && entries.length === 0 && (
          <p style={{ color: 'var(--text-muted)' }}>
            Connecting to agent…<span className="terminal-cursor" />
          </p>
        )}

        <AnimatePresence initial={false}>
          {entries.map(({ id: eid, timestamp, event }) => {
            const ts = new Date(timestamp).toISOString().slice(11, 19)
            return (
              <motion.div key={eid}
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
                style={{ display: 'flex', gap: '1rem', marginBottom: '0.125rem' }}
              >
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{ts}</span>
                <span style={{ color: eventColor(event), flexShrink: 0, minWidth: '140px' }}>
                  {eventPrefix(event)}
                </span>
                <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                  {eventBody(event)}
                </span>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {connected && !done && (
          <div style={{ marginTop: '0.25rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>$ </span>
            <span className="terminal-cursor" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Summary bar */}
      {done && (
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          style={{
            padding: '1rem 2rem', borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-1)', display: 'flex', alignItems: 'center',
            gap: '1rem', flexShrink: 0,
          }}
        >
          <Skull state={error ? 'error' : 'success'} size={32} />
          <div style={{ flex: 1 }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
              color: error ? 'var(--accent-danger)' : 'var(--accent-primary)',
            }}>
              {error ? `Scan failed — ${error}` : `Scan complete — ${issues.length} dep(s) processed`}
            </p>
          </div>
          {prUrl && (
            <a href={prUrl} target="_blank" rel="noopener noreferrer" className="btn-primary"
              style={{ padding: '0.5rem 1.25rem', fontSize: '0.625rem' }}>
              View Draft PR →
            </a>
          )}
          <span className="confidence-badge">Confidence: medium — review required</span>
        </motion.div>
      )}
    </div>
  )
}
