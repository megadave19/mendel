'use client'

/**
 * TerminalLog — streaming reasoning log (DESIGN.md §11 S4, §12). Running-only.
 * Newest line type-on is handled by the parent feeding lines incrementally;
 * here we render with a phase-colored prefix, timestamp column, and a blinking
 * cursor on the latest line (DESIGN.md §7: new log line type-on + auto-scroll).
 */

import { useEffect, useRef } from 'react'
import type { LogLine, Phase } from './types'

const PHASE_COLOR: Record<Phase, string> = {
  SCAN: 'var(--accent-secondary)',
  DIAGNOSE: 'var(--accent-secondary)',
  PATCH: 'var(--accent-primary)',
  VERIFY: 'var(--accent-warning)',
  // v2.0 / F20 — smoke shares verify's amber until a verdict is in.
  SMOKE: 'var(--accent-warning)',
  DONE: 'var(--accent-primary)',
  ERROR: 'var(--accent-danger)',
}

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

interface TerminalLogProps {
  lines: LogLine[]
  /** Show blinking cursor on the last line (scan still running). */
  live?: boolean
}

export function TerminalLog({ lines, live = true }: TerminalLogProps) {
  const endRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to newest line
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [lines.length])

  return (
    <div
      style={{
        height: '100%',
        overflowY: 'auto',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.75rem',
        lineHeight: 1.7,
      }}
    >
      {lines.map((line, i) => {
        const isLast = i === lines.length - 1
        return (
          <div key={line.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline' }}>
            <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: '3.25rem' }}>
              {/* Fix B2 (audit 2026-05-26): playback rows have no per-event
                  timing in the DB, so they pass a -1 sentinel and we render
                  an em-dash instead of the misleading `00.00`. */}
              {line.t < 0 ? '—' : fmtTime(line.t)}
            </span>
            <span
              style={{
                color: PHASE_COLOR[line.stage],
                flexShrink: 0,
                width: '4.5rem',
                fontWeight: 700,
                fontSize: '0.625rem',
                letterSpacing: '0.08em',
              }}
            >
              {line.stage}
            </span>
            <span style={{ color: 'var(--text-primary)', wordBreak: 'break-word' }}>
              {line.text}
              {isLast && live && <span className="terminal-cursor" />}
            </span>
          </div>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}
