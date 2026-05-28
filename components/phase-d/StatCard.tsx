'use client'

/**
 * StatCard — Nixtio-density readout (DESIGN.md §11 S8, §12). Big tabular number +
 * small label + optional sparkline. Number ticks up on first load (DESIGN.md §7
 * rest-mode: counting animation 800ms). Mode-agnostic.
 */

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

interface StatCardProps {
  label: string
  value: number
  /** Appended after the number, e.g. "h" for hours. */
  unit?: string
  accent?: string
  /** Optional sparkline series (drawn as a polyline). */
  series?: number[]
}

function useCountUp(target: number, ms = 800): number {
  const [n, setN] = useState(0)
  const raf = useRef(0)
  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced || target === 0) {
      setN(target)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / ms, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setN(Math.round(target * eased))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target, ms])
  return n
}

function Sparkline({ series, color }: { series: number[]; color: string }) {
  if (series.length < 2) return null
  const w = 80
  const h = 24
  const max = Math.max(...series, 1)
  const min = Math.min(...series, 0)
  const range = max - min || 1
  const pts = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} style={{ display: 'block' }} aria-hidden>
      {/* Fix audit 2026-05-27 (DESIGN.md §11 S8): sparkline draws in over 600ms
          via pathLength stroke-dasharray trick. Respects reduced motion (Framer
          default behavior). */}
      <motion.polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        opacity={0.7}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      />
    </svg>
  )
}

export function StatCard({ label, value, unit, accent = 'var(--accent-primary)', series }: StatCardProps) {
  const n = useCountUp(value)
  return (
    <div style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-1)', padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: 0 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.5625rem', fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: '0.2rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '2.25rem', fontWeight: 700, lineHeight: 1, color: accent, fontVariantNumeric: 'tabular-nums', textShadow: `0 0 18px ${accent}40` }}>
          {n}
        </span>
        {unit && <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{unit}</span>}
      </span>
      {series && series.length >= 2 && <Sparkline series={series} color={accent} />}
    </div>
  )
}
