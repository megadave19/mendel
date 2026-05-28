'use client'

/**
 * DepGraph — Dep Graph 2.0 (audit 2026-05-26, replaces the decorative DepGraph3D).
 *
 * Was: floating wireframe icosahedrons in 3D, no labels, no interaction, no
 *      relationship to the scan's actual data. Pure eye-candy on a primary
 *      screen — explicit anti-pattern per CLAUDE.md §7.2a step 5.
 *
 * Now: 2D SVG visualization of the scan's real dependency tree.
 *   - Real nodes from scan.deps, labeled with dep name.
 *   - Color-coded by state: dim grey (not scanned), cyan pulse (active),
 *     amber ring (issue found, no PR yet), lime + glow (delivered, PR opened),
 *     red (failed verification — reserved, not yet hit in v1.0).
 *   - Layout: deliveries cluster at center, issues on inner ring, rest on
 *     outer rings — sorted into a "risk radar" where the eye lands on the
 *     part of the project Mendel actually touched.
 *   - Hover: tooltip with version + status; node gently lifts.
 *   - Click: scrolls + expands the matching issue card (callback to parent).
 *   - Filter chips: All / Issues / Delivered.
 *   - Subtle continuous drift (motion preserves "alive" feel, opt-out via
 *     prefers-reduced-motion).
 */

import { useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { IssueVM } from './types'

export interface DepNode {
  id: string
  label: string
}

type NodeState = 'default' | 'active' | 'issue' | 'delivered' | 'failed'

const STATE_COLOR: Record<NodeState, { fill: string; ring: string; label: string }> = {
  default:   { fill: '#1A1A1A', ring: 'rgba(255,255,255,0.12)', label: 'rgba(245,245,245,0.45)' },
  active:    { fill: '#3DFFEE', ring: '#3DFFEE',                label: '#3DFFEE' },
  issue:     { fill: '#1A1A1A', ring: '#FFB84D',                label: '#FFB84D' },
  delivered: { fill: '#C6FF3D', ring: '#C6FF3D',                label: '#C6FF3D' },
  failed:    { fill: '#1A1A1A', ring: '#FF4D5E',                label: '#FF4D5E' },
}

type FilterMode = 'all' | 'issues' | 'delivered'

interface DepGraphProps {
  deps: DepNode[]
  issues: IssueVM[]
  activeNodeId?: string | null
  context?: 'running' | 'rest'
  /** Fired when a node is clicked. Parent scrolls + expands the matching card. */
  onNodeClick?: (depName: string) => void
}

// viewBox sized to roughly match the right-pane aspect ratio (~400x720) so
// the SVG fills the pane vertically instead of letterboxing as a square.
const VIEWBOX = { w: 400, h: 720 }
const CENTER = { x: VIEWBOX.w / 2, y: VIEWBOX.h / 2 }

/** Deterministic ELLIPTICAL layout — tier 1 (delivered) at center, tier 2 */
/** (issue) on inner ellipse, tier 3 (rest) on stacked outer ellipses. Using */
/** ellipses instead of circles lets the graph fill a non-square viewBox. */
function layout(
  nodes: DepNode[],
  deliveredSet: Set<string>,
  issueSet: Set<string>,
): Map<string, { x: number; y: number; r: number }> {
  const positions = new Map<string, { x: number; y: number; r: number }>()
  const t1 = nodes.filter((n) => deliveredSet.has(n.id))
  const t2 = nodes.filter((n) => issueSet.has(n.id) && !deliveredSet.has(n.id))
  const t3 = nodes.filter((n) => !deliveredSet.has(n.id) && !issueSet.has(n.id))

  // Tier 1 — center cluster
  t1.forEach((n, i) => {
    const angle = (i / Math.max(t1.length, 1)) * 2 * Math.PI
    const xR = t1.length > 1 ? 32 : 0
    const yR = t1.length > 1 ? 50 : 0
    positions.set(n.id, { x: CENTER.x + xR * Math.cos(angle), y: CENTER.y + yR * Math.sin(angle), r: 16 })
  })

  // Tier 2 — inner ellipse
  const t2_xR = 110, t2_yR = 160
  t2.forEach((n, i) => {
    const angle = (i / Math.max(t2.length, 1)) * 2 * Math.PI - Math.PI / 2
    positions.set(n.id, { x: CENTER.x + t2_xR * Math.cos(angle), y: CENTER.y + t2_yR * Math.sin(angle), r: 14 })
  })

  // Tier 3 — stacked outer ellipses
  const perRing = 14
  t3.forEach((n, i) => {
    const ring = Math.floor(i / perRing)
    const inRing = i % perRing
    const ringSize = Math.min(perRing, t3.length - ring * perRing)
    const xR = 170 + ring * 22  // ring 0 → 170, ring 1 → 192
    const yR = 250 + ring * 50  // ring 0 → 250, ring 1 → 300
    const angle = (inRing / ringSize) * 2 * Math.PI + (ring * 0.18)
    positions.set(n.id, { x: CENTER.x + xR * Math.cos(angle), y: CENTER.y + yR * Math.sin(angle), r: 9 })
  })

  return positions
}

function trimLabel(s: string, max = 16): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

export function DepGraph({ deps, issues, activeNodeId, context = 'running', onNodeClick }: DepGraphProps) {
  const reduced = useReducedMotion()
  const [filter, setFilter] = useState<FilterMode>('all')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const deliveredSet = useMemo(() => new Set(issues.filter((i) => i.prUrl).map((i) => i.dep)), [issues])
  const issueSet = useMemo(() => new Set(issues.filter((i) => !i.prUrl).map((i) => i.dep)), [issues])
  const versionMap = useMemo(() => {
    const m = new Map<string, { cur: string; latest: string; opened: boolean }>()
    for (const i of issues) m.set(i.dep, { cur: i.currentVersion, latest: i.latestVersion, opened: !!i.prUrl })
    return m
  }, [issues])

  // Visible nodes after filter.
  const visibleDeps = useMemo(() => {
    if (filter === 'issues') return deps.filter((d) => issueSet.has(d.id) || deliveredSet.has(d.id))
    if (filter === 'delivered') return deps.filter((d) => deliveredSet.has(d.id))
    return deps
  }, [deps, filter, issueSet, deliveredSet])

  const positions = useMemo(() => layout(visibleDeps, deliveredSet, issueSet), [visibleDeps, deliveredSet, issueSet])

  const stateOf = (id: string): NodeState => {
    if (deliveredSet.has(id)) return 'delivered'
    if (id === activeNodeId) return 'active'
    if (issueSet.has(id)) return 'issue'
    return 'default'
  }

  const total = deps.length
  const issuesCount = issueSet.size
  const deliveredCount = deliveredSet.size

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ── Filter chips ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0.625rem 0.875rem',
        borderBottom: '1px solid var(--border-subtle)',
        fontFamily: 'var(--font-mono)',
      }}>
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={total} />
        <FilterChip
          active={filter === 'issues'} onClick={() => setFilter('issues')}
          label="Issues" count={issuesCount + deliveredCount} accent="var(--accent-warning)"
        />
        <FilterChip
          active={filter === 'delivered'} onClick={() => setFilter('delivered')}
          label="Delivered" count={deliveredCount} accent="var(--accent-primary)"
        />
        <span style={{ marginLeft: 'auto', fontSize: '0.5rem', color: 'var(--text-muted)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          {context === 'running' ? '◆ live' : '◇ settled'}
        </span>
      </div>

      {/* ── SVG canvas ── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <svg
          viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ width: '100%', height: '100%', display: 'block' }}
          role="img"
          aria-label={`Dependency graph: ${total} deps, ${issuesCount} with open issues, ${deliveredCount} delivered`}
        >
          {/* Light edges from center → issue nodes (only on tier 1+2) */}
          {visibleDeps.map((n) => {
            if (!issueSet.has(n.id) && !deliveredSet.has(n.id)) return null
            const p = positions.get(n.id)
            if (!p) return null
            const isDelivered = deliveredSet.has(n.id)
            return (
              <line
                key={`edge-${n.id}`}
                x1={CENTER.x} y1={CENTER.y}
                x2={p.x} y2={p.y}
                stroke={isDelivered ? 'rgba(198,255,61,0.18)' : 'rgba(255,184,77,0.12)'}
                strokeWidth={1}
                strokeDasharray={isDelivered ? '0' : '3 3'}
              />
            )
          })}

          {visibleDeps.map((n, i) => {
            const p = positions.get(n.id)
            if (!p) return null
            const state = stateOf(n.id)
            const c = STATE_COLOR[state]
            const isHovered = hoveredId === n.id
            const isActive = state === 'active'
            const isDelivered = state === 'delivered'

            // Subtle continuous drift — preserves "alive" feel without strobing.
            // Drift amplitude is small (2–4px) and slow (6–9s period). Disabled
            // on reduced-motion + when settled.
            const driftPhase = (i * 1.37) % (Math.PI * 2)
            const driftAmp = state === 'default' ? 3 : 1.5
            const driftDuration = 6 + (i % 4)
            const enableDrift = !reduced && context === 'running'

            return (
              <motion.g
                key={n.id}
                animate={enableDrift ? {
                  x: [
                    Math.cos(driftPhase) * driftAmp,
                    Math.cos(driftPhase + Math.PI) * driftAmp,
                    Math.cos(driftPhase) * driftAmp,
                  ],
                  y: [
                    Math.sin(driftPhase) * driftAmp,
                    Math.sin(driftPhase + Math.PI) * driftAmp,
                    Math.sin(driftPhase) * driftAmp,
                  ],
                } : { x: 0, y: 0 }}
                transition={enableDrift ? { duration: driftDuration, repeat: Infinity, ease: 'easeInOut' } : undefined}
                onMouseEnter={() => setHoveredId(n.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => {
                  if (issueSet.has(n.id) || deliveredSet.has(n.id)) onNodeClick?.(n.id)
                }}
                style={{ cursor: (issueSet.has(n.id) || deliveredSet.has(n.id)) ? 'pointer' : 'default' }}
              >
                {/* Glow ring (delivered + active only) */}
                {(isDelivered || isActive) && (
                  <motion.circle
                    cx={p.x} cy={p.y} r={p.r + 8}
                    fill="none"
                    stroke={c.ring}
                    strokeWidth={1}
                    opacity={0.4}
                    animate={isActive && !reduced ? { r: [p.r + 6, p.r + 14, p.r + 6], opacity: [0.6, 0.1, 0.6] } : undefined}
                    transition={isActive ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : undefined}
                  />
                )}
                {/* Issue ring (amber dashed) */}
                {state === 'issue' && (
                  <circle cx={p.x} cy={p.y} r={p.r + 5} fill="none" stroke={c.ring} strokeWidth={1.2} strokeDasharray="2 3" opacity={0.85} />
                )}
                {/* Node body */}
                <motion.circle
                  cx={p.x} cy={p.y}
                  r={isHovered ? p.r + 2 : p.r}
                  fill={c.fill}
                  stroke={c.ring}
                  strokeWidth={isDelivered ? 1.5 : 1}
                  transition={{ duration: 0.18 }}
                />
                {/* Label — only show for tier 1/2 by default; on hover for tier 3 */}
                {(p.r >= 12 || isHovered) && (
                  <text
                    x={p.x}
                    y={p.y + p.r + 14}
                    textAnchor="middle"
                    fill={c.label}
                    fontFamily="var(--font-mono)"
                    fontSize={p.r >= 14 ? 10 : 9}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {trimLabel(n.label, p.r >= 14 ? 18 : 14)}
                  </text>
                )}
              </motion.g>
            )
          })}
        </svg>

        {/* ── Hover tooltip ── */}
        {hoveredId && (() => {
          const p = positions.get(hoveredId)
          const ver = versionMap.get(hoveredId)
          const state = stateOf(hoveredId)
          if (!p) return null
          // Project SVG coords to container px (approximation — SVG aspect is
          // preserved so this is close enough for a hover tooltip).
          const wrap = wrapRef.current
          const wrapW = wrap?.clientWidth ?? VIEWBOX.w
          const wrapH = (wrap?.clientHeight ?? VIEWBOX.h) - 44 // minus filter bar
          const scale = Math.min(wrapW / VIEWBOX.w, wrapH / VIEWBOX.h)
          const offsetX = (wrapW - VIEWBOX.w * scale) / 2
          const offsetY = (wrapH - VIEWBOX.h * scale) / 2 + 44
          const px = offsetX + p.x * scale
          const py = offsetY + p.y * scale
          return (
            <div style={{
              position: 'absolute',
              left: Math.min(Math.max(px + 14, 8), wrapW - 220),
              top: Math.min(Math.max(py - 14, 8), wrapH + 24),
              minWidth: 180, maxWidth: 240,
              padding: '0.5rem 0.625rem',
              border: '1px solid var(--border-strong)',
              background: 'var(--bg-1)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.625rem',
              color: 'var(--text-primary)',
              pointerEvents: 'none',
              zIndex: 10,
            }}>
              <p style={{ fontWeight: 700, marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hoveredId}</p>
              {ver ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.5625rem' }}>
                  {ver.cur} <span style={{ color: 'var(--text-muted)' }}>→</span> {ver.latest}
                </p>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.5625rem' }}>up to date</p>
              )}
              <p style={{
                marginTop: '0.375rem', fontSize: '0.5rem', letterSpacing: '0.15em',
                textTransform: 'uppercase', color: STATE_COLOR[state].label,
              }}>
                {state === 'delivered' && '✓ pr opened'}
                {state === 'issue' && '◆ issue found'}
                {state === 'active' && '▸ scanning'}
                {state === 'default' && '· clean'}
                {state === 'failed' && '✕ verify failed'}
              </p>
              {(state === 'issue' || state === 'delivered') && (
                <p style={{ marginTop: '0.375rem', fontSize: '0.5rem', color: 'var(--text-muted)' }}>
                  click to open
                </p>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function FilterChip({
  active, onClick, label, count, accent = 'var(--text-primary)',
}: { active: boolean; onClick: () => void; label: string; count: number; accent?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
        padding: '0.25rem 0.5rem',
        fontFamily: 'inherit', fontSize: '0.5rem',
        letterSpacing: '0.18em', textTransform: 'uppercase',
        background: active ? accent : 'transparent',
        color: active ? 'var(--bg-0)' : 'var(--text-secondary)',
        border: `1px solid ${active ? accent : 'var(--border-subtle)'}`,
        cursor: 'pointer',
        transition: 'all 160ms ease-out',
      }}
    >
      <span style={{ fontWeight: 700 }}>{label}</span>
      <span style={{ opacity: active ? 0.7 : 0.55, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </button>
  )
}
